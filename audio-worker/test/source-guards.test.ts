import { describe, it, expect } from 'vitest';
import {
  MAX_SOURCE_DURATION_MS,
  MAX_RENDITION_SHORTFALL_MS,
  MEASURE_LIMIT_SECONDS,
  RENDER_LIMIT_SECONDS,
  assertDecodedUsable,
  assertRenditionComplete,
} from '../src/process.js';
import { PermanentError } from '../src/errors.js';
import { boundedDecodeFilters, RENDITION_SAMPLE_RATE } from '../src/ffmpeg.js';
import { PEAK_DECODE_SAMPLE_RATE } from '../src/peaks.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE INVARIANT, asserted on the worker's own source text.
 *
 *   No stage ever decodes more than `MAX_SOURCE_DURATION_MS` of audio, and the
 *   duration recorded on the asset is the one the renditions actually contain.
 *
 * Two rounds of fixes bounded ONE stage and left another unbounded, and both
 * times the code read as if the bound were universal. Nothing but review caught
 * that, and review missed it twice. These tests are the mechanical check:
 * `boundedDecodeFilters` is the only bound, so every `-af`/filter string that
 * feeds a decode must be built from it, and every function that runs one must
 * take the limit as a REQUIRED argument (an optional bound is a bound the next
 * caller omits).
 */
describe('the bound is applied at every stage that decodes', () => {
  const src = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');

  it('is the same mechanism everywhere: rebase onto the sample clock, then trim', () => {
    // Not `-t`, which cuts at a TIMELINE POSITION a container can advance
    // without emitting audio. `asetpts=N/SR/TB` makes each frame's timestamp
    // its decoded-sample index over the rate, so `atrim` cuts on samples.
    expect(boundedDecodeFilters(RENDITION_SAMPLE_RATE, 1801)).toBe(
      'aresample=48000,asetpts=N/SR/TB,atrim=end=1801'
    );
    expect(boundedDecodeFilters(PEAK_DECODE_SAMPLE_RATE, 1800)).toBe(
      'aresample=8000,asetpts=N/SR/TB,atrim=end=1800'
    );
  });

  it.each([
    ['ffmpeg.ts', 2],
    ['peaks.ts', 1],
  ])('builds every decoding filter chain in %s from it', (file, uses) => {
    const text = src(file);
    // `analyze` and `transcode` in ffmpeg.ts; `extractPeaks` in peaks.ts.
    const calls = text.match(/boundedDecodeFilters\(/g) ?? [];
    // One definition site in ffmpeg.ts, plus its uses.
    expect(calls.length).toBe(file === 'ffmpeg.ts' ? uses + 1 : uses);
  });

  it('leaves no `-t` bound anywhere: it is the wrong quantity, not a weaker one', () => {
    for (const file of ['ffmpeg.ts', 'peaks.ts', 'process.ts']) {
      expect(src(file)).not.toMatch(/'-t',/);
    }
  });

  it('makes the limit a required argument of all three, so it cannot be omitted', () => {
    expect(src('ffmpeg.ts')).toMatch(/analyze\(path: string, limitSeconds: number\)/);
    expect(src('ffmpeg.ts')).toMatch(/codec: Codec,\s*\n\s*limitSeconds: number/);
    expect(src('peaks.ts')).toMatch(/buckets: number,\s*\n\s*limitSeconds: number/);
  });

  it('renders under a bound no looser than the one it measures under', () => {
    // A source that PASSES the cap must never produce a rendition longer than
    // the cap, so the rendering bound is the cap itself, while the measuring
    // pass reads one second further to tell "at the cap" from "over" it.
    expect(RENDER_LIMIT_SECONDS * 1000).toBe(MAX_SOURCE_DURATION_MS);
    expect(MEASURE_LIMIT_SECONDS).toBeGreaterThan(RENDER_LIMIT_SECONDS);
  });
});

/**
 * The source-rejection rules on their own, fed the numbers that were measured
 * off real files (see media.integration.test.ts for the files themselves).
 * These are the rules that decide a failure is PERMANENT, so each one is worth
 * pinning independently of the ffmpeg run that produces its inputs.
 *
 * Every input below is a DECODED sample count. Nothing here takes a header
 * duration, and that is the point: the header is an extrapolation for any MP3
 * without a Xing frame, and rejecting on it permanently refused ordinary music.
 */
const SAMPLES_PER_MS = 48;

describe('the duration cap is decided on the decode, and only there', () => {
  it('rejects a decoded length over the cap, permanently and readably', () => {
    const samples = (MAX_SOURCE_DURATION_MS + 60_000) * SAMPLES_PER_MS;
    expect(() => assertDecodedUsable({ samples, peakDb: -12 })).toThrow(PermanentError);
    expect(() => assertDecodedUsable({ samples, peakDb: -12 })).toThrow(
      /over the 30 minute limit/i
    );
  });

  it('admits a source exactly at the cap', () => {
    const samples = MAX_SOURCE_DURATION_MS * SAMPLES_PER_MS;
    expect(() => assertDecodedUsable({ samples, peakDb: -12 })).not.toThrow();
  });

  it('reads one second past the cap, so anything longer is measurably longer', () => {
    // `analyze(src, MEASURE_LIMIT_SECONDS)` stops the decode here. A limit set
    // AT the cap would make an hour-long source measure exactly at the cap and
    // pass; one second past it is the smallest bound that still answers the
    // question, and it is what keeps a 13.9-hour source (50 MB at 8 kbit/s, the
    // worst `AUDIO_MAX_BYTES` allows) to a 0.99 s decode instead of 26.33 s.
    expect(MEASURE_LIMIT_SECONDS * 1000).toBeGreaterThan(MAX_SOURCE_DURATION_MS);
    const atLimit = MEASURE_LIMIT_SECONDS * 1000 * SAMPLES_PER_MS;
    expect(() => assertDecodedUsable({ samples: atLimit, peakDb: -12 })).toThrow(/minute limit/i);
  });

  /**
   * The regression this whole file exists for.
   *
   * `assertHeaderUsable` used to apply the same cap to `probe()`'s duration
   * before anything decoded. These are MEASURED header claims for complete,
   * valid files (ffmpeg 8.1.2), and every one of them is under the cap in
   * reality and over it as claimed — so the header gate rejected all three with
   * "over the 30 minute limit" and stamped them un-retryable.
   */
  it.each([
    ['an honest 17-minute file with a 1 s quiet intro', 2_509_685, 1_021_048],
    ['the same shape scaled to 30 minutes', 4_425_000, 1_800_000],
    ['a file whose intro segment is 32 kbit/s and body 320 kbit/s', 4_800_000, 585_000],
  ])('accepts %s, which the old header gate rejected', (_label, claimedMs, realMs) => {
    // What the old gate did with the claim:
    expect(claimedMs).toBeGreaterThan(MAX_SOURCE_DURATION_MS);
    // What the decode says, which is the only thing consulted now:
    expect(() =>
      assertDecodedUsable({ samples: realMs * SAMPLES_PER_MS, peakDb: -12 })
    ).not.toThrow();
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

  it('returns the sample count untouched and a millisecond value derived from it', () => {
    const result = assertDecodedUsable({ samples: 96_313, peakDb: -12 });
    expect(result.durationSamples).toBe(96_313);
    expect(result.durationMs).toBe(2007);
    // The reverse derivation loses 24 samples here — which is exactly why the
    // sample count is stored rather than recomputed from the milliseconds.
    expect(result.durationMs * 48).not.toBe(result.durationSamples);
  });
});

describe('assertRenditionComplete compares two measurements', () => {
  it('rejects a rendition that lost audio the source really had', () => {
    // Both sides decoded. A gap here means this worker's own ffmpeg leg dropped
    // content while exiting 0 — the only thing left that can strand a `ready`
    // row whose durationSamples its rendition cannot honour.
    expect(() => assertRenditionComplete(60_029, 30_000, 'opus')).toThrow(/incomplete/i);
    expect(() => assertRenditionComplete(60_029, 30_000, 'opus')).toThrow(PermanentError);
  });

  it('accepts the measured encoder and container padding', () => {
    // Across WAV, MP3, FLAC, Matroska/Opus, M4A and ADTS AAC sources in both
    // rendition codecs, the rendition came out LONGER than the decoded source
    // in every case but two; the largest shortfall anywhere was 0.6 ms.
    expect(() => assertRenditionComplete(2000, 2006.5, 'opus')).not.toThrow();
    expect(() => assertRenditionComplete(2026.6, 2026, 'aac')).not.toThrow();
    expect(() => assertRenditionComplete(60_029, 60_106, 'opus')).not.toThrow();
  });

  it('is a flat allowance, because padding does not scale with duration', () => {
    // The predecessor scaled at 25% of the HEADER CLAIM, which on a 30-minute
    // asset waved through nine minutes of missing audio while simultaneously
    // rejecting good short files whose claim was inflated.
    expect(MAX_RENDITION_SHORTFALL_MS).toBe(500);
    expect(() => assertRenditionComplete(1_800_000, 1_799_600, 'aac')).not.toThrow();
    expect(() => assertRenditionComplete(1_800_000, 1_500_000, 'aac')).toThrow(/incomplete/i);
  });

  /**
   * The ship-stopper, stated as arithmetic.
   *
   * These are measured (claim, decoded) pairs for complete, valid MP3s. The old
   * rule compared the rendition — which tracks the DECODED length — against the
   * CLAIM, so it saw a shortfall that was really just the claim being wrong.
   */
  it.each([
    ['1 s quiet intro, 4 s loud body', 10_554, 5042],
    ['32 kbit/s segment joined to a 320 kbit/s segment', 82_506, 10_057],
  ])('does not reject %s, whose header over-reports', (_label, claimedMs, decodedMs) => {
    // The old rule, reproduced verbatim, rejects it:
    const oldAllowance = Math.max(500, claimedMs * 0.25);
    expect(claimedMs - decodedMs).toBeGreaterThan(oldAllowance);
    // The new one compares like with like. Renditions run ~70 ms LONG on these
    // (measured), so pass the decoded length itself as the worst case.
    expect(() => assertRenditionComplete(decodedMs, decodedMs, 'opus')).not.toThrow();
  });
});
