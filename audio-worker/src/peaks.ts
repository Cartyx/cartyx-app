import { execFile } from 'node:child_process';
import { boundedDecodeFilters, COMPACT_OUTPUT_TIMELINE, childProcOptions } from './ffmpeg.js';
import { MAX_SOURCE_DURATION_MS } from './config.js';

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
 * RE-DERIVED, because the premise the old derivation rested on was not true
 * when it was written. It argued from "the source is capped at 30 minutes, so
 * the largest payload is 28.8 MB" while this decode was BOUNDED BY NOTHING AT
 * ALL: measured, a 12.7 MB source produced 48 MB of PCM here, 1.7x the number
 * the comment called the worst case, and the only reason it did not ENOBUFS is
 * that 48 MB happens to be under 64 MiB. Nothing stopped it being 400 MB.
 *
 * The premise is now enforced rather than assumed. `extractPeaks` takes a
 * REQUIRED `limitSeconds` and runs `boundedDecodeFilters` (ffmpeg.ts), which
 * cuts after that many seconds of DECODED SAMPLES — so the arithmetic below is
 * a fact about the command this file issues, not a hope about its input:
 *
 *   mono s16 at 8 kHz            = 16 000 bytes per second
 *   x MAX_SOURCE_DURATION_MS     = 1800 s
 *   -----------------------------------------------------
 *   largest possible payload     = 28 800 000 bytes (27.5 MiB)
 *
 * That is now a hard ceiling rather than the typical case: `atrim` cuts the
 * stream at the bound, so no input can produce more. `WORST_CASE_PCM_BYTES`
 * below is the number, and `peaks.test.ts` pins it against `MAX_PCM_BYTES` in
 * both directions.
 *
 * 64 MiB is 2.33x the worst case. `execFile` accumulates chunks and
 * `Buffer.concat`s them, so peak RSS is about twice the buffer's CONTENTS —
 * 55 MB transient at the worst legitimate payload, and 128 MiB if the ceiling
 * itself were ever reached, inside a pod limited to 768Mi that is also holding
 * a rendition for upload. (The previous 256 MiB ceiling cost 512 MiB there.)
 * With the bound in place the ceiling is now unreachable by any accepted
 * source; it remains as the backstop for a bug in the bound itself.
 */
export const MAX_PCM_BYTES = 64 * 1024 * 1024;

/**
 * The largest payload this decode can now produce, from the bound rather than
 * from a guess. Exported so the relationship to `MAX_PCM_BYTES` is asserted
 * rather than asserted-about-in-prose.
 */
export const WORST_CASE_PCM_BYTES = pcmBytesForMs(MAX_SOURCE_DURATION_MS);

/** The worker pod's memory limit (deploy/charts/cartyx/values.yaml). */
export const POD_MEMORY_LIMIT_BYTES = 768 * 1024 * 1024;

/**
 * Decode to mono 8kHz PCM and reduce to `buckets` normalized (0..1) peak
 * magnitudes. Drives the waveform UI without the browser fetching any audio.
 *
 * `limitSeconds` is REQUIRED and is the same bound every other decoding stage
 * runs under (`boundedDecodeFilters`, ffmpeg.ts). Its input is a rendition this
 * worker produced, which is already bounded — so this is the third enforcement
 * of a bound that two earlier stages have already applied, and that is the
 * point. The invariant is "no stage decodes more than the cap", not "no stage
 * decodes more than the cap provided the stage before it did its job":
 * `MAX_PCM_BYTES` above is derived from the bound, so it has to be this
 * function's own bound and not an inherited assumption about its caller.
 */
export function extractPeaks(
  path: string,
  buckets: number,
  limitSeconds: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        path,
        // `-map 0:a:0` for the same reason `transcode` needs it: an input with
        // more than one stream must not have its stream picked by ffmpeg's
        // "best stream" heuristic when the filter chain below assumes audio.
        '-map',
        '0:a:0',
        // Same prefix as every other decoding stage, plus the same output
        // compaction `transcode` uses: this writes raw s16le, where a timeline
        // gap would otherwise land as bucket boundaries that do not correspond
        // to the audio's own position. Its input is a rendition this worker
        // already compacted, so the filter is a backstop here rather than a
        // fix — which is the point, per the comment on `limitSeconds` above.
        '-af',
        `${boundedDecodeFilters(PEAK_DECODE_SAMPLE_RATE, limitSeconds)},${COMPACT_OUTPUT_TIMELINE}`,
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
