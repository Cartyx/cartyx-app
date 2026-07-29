import { execFile } from 'node:child_process';
import { childProcOptions } from './ffmpeg.js';

/** Mono s16 at this rate is what the peak decode below emits. */
export const PEAK_DECODE_SAMPLE_RATE = 8_000;

/** Bytes of mono s16 PCM `ms` milliseconds of audio decodes to at that rate. */
export function pcmBytesForMs(ms: number): number {
  return Math.ceil((ms / 1000) * PEAK_DECODE_SAMPLE_RATE * 2);
}

/**
 * Ceiling on the raw PCM this pulls into memory, sized against the real worst
 * case rather than picked round.
 *
 * The decode below is mono 8 kHz s16 — 16 000 bytes per second — and its input
 * is the Opus rendition of a source already capped at `MAX_SOURCE_DURATION_MS`
 * (30 minutes). So the largest legitimate payload is 28.8 MB, and 64 MiB is
 * 2.2x that. `peaks.test.ts` pins the relationship in both directions, because
 * raising the duration cap without raising this would ENOBUFS every long
 * asset, and raising this without thinking would put the pod back over budget.
 *
 * The previous 256 MiB was 9x the largest thing that can ever arrive, and it
 * was not free: `execFile` accumulates chunks and `Buffer.concat`s them, so
 * peak RSS is about TWICE the buffer's contents — 512 MiB at the old ceiling,
 * inside a pod limited to 768Mi that is also holding a rendition for upload.
 * The cap can still only be reached by something that is already a bug, but
 * reaching it now costs 128 MiB transient instead of 512 MiB.
 */
export const MAX_PCM_BYTES = 64 * 1024 * 1024;

/** The worker pod's memory limit (deploy/charts/cartyx/values.yaml). */
export const POD_MEMORY_LIMIT_BYTES = 768 * 1024 * 1024;

/**
 * Decode to mono 8kHz PCM and reduce to `buckets` normalized (0..1) peak
 * magnitudes. Drives the waveform UI without the browser fetching any audio.
 */
export function extractPeaks(path: string, buckets: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        path,
        '-ac',
        '1',
        '-ar',
        String(PEAK_DECODE_SAMPLE_RATE),
        '-f',
        's16le',
        '-',
      ],
      // Same wall-clock cap as ffmpeg.ts's calls — a hang here wedges the
      // single sequential worker loop (and therefore reapStale) just as
      // completely. See `childProcOptions`.
      { encoding: 'buffer', maxBuffer: MAX_PCM_BYTES, ...childProcOptions() },
      (err, stdout) => {
        if (err) return reject(err);

        const pcm = stdout as unknown as Buffer;
        const samples = Math.floor(pcm.length / 2);
        if (samples === 0) return resolve(new Array<number>(buckets).fill(0));

        // Bucket boundaries are computed proportionally rather than as a fixed
        // `Math.floor(samples / buckets)` stride, which had two failure modes:
        //
        // - It covered only `per * buckets` samples and silently dropped the
        //   remaining `samples % buckets` — up to `buckets - 1` samples, ~50 ms
        //   at this 8 kHz decode rate. Measured on a 16 399-sample file whose
        //   final 400 samples are full scale: the waveform peaked at 0.33
        //   instead of 0.98, i.e. the marker was invisible.
        // - When `samples < buckets` the stride clamped to 1, so buckets past
        //   `samples` were never written and stayed 0. Measured: a 20 ms file
        //   filled 159 of 400 buckets and rendered as a waveform that stops
        //   40% of the way across and is flat after.
        //
        // Now every sample lands in exactly one bucket (the boundaries tile
        // [0, samples) with no gap), and a bucket that would otherwise be
        // empty borrows the single sample at its start, so a short file
        // renders across the full width instead of trailing off into fake
        // silence.
        const out: number[] = [];
        for (let b = 0; b < buckets; b++) {
          const start = Math.floor((b * samples) / buckets);
          const end = Math.max(start + 1, Math.floor(((b + 1) * samples) / buckets));
          let peak = 0;
          for (let i = start; i < Math.min(end, samples); i++) {
            const v = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
            if (v > peak) peak = v;
          }
          out.push(Number(peak.toFixed(4)));
        }
        resolve(out);
      }
    );
    child.on('error', reject);
  });
}
