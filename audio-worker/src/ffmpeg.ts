import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PermanentError } from './errors.js';

const run = promisify(execFile);

/** Default wall-clock cap on any single ffmpeg/ffprobe invocation. */
export const DEFAULT_CHILD_TIMEOUT_MS = 300_000;

/**
 * Options every child-process call in this worker must pass.
 *
 * The worker is a single sequential loop at `replicaCount: 1`, and `reapStale`
 * lives *inside* that loop. A source that makes ffmpeg hang rather than exit
 * non-zero would therefore block `processAsset` forever, which blocks the loop,
 * which means the reaper never runs again either — so the row sits in
 * `processing` with nothing able to rescue it, every later upload queues behind
 * it, and only a manual pod restart recovers. A timeout turns that into an
 * ordinary caught error that flows through the existing retry/fail path.
 *
 * `SIGKILL` rather than the default `SIGTERM`: a wedged ffmpeg is exactly the
 * process least likely to honour a polite signal, and a surviving child would
 * reproduce the hang it is meant to end.
 *
 * Read per call (not once at module load) so the deployment can retune
 * `FFMPEG_TIMEOUT_MS` without a rebuild, and so tests can drive it directly.
 */
export function childProcOptions(): { timeout: number; killSignal: 'SIGKILL' } {
  const raw = Number(process.env.FFMPEG_TIMEOUT_MS);
  return {
    timeout: Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  };
}

/**
 * Canonical loudness target, matching the ttrpg-sfx POC's normalize.sh: all
 * generated and hand-uploaded audio lands at the same perceived level, so
 * phase 2 never needs per-asset gain-riding.
 */
export const LOUDNORM = 'loudnorm=I=-20:TP=-1.5:LRA=11';

/**
 * Every rendition is 48 kHz stereo, unconditionally, whatever the source was.
 *
 * 48 kHz because `loudnorm` internally upsamples to 192 kHz and emits at that
 * rate; without an explicit `-ar` the encoder inherits it and clamps to
 * whatever it supports (measured: the aac encoder produced 96 kHz renditions
 * from a plain 48 kHz source). Stereo because a 5.1 source otherwise passes
 * through as six channels sharing the same total bitrate — measured at 134.9
 * kbit/s across 6 channels, ~22 kbit/s each.
 *
 * Phase 2 also needs one known rate to express `durationSamples` in; see the
 * `durationSamples` comment in `app/server/db/models/AudioAsset.ts`.
 */
export const RENDITION_SAMPLE_RATE = 48_000;
export const RENDITION_CHANNELS = 2;

/**
 * THE BOUND. Every ffmpeg invocation in this worker that decodes audio begins
 * with exactly this filter chain, and none of them may be written without it.
 *
 * The invariant it enforces — see `MAX_SOURCE_DURATION_MS` in config.ts for the
 * full statement — is that no stage ever decodes more than the cap, in a unit
 * that cannot differ between stages. Two filters, both load-bearing:
 *
 *   aresample=<rate>          pin the sample clock, so the count below means
 *                             the same thing whatever the source's own rate was.
 *   atrim=end_sample=<n>      cut after exactly `n` DECODED SAMPLES. `end_sample`
 *                             is an index into the samples the filter has
 *                             actually been handed, counted by the filter
 *                             itself — it is not derived from a timestamp, so
 *                             nothing a container says about the timeline can
 *                             move it.
 *
 * WHY NOT `-t`, AND WHY NOT `atrim=end`. Both bound TIMELINE POSITION, and a
 * container is free to advance the timeline without emitting audio. Measured on
 * a Matroska built by `ffmpeg -f concat` from a 5 s clip, a `duration 3000`
 * directive and a 1000 s clip (12.3 MB, every byte produced by stock ffmpeg):
 *
 *   -t 1801                          241 203 samples   (5.02 s)
 *   atrim=end_sample=86 448 000   48 242 406 samples (1005.05 s)
 *
 * The file really is 1005 s long. A pipeline that measures it on the timeline
 * and then encodes it unbounded writes a `ready` row claiming 5 s with 1005 s
 * renditions behind it — the duration is wrong by 200x and phase 2's loop
 * points are meaningless. That is round 6's defect, and no amount of adding
 * `-t` to the other stages fixes it, because `-t` measures the wrong quantity.
 *
 * WHY NOT `asetpts=N/SR/TB,atrim=end=<limit>`, which is what this was and which
 * bounds the same quantity by a different route — rebasing every timestamp onto
 * the decoded-sample clock so that a timeline cut becomes a sample cut. It
 * works, and it costs a warning per output frame on any source that changes
 * format mid-stream. ffmpeg REBUILDS THE FILTER GRAPH at such a change and
 * `asetpts`'s sample counter restarts from zero, so the timestamps handed to
 * the muxer jump backwards and every frame until they catch up draws
 * "non monotonically increasing dts". Measured on a 7.2 MB MP3 of thirty
 * alternating-sample-rate 60 s segments, at `analyze`'s `-v info`:
 *
 *   aresample,asetpts,atrim=end=1801     7 140 647 B of stderr, 57 191 warnings
 *   aresample,atrim=end_sample=86448000     13 908 B of stderr,      0 warnings
 *
 * The first overruns `execFile`'s stderr buffer on a slightly longer source and
 * fails the asset with `stderr maxBuffer length exceeded`, retryably, three
 * times. Suppressing it at the muxer is not available: `-f wav` and `-f md5`
 * trade it for 57 177 lines of "Non-monotonic DTS" instead, `-f null` with
 * `-max_interleave_delta 0` and with `-avoid_negative_ts 0` are unchanged, and
 * a zero-output filter graph (`anullsink`) is rejected outright by the CLI. All
 * measured. `end_sample` removes the cause rather than the symptom, and it
 * states the invariant directly: the bound is a sample count, so express it as
 * one.
 *
 * `asetpts` has NOT disappeared — see `COMPACT_OUTPUT_TIMELINE`. It was doing a
 * second job that only the stages writing a file need, and separating the two
 * is why it can be dropped here.
 *
 * The chain still bounds COST, which is what `-t` was there for. `atrim`
 * propagates EOF upstream, so demuxing stops at the cut rather than running to
 * the end of the file. Measured on a 2-hour, 8 kbit/s MP3:
 *
 *   unbounded                    345 600 000 samples   3.56 s
 *   end_sample=86 448 000         86 448 000 samples   0.92 s
 *
 * That count is exactly 1801 x 48 000, which is what makes the cap decidable
 * from the measuring pass: a source at the cap reads at the cap, anything
 * longer reads over it.
 */
export function boundedDecodeFilters(sampleRate: number, limitSeconds: number): string {
  return `aresample=${sampleRate},atrim=end_sample=${sampleRate * limitSeconds}`;
}

/**
 * Rebases output timestamps onto the decoded-sample clock: each frame's pts
 * becomes `samples_so_far / rate`.
 *
 * This is NOT part of the bound and must not be confused with it — it is part
 * of the OUTPUT CONTRACT, and it belongs only to the stages that write a file.
 * A source can carry gaps in its timeline (a Matroska the `concat` demuxer
 * assembled across a `duration` directive is the ordinary way to get one), and
 * a rendition that preserves them is a file whose container duration is not the
 * length of its audio. Measured on the 5 s + 3000 s hole + 200 s Matroska:
 *
 *   with this filter      205.107 s of container for 205.006 s of audio
 *   without it           3200.100 s of container for 205.006 s of audio
 *
 * The byte counts are within 30 bytes of each other — the second file is not
 * longer, it merely CLAIMS to be, which is precisely the class of lie this
 * whole exercise exists to stop. `assertRenditionComplete` reads a rendition's
 * container duration back, so without this the two-sided check would fail every
 * gap-carrying source.
 *
 * `analyze` does not write a file — it counts samples — so it does not carry
 * this, and not carrying it is what keeps its stderr readable. See
 * `boundedDecodeFilters`.
 */
export const COMPACT_OUTPUT_TIMELINE = 'asetpts=N/SR/TB';

/**
 * The stderr ffmpeg is allowed to produce before its output is abandoned.
 *
 * `execFile` buffers stdout and stderr in memory up to this size EACH and
 * rejects with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` past it. The default is
 * 1 MiB, and a source that emits a diagnostic per frame — a badly damaged MP3
 * re-syncing on every frame, at `-v error` — passes that on length alone.
 *
 * The failure it produces is the reason this is not simply "a big number":
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` is a plain `Error`, so it used to spend
 * the whole retry budget and land the row on `lastError: "stderr maxBuffer
 * length exceeded"` — an opaque message, on a `failed` row the UI offered a
 * Retry button for, for a file that could never succeed. `runFfmpeg` converts
 * it into a `PermanentError` instead: the volume of diagnostics a fixed byte
 * stream provokes is a property of that byte stream, so it is identical on
 * every run and retrying is guaranteed waste.
 */
export const FFMPEG_STDERR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * `-threads 1`, spliced into EVERY decoding invocation TWICE — once before the
 * input and once before the output. DO NOT "optimise" this back to the default.
 *
 * ffmpeg sizes its thread pools from `nproc`, and a container sees the NODE's
 * core count, not its cgroup quota. Measured in-pod on the deployed image:
 * `nproc` = 36 while `cpu.max` = `100000 100000`, i.e. exactly one CPU. So
 * ffmpeg opened 36-way pools against a 1-core quota and spent the difference
 * on context switches. Timed in-pod against the worst realistic source
 * (30 min, 5 additive tones at 440/3k/9k/15k/21k Hz, 128 kbit/s MP3, 28.8 MB —
 * the shape that produces the highest opus bitrate):
 *
 *   cpu=1, default threads    opus 142s   aac 205s
 *   cpu=1, -threads 1         opus  43s   aac  69s
 *   cpu=6, default threads               aac  49s
 *   cpu=6, -threads 1         opus  26s   aac  49s
 *
 * Read the last two rows together: once the quota is not the binding
 * constraint, one thread and thirty-six are THE SAME SPEED (49s vs 49s). This
 * encode is effectively single-threaded, so the pool size only ever decides how
 * badly a throttled cgroup thrashes. That makes the flag free when CPU is
 * plentiful and a 3x win whenever it is not — correct defensively, and it stays
 * correct if the limit in values.yaml is ever lowered again.
 *
 * TWICE, because the two positions are DIFFERENT KNOBS and each leaves the
 * other's pool at `nproc`. Before `-i` it is a decoder option; after the input
 * it sizes the encoder and filter side. Thread counts of a live ffmpeg
 * (`ps -M`, 18-core host, ffmpeg 8.1.2), transcoding to aac:
 *
 *   input      default   output-side only   both
 *   mp3            21            6            6
 *   flac           22           22            6
 *
 * mp3float decodes on one thread whatever you ask, so the output-side flag
 * alone looks sufficient — and a fixture that is only ever an MP3 would say so.
 * flac frame-threads its decode, and there the input-side flag is the only one
 * that does anything. Both stages behave the same way: `analyze` on a flac
 * source runs 37 threads by default and 6 with both flags.
 *
 * `probe()` is not on this list: ffprobe reads headers and decodes nothing.
 */
export const SINGLE_THREAD = ['-threads', '1'];

/**
 * Runs ffmpeg with the worker's standard timeout and stderr ceiling, and turns
 * a stderr overrun into a readable permanent failure rather than an opaque
 * retryable one. Every ffmpeg invocation in this worker goes through it.
 */
async function runFfmpeg(args: string[], stage: string): Promise<{ stderr: string }> {
  try {
    return await run('ffmpeg', args, {
      ...childProcOptions(),
      maxBuffer: FFMPEG_STDERR_MAX_BYTES,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new PermanentError(
        `Audio file is too damaged to ${stage}: decoding it produces more than ` +
          `${FFMPEG_STDERR_MAX_BYTES / (1024 * 1024)} MB of errors. Re-encode the file and upload it again`
      );
    }
    throw err;
  }
}

export type ProbeResult = { durationMs: number; sampleRate: number; channels: number };

/**
 * Header-level metadata for the FIRST AUDIO STREAM. Cheap — ffprobe reads
 * container/codec headers, it does not decode — so this is what gates the
 * source-duration cap before anything expensive runs.
 *
 * `durationMs` comes from `stream=duration`, NOT `format=duration`.
 * `-select_streams a:0` constrains only the `stream=` entries; `format=` is
 * container-wide and reports the longest stream of any type. Measured: an M4A
 * carrying a 2 s and an 8 s audio stream reports `format.duration = 8.0` (4x
 * the a:0 length), and a 10 s video with a 3 s audio track reports 10.0 (3.3x).
 * The format value is kept only as a fallback for containers that carry no
 * per-stream duration at all.
 *
 * This is a HEADER CLAIM, not a measurement, and it is not trustworthy enough
 * to reject anything on. For an MP3 with no Xing/VBRI header ffmpeg EXTRAPOLATES
 * the duration by dividing the file size by the first frame's bitrate, so the
 * error is `avg_bitrate / first_frame_bitrate` and is bounded only by the format
 * (8 kbit/s to 320 kbit/s, i.e. up to 40x). Measured on this machine with
 * ffmpeg 8.1.2:
 *
 * | file (all complete and valid)          | stream=duration | truly decodes to |
 * |----------------------------------------|-----------------|------------------|
 * | 1 s quiet intro + 59 s loud body       |      145 654 ms |        60 029 ms |
 * | 1 s quiet intro + 1020 s loud body     |    2 509 685 ms |     1 021 048 ms |
 * | 32 kbit/s segment + 320 kbit/s segment |       82 506 ms |        10 057 ms |
 *
 * That last one over-reports by 8.2x, and the 17-minute one claims 41.8 minutes
 * — so a duration cap applied to THIS number rejects honest files. `durationMs`
 * is therefore carried for provenance and logging only; every decision that can
 * reject an upload is made on `analyze()`'s decoded sample count instead.
 */
export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=sample_rate,channels,duration:format=duration',
      '-of',
      'json',
      path,
    ],
    childProcOptions()
  );
  const parsed = JSON.parse(stdout) as {
    streams?: { sample_rate?: string; channels?: number; duration?: string }[];
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0] ?? {};
  const streamSeconds = Number(stream.duration);
  const formatSeconds = Number(parsed.format?.duration);
  const seconds = Number.isFinite(streamSeconds)
    ? streamSeconds
    : Number.isFinite(formatSeconds)
      ? formatSeconds
      : 0;
  return {
    durationMs: Math.round(seconds * 1000),
    sampleRate: Number(stream.sample_rate ?? 0),
    channels: Number(stream.channels ?? 0),
  };
}

/**
 * What the file ACTUALLY decodes to, as opposed to what its header claims.
 *
 * `samples` is the per-channel sample count after resampling to
 * `RENDITION_SAMPLE_RATE`, so it is exactly the number phase 2 needs for
 * `loopEnd` (see `durationSamples`): sample-accurate, and not the ±24 samples
 * of slop you get from rounding to whole milliseconds.
 *
 * `peakDb` is `-Infinity` for a file that is digital silence end to end.
 * That case has to be caught BEFORE encoding: `loudnorm` divides by the
 * measured level, so an all-zero input makes it emit NaN/±Inf and the aac
 * encoder dies with `Input contains (near) NaN/+-Inf` (exit 234). Leading and
 * trailing silence are fine — only a wholly-silent file triggers it.
 *
 * Costs one decode pass, BOUNDED BY `limitSeconds` through
 * `boundedDecodeFilters` — the same prefix `transcode` and `extractPeaks` use,
 * so the three cannot bound different quantities. `limitSeconds` is REQUIRED
 * and there is no unbounded mode: an optional bound is a bound someone forgets,
 * and forgetting it here is what let a source decode for 26 s per attempt on a
 * worker that processes assets one at a time.
 *
 * The bounded run still answers the question the cap asks — at
 * `MEASURE_LIMIT_SECONDS` a 30-minute source reads 86 400 000 samples and
 * anything longer reads 86 448 000 — so the rejection is made on a MEASUREMENT
 * that cannot be faked, at 4% of the cost of the honest answer and with none of
 * the header's false positives.
 *
 * `samples` is the count AFTER the trim, which is what makes it the right
 * number to store: it describes precisely the audio the rendering stages, which
 * run the same prefix over the same bytes, will encode.
 *
 * astats writes its report to stderr at `info` level. A file with zero decoded
 * samples produces no report at all (ffmpeg still exits 0) — that is the
 * `samples: 0` case, and it is a real upload shape: a 44-byte WAV with a valid
 * `fmt ` chunk and an empty `data` chunk.
 *
 * ONE REPORT PER FILTER-GRAPH SEGMENT, NOT ONE PER FILE — and the totals are
 * SUMMED rather than read off the last one. When a source changes sample rate,
 * sample format or channel layout MID-STREAM (a raw `cat` of two MP3s encoded
 * at different rates does exactly this, and so does a Matroska assembled by the
 * `concat` demuxer from mixed inputs), ffmpeg TEARS DOWN AND REBUILDS the whole
 * filter graph at the change. Every filter in it is re-instantiated: astats
 * emits its report and starts over, and — the part that matters — `atrim`'s
 * sample counter, and therefore its cut, RESETS with it.
 *
 * Reading only the last report was wrong twice over: it reported one segment's
 * length as the file's, and it hid the reset. Measured on a 3 s @ 44.1 kHz
 * stereo MP3 concatenated with a 4 s @ 8 kHz mono one: three reports of 144 230,
 * 610 and 196 992 samples. The last is 4.10 s; the file is 7.12 s.
 *
 * Summing makes the per-segment bound sound again, by this argument:
 *
 *   Let S be the sum and B the per-segment bound (`MEASURE_LIMIT_SECONDS`,
 *   which is strictly greater than the cap). If ANY segment had been trimmed it
 *   would have measured exactly B, so S >= B > cap and the caller rejects the
 *   source. Therefore whenever S is at or under the cap — the only case that
 *   goes on to be encoded — NO segment was trimmed and S is the file's exact
 *   decoded length.
 *
 * So the bound is either invisible (and the measurement exact) or it fires (and
 * the source is refused). A hostile file that resets the trim a thousand times
 * cannot buy more decoding than the file's own content, which `AUDIO_MAX_BYTES`
 * already caps at ~13.9 hours and which sums to far over the cap — so it is
 * refused after one bounded measuring pass and never reaches an encoder.
 *
 * `segments` is returned because it DECIDES a failure, not merely explains one.
 * The same teardown discards whatever `loudnorm` was holding in its 3-second
 * lookahead, so a multi-segment source RENDERS SHORTER THAN IT MEASURES, and by
 * a margin that grows with the number of changes: 7.12 s measured / 4.21 s
 * rendered on the two-segment file above, and 1800 s measured / 60.1 s rendered
 * on a thirty-segment one. `assertDecodedUsable` therefore refuses `segments >
 * 1` outright, before either encoder runs, rather than paying for two 30-minute
 * transcodes to arrive at the same permanent rejection from
 * `assertRenditionComplete`. Both messages name the cause.
 */
export type AnalyzeResult = { samples: number; peakDb: number; segments: number };

export async function analyze(path: string, limitSeconds: number): Promise<AnalyzeResult> {
  // NOT `COMPACT_OUTPUT_TIMELINE`. This stage writes no file, so it has no
  // output timeline to compact — and rebasing timestamps here is what used to
  // make a multi-format source emit a muxer warning per frame (57 191 of them
  // on a 7.2 MB fixture, 7.1 MB of stderr) and fail the asset on the buffer
  // rather than on its contents. See `boundedDecodeFilters`.
  const { stderr } = await runFfmpeg(
    [
      '-v',
      'info',
      '-hide_banner',
      '-nostats',
      // Decoder-side pool. See `SINGLE_THREAD`.
      ...SINGLE_THREAD,
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      `${boundedDecodeFilters(RENDITION_SAMPLE_RATE, limitSeconds)},` +
        'astats=measure_perchannel=none:measure_overall=Peak_level+Number_of_samples',
      // Filter/encoder-side pool — a separate pool from the one above, and the
      // one the input-side flag does NOT reach.
      ...SINGLE_THREAD,
      '-f',
      'null',
      '-',
    ],
    'measure'
  );

  // SUM, not `.pop()` — see the "one report per filter-graph segment" note
  // above. On the single-format sources that are the overwhelming majority
  // there is exactly one report and the two are identical.
  const sampleReports = [...stderr.matchAll(/Number of samples:\s*(\d+)/g)];
  const samples = sampleReports.reduce((total, m) => total + Number(m[1]), 0);

  // MAX across segments, for the same reason: a file is "wholly silent" only
  // if every one of its segments is. `-inf` (exact digital silence) parses to
  // NaN and is filtered out here, so a file with no finite report at all falls
  // through to -Infinity — which is what "no audible content" means.
  const peaks = [...stderr.matchAll(/Peak level dB:\s*(\S+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));

  return {
    samples,
    peakDb: peaks.length > 0 ? Math.max(...peaks) : Number.NEGATIVE_INFINITY,
    segments: sampleReports.length,
  };
}

export type Codec = 'opus' | 'aac';

/**
 * Opus (libopus, Ogg) covers Chrome/Firefox at small file sizes; AAC (M4A,
 * AudioToolbox/native aac encoder) covers Safari/iOS. The client picks a
 * rendition via `canPlayType`, and players are on browsers we don't control —
 * emitting only one codec is not a size optimization, it's a broken player
 * for half the table. Callers must always produce both.
 *
 * BOUNDED, by the same `boundedDecodeFilters` prefix `analyze` measured with —
 * required, not optional. Leaving the encoders unbounded while the measuring
 * pass was bounded is the exact shape of the last defect: the row recorded what
 * the bounded pass saw and the renditions held whatever the unbounded encoder
 * produced. Here the prefix runs at `RENDER_LIMIT_SECONDS` (the cap itself)
 * rather than the measuring pass's cap + 1 s, so even a hypothetical
 * disagreement between the two passes cannot put more than the cap into a
 * rendition.
 */
export async function transcode(
  src: string,
  out: string,
  codec: Codec,
  limitSeconds: number
): Promise<void> {
  const args =
    codec === 'opus'
      ? ['-c:a', 'libopus', '-b:a', '96k']
      : ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];

  await runFfmpeg(
    [
      '-v',
      'error',
      // Decoder-side pool. See `SINGLE_THREAD`.
      ...SINGLE_THREAD,
      '-i',
      src,
      // `-map 0:a:0` — take the first audio stream and NOTHING else. Without
      // it ffmpeg's default stream selection also picks the "best" video
      // stream, which for a music file is its embedded cover art. Measured:
      // an MP3 with a PNG cover fails the AAC leg outright (`Could not find
      // tag for codec h264 in stream #0` -> exit 234, 0-byte output), and
      // since processAsset requires both legs, a failing AAC leg discards the
      // successful Opus one too. Most real music files carry cover art.
      // It also pins WHICH audio stream is used when a container has several.
      '-map',
      '0:a:0',
      // The bound comes FIRST in the chain, ahead of loudnorm: loudnorm is the
      // expensive filter, and trimming before it means a source longer than the
      // cap never reaches it. loudnorm neither adds nor drops samples relative
      // to what it is fed, so the trim's position does not change the content.
      //
      // `COMPACT_OUTPUT_TIMELINE` sits between them because this stage writes a
      // FILE: without it a source carrying a timeline gap produces a rendition
      // whose container claims 3200 s over 205 s of audio (measured). It goes
      // after the trim so that what it renumbers is exactly the bounded stream.
      '-af',
      `${boundedDecodeFilters(RENDITION_SAMPLE_RATE, limitSeconds)},${COMPACT_OUTPUT_TIMELINE},${LOUDNORM}`,
      // Must come after -af: these constrain the encoder, not the filter
      // chain, and loudnorm's own 192 kHz output is exactly what they undo.
      '-ar',
      String(RENDITION_SAMPLE_RATE),
      '-ac',
      String(RENDITION_CHANNELS),
      ...args,
      // Filter/encoder-side pool — a separate pool from the one before `-i`,
      // and the leg these measurements were taken on. See `SINGLE_THREAD`.
      ...SINGLE_THREAD,
      '-y',
      out,
    ],
    'transcode'
  );
}
