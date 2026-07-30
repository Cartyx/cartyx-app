import { describe, it, expect } from 'vitest';
import {
  MAX_SOURCE_DURATION_MS,
  MAX_RENDITION_SHORTFALL_MS,
  MAX_RENDITION_OVERRUN_MS,
  MEASURE_LIMIT_SECONDS,
  RENDER_LIMIT_SECONDS,
  assertDecodedUsable,
  assertRenditionComplete,
} from '../src/process.js';
import { PermanentError } from '../src/errors.js';
import { boundedDecodeFilters, RENDITION_SAMPLE_RATE } from '../src/ffmpeg.js';
import { PEAK_DECODE_SAMPLE_RATE } from '../src/peaks.js';
import { readFileSync, readdirSync } from 'node:fs';
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

  it('is the same mechanism everywhere: count decoded samples, and cut on the count', () => {
    // Not `-t` and not `atrim=end`, which both cut at a TIMELINE POSITION a
    // container can advance without emitting audio. `end_sample` is an index
    // into the samples the filter has actually been handed, so no timestamp —
    // and therefore nothing the container asserts — can move it.
    expect(boundedDecodeFilters(RENDITION_SAMPLE_RATE, 1801)).toBe(
      'aresample=48000,atrim=end_sample=86448000'
    );
    expect(boundedDecodeFilters(PEAK_DECODE_SAMPLE_RATE, 1800)).toBe(
      'aresample=8000,atrim=end_sample=14400000'
    );
  });

  /**
   * THE MECHANICAL CHECK, and it has to actually be one.
   *
   * Its predecessor counted `boundedDecodeFilters(` against a hard-coded number
   * in a hard-coded two-file list. That catches REMOVING a bound and nothing
   * else: a fourth decoding stage added to either file passed (the count was
   * `toBe`, so it failed — but by demanding the number be edited, which is what
   * a person does without reading), and a decoding stage added in a NEW file
   * escaped the list entirely. The property is "every filter chain that feeds a
   * decode is built from the bound", so assert that, over every source file
   * there is.
   */
  const sourceFiles = readdirSync(join(process.cwd(), 'src')).filter((f) => f.endsWith('.ts'));

  it('builds every audio filter chain in every source file from the bound', () => {
    // Every way ffmpeg can be handed a filter graph. `-af` is what this worker
    // uses; the others are here so that switching to one does not silently
    // leave the check asserting about a form nobody writes any more.
    const filterFlags = /'-(?:af|filter:a|filter_complex|lavfi)'/g;
    const chains: { file: string; arg: string }[] = [];

    for (const file of sourceFiles) {
      const text = src(file);
      for (const match of text.matchAll(filterFlags)) {
        // The argument is the next array element: skip the comma, any comment
        // lines, and whitespace, then take the literal that follows.
        const rest = text.slice(match.index + match[0].length);
        const arg = rest
          .replace(/^,\s*/, '')
          .replace(/^(?:\/\/[^\n]*\n\s*)+/, '')
          .split('\n')[0];
        chains.push({ file, arg });
      }
    }

    // Non-vacuity: analyze, transcode and extractPeaks. If this drops, the
    // regex stopped matching and every assertion below became free.
    expect(chains.length).toBe(3);
    for (const { file, arg } of chains) {
      expect(`${file}: ${arg}`).toMatch(/boundedDecodeFilters\(/);
    }
  });

  it('lets no source file decode outside those chains', () => {
    // The other half: a new stage that spawns ffmpeg WITHOUT a filter flag
    // decodes unbounded and the check above would never see it. Every ffmpeg
    // invocation in the worker must therefore be one of the known three.
    const invocations = sourceFiles.flatMap((file) =>
      [...src(file).matchAll(/'ffmpeg'/g)].map(() => file)
    );
    // ffmpeg.ts's single `runFfmpeg` helper (used by analyze and transcode),
    // and peaks.ts's execFile. ffprobe decodes nothing and is not counted.
    expect(invocations.sort()).toEqual(['ffmpeg.ts', 'peaks.ts']);
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
    expect(() => assertDecodedUsable({ samples, peakDb: -12 })).toThrow(/30 minute limit/i);
  });

  /**
   * The message must not QUOTE a length it does not know.
   *
   * The measuring pass stops at `MEASURE_LIMIT_SECONDS`, so a 45-minute source
   * and a 14-hour one both measure 1 801 000 ms — which rounds to "30 minutes".
   * The old message said "Audio is 30 minutes long, over the 30 minute limit"
   * for every over-cap upload there has ever been, which reads as a broken
   * product and tells the owner nothing. A length is quotable only when the
   * measurement is the whole file.
   */
  it.each([
    ['at the measuring bound, where the length is unknown', MEASURE_LIMIT_SECONDS * 48_000, false],
    ['past the measuring bound', MEASURE_LIMIT_SECONDS * 48_000 + 1, false],
    // Below the bound the measurement IS the file, so the length is real. Only
    // reachable because a multi-segment source's per-segment trims can sum past
    // the cap — which is now refused earlier, so this is the guard staying
    // honest rather than a live path.
    ['below the measuring bound, where it is known', (MAX_SOURCE_DURATION_MS + 500) * 48, true],
  ])('names a length only %s', (_label, samples, quotable) => {
    let message = '';
    try {
      assertDecodedUsable({ samples, peakDb: -12 });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/30 minute limit/i);
    expect(/\bis \d+ minutes? long\b/.test(message)).toBe(quotable);
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

describe('a source that changes format mid-stream is refused on the measurement', () => {
  it('rejects more than one filter-graph segment, permanently, naming the cause', () => {
    expect(() => assertDecodedUsable({ samples: 341_856, peakDb: -12, segments: 3 })).toThrow(
      PermanentError
    );
    expect(() => assertDecodedUsable({ samples: 341_856, peakDb: -12, segments: 30 })).toThrow(
      /changes audio format part way through \(30 segments\)/i
    );
  });

  it('refuses it BEFORE the duration cap, so the message names the real cause', () => {
    // Thirty 60 s segments are exactly 30 minutes of content, but each segment
    // carries its own decoder padding and the trim resets with the graph, so
    // the summed measurement is 86 453 457 samples — 0.11 s past the cap
    // (measured). Checking the cap first would refuse this file with
    // "Audio is 30 minutes long, over the 30 minute limit", which is both
    // unactionable and absurd on its face.
    expect(() => assertDecodedUsable({ samples: 86_453_457, peakDb: -12, segments: 30 })).toThrow(
      /changes audio format/i
    );
    expect(() =>
      assertDecodedUsable({ samples: 86_453_457, peakDb: -12, segments: 30 })
    ).not.toThrow(/minute limit/i);
  });

  it('leaves ordinary single-segment sources alone', () => {
    expect(() => assertDecodedUsable({ samples: 96_000, peakDb: -12, segments: 1 })).not.toThrow();
    // `segments` absent means "not measured", which must not reject anything —
    // `analyze` always supplies it, but the guard has other callers in tests.
    expect(() => assertDecodedUsable({ samples: 96_000, peakDb: -12 })).not.toThrow();
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
  /**
   * THE DIRECTION ROUND 6 SHIPPED IN, which this check could not see at all
   * until now: `decodedMs - renditionMs` is negative for it.
   */
  describe('and is two-sided', () => {
    it('rejects a rendition holding audio the row does not record', () => {
      // The real defect: a row recording 5 025 ms with 1 005 100 ms of
      // renditions behind it. Phase 2 loops on the row, so this plays five
      // seconds of a sixteen-minute track and then loops.
      expect(() => assertRenditionComplete(5025, 1_005_100, 'opus')).toThrow(PermanentError);
      expect(() => assertRenditionComplete(5025, 1_005_100, 'opus')).toThrow(
        /longer than the source/i
      );
      // And the old one-sided rule waved it straight through.
      expect(5025 - 1_005_100).toBeLessThan(MAX_RENDITION_SHORTFALL_MS);
    });

    it('allows the padding loudnorm and the containers really add', () => {
      // Measured, not assumed. The rendition's container duration is the
      // decoded length rounded UP to a whole 100 ms (loudnorm's frame is
      // sample_rate / 10 and the final partial one is padded), plus 6.5 ms of
      // Ogg/Opus pre-skip on the opus leg. Worst observed across the whole
      // fixture corpus: +101 ms.
      expect(() => assertRenditionComplete(4013, 4100, 'aac')).not.toThrow();
      expect(() => assertRenditionComplete(4013, 4106.5, 'opus')).not.toThrow();
      expect(() => assertRenditionComplete(39_606, 39_707, 'opus')).not.toThrow();
      // The structural worst: < 100 ms of frame padding + 6.5 ms + 0.479 ms.
      expect(() => assertRenditionComplete(1000, 1000 + 106.98, 'opus')).not.toThrow();
    });

    it('accommodates the cap rounding without hiding anything real', () => {
      // `assertDecodedUsable` compares Math.round(samples / 48) to the cap, so
      // the largest sample count it accepts is 23 samples past the 86 400 000
      // the render bound cuts at. Pin both edges — the allowance below has to
      // cover this, and the arithmetic that produces it must not drift.
      const justInside = assertDecodedUsable({ samples: 86_400_023, peakDb: -12 });
      expect(justInside.durationSamples - MAX_SOURCE_DURATION_MS * 48).toBe(23);
      expect(justInside.durationMs).toBe(MAX_SOURCE_DURATION_MS);
      expect(() => assertDecodedUsable({ samples: 86_400_024, peakDb: -12 })).toThrow(
        /minute limit/i
      );
      // 23 samples is 0.479 ms, invisible at the resolution this check works
      // at and four orders of magnitude inside the allowance.
      expect((23 / 48_000) * 1000).toBeLessThan(0.5);
      expect(MAX_RENDITION_OVERRUN_MS).toBeGreaterThan(100 + 6.5 + 0.5);
    });

    it('is asymmetric, and by a margin the real divergence dwarfs', () => {
      expect(MAX_RENDITION_OVERRUN_MS).toBe(250);
      expect(MAX_RENDITION_OVERRUN_MS).toBeLessThan(MAX_RENDITION_SHORTFALL_MS);
      // Four orders of magnitude between the allowance and the thing it catches.
      expect(1_005_100 - 5025).toBeGreaterThan(MAX_RENDITION_OVERRUN_MS * 1000);
    });
  });

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
