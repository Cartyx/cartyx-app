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
 * Costs one decode pass, BOUNDED BY `limitSeconds`. That bound is what closes
 * the decode-amplification DoS, and it replaces the old header-duration gate
 * outright: `AUDIO_MAX_BYTES` is 50 MB, and 50 MB of minimum-bitrate MP3 is
 * ~13.9 hours of audio, so an unbounded pass over one costs real time on a
 * worker that processes assets one at a time. Measured on exactly that file
 * (50 000 000 bytes, 8 kbit/s mono, 50 000 s long):
 *
 *     unbounded            2 400 000 000 samples   24.16 s
 *     -t 1801 (cap + 1 s)     86 448 000 samples    0.93 s
 *
 * The bounded run still answers the question the cap asks — 86 448 000 > the
 * 86 400 000 samples that 30 minutes is — so the rejection is made on a
 * MEASUREMENT that cannot be faked, at 4% of the cost of the honest answer and
 * with none of the header's false positives. `-t` is passed as an INPUT option
 * (before `-i`) so demuxing itself stops there; as an output option the filter
 * graph overshoots slightly (measured 2 930 295 samples against an exact
 * 2 928 000 for `-t 61`).
 *
 * astats writes its report to stderr at `info` level. A file with zero decoded
 * samples produces no report at all (ffmpeg still exits 0) — that is the
 * `samples: 0` case, and it is a real upload shape: a 44-byte WAV with a valid
 * `fmt ` chunk and an empty `data` chunk.
 */
export type AnalyzeResult = { samples: number; peakDb: number };

export async function analyze(path: string, limitSeconds?: number): Promise<AnalyzeResult> {
  const { stderr } = await run(
    'ffmpeg',
    [
      '-v',
      'info',
      '-hide_banner',
      '-nostats',
      // Input-side, so it bounds the DEMUX as well as the filter graph.
      ...(limitSeconds ? ['-t', String(limitSeconds)] : []),
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      `aresample=${RENDITION_SAMPLE_RATE},astats=measure_perchannel=none:measure_overall=Peak_level+Number_of_samples`,
      '-f',
      'null',
      '-',
    ],
    // A damaged source can emit a decode warning per frame, and execFile's
    // 1 MiB default would turn that into ENOBUFS instead of a usable report.
    // The report itself is a fixed handful of lines regardless of duration.
    { ...childProcOptions(), maxBuffer: 8 * 1024 * 1024 }
  );

  const samplesMatch = [...stderr.matchAll(/Number of samples:\s*(\d+)/g)].pop();
  const peakMatch = [...stderr.matchAll(/Peak level dB:\s*(\S+)/g)].pop();
  const peakRaw = peakMatch?.[1];
  const peak = peakRaw === undefined ? Number.NaN : Number(peakRaw);

  return {
    samples: samplesMatch ? Number(samplesMatch[1]) : 0,
    // `-inf` (exact digital silence) and a missing report both parse to NaN
    // here; both mean "no audible content", which is what -Infinity says.
    peakDb: Number.isFinite(peak) ? peak : Number.NEGATIVE_INFINITY,
  };
}

export type Codec = 'opus' | 'aac';

/**
 * Opus (libopus, Ogg) covers Chrome/Firefox at small file sizes; AAC (M4A,
 * AudioToolbox/native aac encoder) covers Safari/iOS. The client picks a
 * rendition via `canPlayType`, and players are on browsers we don't control —
 * emitting only one codec is not a size optimization, it's a broken player
 * for half the table. Callers must always produce both.
 */
export async function transcode(src: string, out: string, codec: Codec): Promise<void> {
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
      '-af',
      LOUDNORM,
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
