import { describe, it, expect } from 'vitest';
import {
  MAX_SOURCE_DURATION_MS,
  maxDurationShortfallMs,
  assertHeaderUsable,
  assertDecodedUsable,
  assertRenditionComplete,
} from '../src/process.js';
import { PermanentError } from '../src/errors.js';

/**
 * The source-rejection rules on their own, fed the numbers that were measured
 * off real files (see media.integration.test.ts for the files themselves).
 * These are the rules that decide a failure is PERMANENT, so each one is worth
 * pinning independently of the ffmpeg run that produces its inputs.
 */
describe('assertHeaderUsable', () => {
  it('rejects a header claiming more than the cap, permanently and readably', () => {
    // 50 MB of minimum-bitrate audio decodes to ~18 h. The cost of getting this
    // wrong is the whole worker pinned for as long as the ffmpeg timeout allows,
    // per attempt, on a single-node cluster.
    expect(() => assertHeaderUsable({ durationMs: 18 * 60 * 60 * 1000 })).toThrow(PermanentError);
    expect(() => assertHeaderUsable({ durationMs: MAX_SOURCE_DURATION_MS + 1 })).toThrow(
      /over the 30 minute limit/i
    );
  });

  it('admits a source exactly at the cap', () => {
    expect(() => assertHeaderUsable({ durationMs: MAX_SOURCE_DURATION_MS })).not.toThrow();
  });
});

describe('assertDecodedUsable', () => {
  it('rejects a file with no samples', () => {
    // The 44-byte WAV: valid `fmt `, empty `data`. It transcoded cleanly into
    // two header-only renditions and published as `ready`.
    expect(() => assertDecodedUsable({ samples: 0, peakDb: -20 })).toThrow(/no audio samples/i);
    expect(() => assertDecodedUsable({ samples: 0, peakDb: -20 })).toThrow(PermanentError);
  });

  it('rejects digital silence', () => {
    expect(() =>
      assertDecodedUsable({ samples: 96_000, peakDb: Number.NEGATIVE_INFINITY })
    ).toThrow(/completely silent/i);
  });

  it('admits a very quiet but audible file', () => {
    // -84 dBFS, measured on the -69 dB fixture. Quiet is not silent, and
    // loudnorm handles it fine — this must never be swept up with the
    // NaN-producing all-zero case.
    expect(() => assertDecodedUsable({ samples: 96_000, peakDb: -84.288134 })).not.toThrow();
  });

  it('rejects a decoded length over the cap even when the header under-reported', () => {
    // The header is an unverified claim. Without this second check a source
    // whose container lies short walks straight past assertHeaderUsable.
    const samples = (MAX_SOURCE_DURATION_MS / 1000 + 60) * 48_000;
    expect(() => assertDecodedUsable({ samples, peakDb: -12 })).toThrow(/minute limit/i);
  });

  it('returns the sample count untouched and a millisecond value derived from it', () => {
    const result = assertDecodedUsable({ samples: 96_313, peakDb: -12 });
    expect(result.durationSamples).toBe(96_313);
    expect(result.durationMs).toBe(2007);
    // The reverse derivation loses 24 samples here — which is exactly why the
    // sample count is stored rather than recomputed from the milliseconds.
    expect(result.durationMs * 48).not.toBe(result.durationSamples);
  });
});

describe('assertRenditionComplete', () => {
  it('rejects the measured truncations', () => {
    // truncated.mp3: header 2000 ms, opus rendition 799 ms.
    expect(() => assertRenditionComplete(2000, 799, 'opus')).toThrow(/truncated/i);
    expect(() => assertRenditionComplete(2000, 799, 'opus')).toThrow(PermanentError);
    // truncated.flac: header 2000 ms, 199 ms of payload.
    expect(() => assertRenditionComplete(2000, 199, 'aac')).toThrow(/truncated/i);
  });

  it('accepts the measured encoder and container padding', () => {
    // Largest benign header-vs-rendition gap across WAV/MP3/FLAC/Ogg/M4A/ADTS
    // fixtures was 6.5 ms. The 500 ms floor is ~75x that.
    expect(() => assertRenditionComplete(2000, 1993.5, 'opus')).not.toThrow();
    expect(() => assertRenditionComplete(2000, 1500, 'opus')).not.toThrow();
  });

  it('accepts a header that over-reports, which a VBR MP3 with no Xing header does', () => {
    // Measured on a complete, valid file: 6769 ms claimed, 6034 ms real — a 12%
    // over-report. A 10% tolerance would permanently reject a good upload.
    expect(() => assertRenditionComplete(6769, 6034, 'opus')).not.toThrow();
  });

  it('is one-sided: a rendition longer than the header claims is fine', () => {
    // The other half of the VBR-estimate case (28 733 ms claimed, 30 041 ms
    // real). Truncation can only ever shorten.
    expect(() => assertRenditionComplete(28_733, 30_041, 'aac')).not.toThrow();
  });

  it('skips the check when the container carries no duration to compare against', () => {
    expect(() => assertRenditionComplete(0, 5000, 'opus')).not.toThrow();
  });

  it('scales the allowance with the claimed duration', () => {
    expect(maxDurationShortfallMs(0)).toBe(500);
    expect(maxDurationShortfallMs(2000)).toBe(500);
    expect(maxDurationShortfallMs(600_000)).toBe(150_000);
  });
});
