import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
 * that cannot differ between stages. It is three filters and each is
 * load-bearing:
 *
 *   aresample=<rate>   pin the sample clock, so "seconds" below means the same
 *                      thing whatever the source's own rate was.
 *   asetpts=N/SR/TB    REBASE the timestamps onto the DECODED-SAMPLE CLOCK. `N`
 *                      is the count of samples the filter has seen, `SR` the
 *                      rate, so each frame's pts becomes exactly
 *                      `samples_so_far / rate`. This is the whole trick.
 *   atrim=end=<limit>  cut at `limit` on that rebased clock — i.e. after
 *                      `limit * rate` DECODED SAMPLES, not at a timeline
 *                      position.
 *
 * WHY NOT `-t`. `-t` (input or output) bounds TIMELINE POSITION, and a
 * container is free to advance the timeline without emitting audio. Measured on
 * a Matroska built by `ffmpeg -f concat` from a 5 s clip, a `duration 3000`
 * directive and a 1000 s clip (12.3 MB, every byte produced by stock ffmpeg):
 *
 *   -t 1801                        241 203 samples   (5.02 s)    0.01 s
 *   this chain, atrim=end=1801   48 242 406 samples (1005.05 s)  0.65 s
 *
 * The file really is 1005 s long. A pipeline that measures it with `-t` and
 * then encodes it unbounded writes a `ready` row claiming 5 s with 1005 s
 * renditions behind it — the duration is wrong by 200x and phase 2's loop
 * points are meaningless. That is round 6's defect, and no amount of adding
 * `-t` to the other stages fixes it, because `-t` is measuring the wrong thing.
 *
 * The chain still bounds COST, which is what `-t` was there for. `atrim`
 * propagates EOF upstream, so demuxing stops at the cut rather than running to
 * the end of the file. Measured on a 50 MB, 8 kbit/s, 13.9-hour MP3 — the
 * densest decode `AUDIO_MAX_BYTES` can buy:
 *
 *   unbounded                  2 400 000 000 samples   26.33 s
 *   this chain, end=1801          86 448 000 samples    0.99 s
 *
 * `end=1801` yields exactly 1801 x 48 000 samples, which is what makes the
 * cap decidable from the measuring pass: a source at the cap reads at the cap,
 * anything longer reads over it.
 *
 * `asetpts` also normalises a source whose first timestamp is not zero, which
 * `atrim` would otherwise measure `end` against.
 */
export function boundedDecodeFilters(sampleRate: number, limitSeconds: number): string {
  return `aresample=${sampleRate},asetpts=N/SR/TB,atrim=end=${limitSeconds}`;
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
 * emits its report and starts over, and — the part that matters — `asetpts`'s
 * sample counter and `atrim`'s cut both RESET.
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
 * `segments` is returned because the caller needs it to explain a failure: the
 * same teardown discards whatever `loudnorm` was holding in its 3-second
 * lookahead, so a multi-segment source RENDERS SHORTER THAN IT MEASURES (the
 * file above: 7.12 s measured, 4.21 s rendered). `assertRenditionComplete`
 * catches that and refuses to publish — the row is never `ready` with a
 * duration its audio does not have — but the reason is worth naming rather than
 * leaving as a bare "the rendition is incomplete".
 */
export type AnalyzeResult = { samples: number; peakDb: number; segments: number };

export async function analyze(path: string, limitSeconds: number): Promise<AnalyzeResult> {
  const { stderr } = await run(
    'ffmpeg',
    [
      '-v',
      'info',
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      `${boundedDecodeFilters(RENDITION_SAMPLE_RATE, limitSeconds)},` +
        'astats=measure_perchannel=none:measure_overall=Peak_level+Number_of_samples',
      '-f',
      'null',
      '-',
    ],
    // A damaged source can emit a decode warning per frame, and execFile's
    // 1 MiB default would turn that into ENOBUFS instead of a usable report.
    // The report itself is a fixed handful of lines regardless of duration.
    { ...childProcOptions(), maxBuffer: 8 * 1024 * 1024 }
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

  await run(
    'ffmpeg',
    [
      '-v',
      'error',
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
      '-af',
      `${boundedDecodeFilters(RENDITION_SAMPLE_RATE, limitSeconds)},${LOUDNORM}`,
      // Must come after -af: these constrain the encoder, not the filter
      // chain, and loudnorm's own 192 kHz output is exactly what they undo.
      '-ar',
      String(RENDITION_SAMPLE_RATE),
      '-ac',
      String(RENDITION_CHANNELS),
      ...args,
      '-y',
      out,
    ],
    childProcOptions()
  );
}
