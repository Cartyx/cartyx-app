import { describe, it, expect } from 'vitest';
import {
  MAX_PCM_BYTES,
  POD_MEMORY_LIMIT_BYTES,
  PEAK_DECODE_SAMPLE_RATE,
  WORST_CASE_PCM_BYTES,
  pcmBytesForMs,
} from '../src/peaks.js';
import { MAX_SOURCE_DURATION_MS } from '../src/process.js';

/**
 * B9 — `maxBuffer` was 256 MiB of raw PCM in a pod limited to 768Mi, and
 * `execFile` concatenates its chunks, so peak RSS is roughly twice the buffer's
 * contents. These assertions pin the ceiling to the two facts that actually
 * bound it, so neither can move without the other being reconsidered.
 *
 * They only MEAN anything because `extractPeaks` now carries the duration bound
 * itself. When it did not, this file asserted a relationship between two
 * constants while the decode they described was unbounded — measured, a 12.7 MB
 * source produced 48 MB of PCM against a "worst case" of 28.8 MB. The arithmetic
 * was right and the premise was false, which is the least useful kind of test.
 * `source-guards.test.ts` asserts that the bound is actually applied.
 */
describe('peak-decode memory ceiling', () => {
  it('derives the worst case from the decode format', () => {
    // Mono s16 at 8 kHz = 16 000 bytes per second.
    expect(pcmBytesForMs(1000)).toBe(PEAK_DECODE_SAMPLE_RATE * 2);
  });

  it('states the worst case as a number, from the bound rather than from prose', () => {
    // 1800 s x 16 000 B/s. This is the ceiling `extractPeaks`'s own
    // `atrim=end=RENDER_LIMIT_SECONDS` imposes, not an assumption about what
    // its caller hands it.
    expect(WORST_CASE_PCM_BYTES).toBe(28_800_000);
    expect(WORST_CASE_PCM_BYTES).toBe(pcmBytesForMs(MAX_SOURCE_DURATION_MS));
  });

  it('is large enough for the longest source the pipeline accepts', () => {
    // Raising MAX_SOURCE_DURATION_MS without raising this would ENOBUFS every
    // long asset — a failure that looks like a corrupt file, not a config bug.
    const worstCase = pcmBytesForMs(MAX_SOURCE_DURATION_MS);
    expect(worstCase).toBeLessThan(MAX_PCM_BYTES);
  });

  it('is not so large that hitting it can OOM the pod', () => {
    // Transient peak is ~2x the buffer (chunks + Buffer.concat), and the pod is
    // simultaneously holding a rendition for upload plus the Node baseline.
    expect(MAX_PCM_BYTES * 2).toBeLessThan(POD_MEMORY_LIMIT_BYTES / 2);
  });

  it('keeps at least 2x headroom over the worst legitimate payload', () => {
    expect(MAX_PCM_BYTES / pcmBytesForMs(MAX_SOURCE_DURATION_MS)).toBeGreaterThan(2);
  });
});
