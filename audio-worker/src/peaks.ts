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

        const per = Math.max(1, Math.floor(samples / buckets));
        const out: number[] = [];
        for (let b = 0; b < buckets; b++) {
          let peak = 0;
          const start = b * per;
          for (let i = start; i < Math.min(start + per, samples); i++) {
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
