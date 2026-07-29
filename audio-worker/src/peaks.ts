import { execFile } from 'node:child_process';
import { childProcOptions } from './ffmpeg.js';

/**
 * Decode to mono 8kHz PCM and reduce to `buckets` normalized (0..1) peak
 * magnitudes. Drives the waveform UI without the browser fetching any audio.
 */
export function extractPeaks(path: string, buckets: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      ['-v', 'error', '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
      // Same wall-clock cap as ffmpeg.ts's calls — a hang here wedges the
      // single sequential worker loop (and therefore reapStale) just as
      // completely. See `childProcOptions`.
      { encoding: 'buffer', maxBuffer: 1024 * 1024 * 256, ...childProcOptions() },
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
