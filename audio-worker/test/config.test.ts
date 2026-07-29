import { describe, it, expect, afterEach } from 'vitest';
import {
  envMs,
  readWorkerTimings,
  readS3Timeouts,
  maxSourceBytes,
  DEFAULT_POLL_MS,
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  DEFAULT_MAX_SOURCE_BYTES,
  DEFAULT_S3_REQUEST_TIMEOUT_MS,
  DEFAULT_S3_CONNECT_TIMEOUT_MS,
} from '../src/config.js';
import { DEFAULT_CHILD_TIMEOUT_MS } from '../src/ffmpeg.js';

const TIMING_VARS = ['POLL_INTERVAL_MS', 'CLAIM_TIMEOUT_MS', 'UPLOAD_TIMEOUT_MS'] as const;

afterEach(() => {
  delete process.env.TEST_ENV_MS;
  for (const name of TIMING_VARS) delete process.env[name];
});

describe('envMs', () => {
  it('reads a positive numeric value', () => {
    process.env.TEST_ENV_MS = '1234';
    expect(envMs('TEST_ENV_MS', 999)).toBe(1234);
  });

  it('falls back when the variable is absent', () => {
    expect(envMs('TEST_ENV_MS', 999)).toBe(999);
  });

  /**
   * This is the whole reason the helper exists instead of
   * `Number(process.env.X ?? fallback)`: `??` does not fire for an empty string
   * and `Number('')` is 0. Helm renders an empty string for a missing
   * values.yaml key, so this is a reachable production input — and 0 is
   * catastrophic for every duration the worker reads.
   */
  it('falls back for an empty string rather than yielding 0', () => {
    process.env.TEST_ENV_MS = '';
    expect(envMs('TEST_ENV_MS', 999)).toBe(999);
  });

  it.each(['0', '-1', 'abc', 'Infinity', '  '])('falls back for %j', (value) => {
    process.env.TEST_ENV_MS = value;
    expect(envMs('TEST_ENV_MS', 999)).toBe(999);
  });
});

describe('readWorkerTimings', () => {
  it('returns the defaults when nothing is configured', () => {
    expect(readWorkerTimings()).toEqual({
      pollMs: DEFAULT_POLL_MS,
      staleMs: DEFAULT_CLAIM_TIMEOUT_MS,
      uploadStaleMs: DEFAULT_UPLOAD_TIMEOUT_MS,
    });
  });

  it('honours configured values', () => {
    process.env.POLL_INTERVAL_MS = '1000';
    process.env.CLAIM_TIMEOUT_MS = '2000';
    process.env.UPLOAD_TIMEOUT_MS = '3000';
    expect(readWorkerTimings()).toEqual({ pollMs: 1000, staleMs: 2000, uploadStaleMs: 3000 });
  });

  /**
   * The regression this guards. With the naive
   * `Number(process.env.UPLOAD_TIMEOUT_MS ?? 900_000)`, an empty rendered Helm
   * value yields 0 — so `reapStale`'s cutoff becomes `now` and it fails EVERY
   * in-flight upload the instant it starts, and the poll interval becomes a hot
   * loop. Every timing must survive an empty string.
   */
  it('falls back to defaults when the chart renders every key empty', () => {
    for (const name of TIMING_VARS) process.env[name] = '';
    expect(readWorkerTimings()).toEqual({
      pollMs: DEFAULT_POLL_MS,
      staleMs: DEFAULT_CLAIM_TIMEOUT_MS,
      uploadStaleMs: DEFAULT_UPLOAD_TIMEOUT_MS,
    });
  });

  it('keeps the upload cutoff strictly in the past even with an empty value', () => {
    process.env.UPLOAD_TIMEOUT_MS = '';
    // The consequence, stated as the behaviour that matters rather than the
    // number: a 0 here means `now - 0 === now`, which matches every uploading
    // row ever created.
    expect(readWorkerTimings().uploadStaleMs).toBeGreaterThan(0);
  });
});

/**
 * B5 — the claim timeout was 600 s while bounded worst-case processing is seven
 * capped ffmpeg children plus R2 time, so the reaper revoking a HEALTHY
 * worker's claim was what the configuration instructed. Asserted as the
 * RELATIONSHIP, not as a literal: whichever of the two numbers someone changes
 * next, this fails until they have thought about the other.
 */
describe('the claim timeout against real worst-case processing', () => {
  /** probe(src), analyze(src), transcode x2, probe(rendition) x2, extractPeaks. */
  const CAPPED_CHILDREN_PER_ASSET = 7;

  it('clears every capped child process one asset can spawn', () => {
    expect(DEFAULT_CLAIM_TIMEOUT_MS).toBeGreaterThanOrEqual(
      DEFAULT_CHILD_TIMEOUT_MS * CAPPED_CHILDREN_PER_ASSET
    );
  });

  it('leaves headroom for the R2 transfers on top of them', () => {
    const ffmpegBudget = DEFAULT_CHILD_TIMEOUT_MS * CAPPED_CHILDREN_PER_ASSET;
    // One GET plus two rendition PUTs, each retried by the SDK and each bounded
    // by S3_REQUEST_TIMEOUT_MS.
    const r2Budget = DEFAULT_S3_REQUEST_TIMEOUT_MS * 3 * 3;
    expect(DEFAULT_CLAIM_TIMEOUT_MS).toBeGreaterThan(ffmpegBudget + r2Budget);
  });
});

describe('readS3Timeouts', () => {
  afterEach(() => {
    delete process.env.S3_REQUEST_TIMEOUT_MS;
    delete process.env.S3_CONNECT_TIMEOUT_MS;
  });

  it('defaults to bounded values (the SDK has none of its own)', () => {
    expect(readS3Timeouts()).toEqual({
      requestTimeout: DEFAULT_S3_REQUEST_TIMEOUT_MS,
      connectionTimeout: DEFAULT_S3_CONNECT_TIMEOUT_MS,
    });
  });

  it('never yields 0, which the SDK reads as "no timeout"', () => {
    process.env.S3_REQUEST_TIMEOUT_MS = '';
    process.env.S3_CONNECT_TIMEOUT_MS = '0';
    const { requestTimeout, connectionTimeout } = readS3Timeouts();
    expect(requestTimeout).toBeGreaterThan(0);
    expect(connectionTimeout).toBeGreaterThan(0);
  });
});

describe('maxSourceBytes', () => {
  afterEach(() => {
    delete process.env.AUDIO_MAX_BYTES;
  });

  it('matches the app-side AUDIO_MAX_BYTES (app/types/audio.ts) at 50 MB', () => {
    // The two caps describe the same limit at two enforcement points; drift
    // means the worker permanently fails uploads the app happily accepted.
    expect(DEFAULT_MAX_SOURCE_BYTES).toBe(50 * 1024 * 1024);
    expect(maxSourceBytes()).toBe(DEFAULT_MAX_SOURCE_BYTES);
  });

  it('falls back rather than yielding a 0-byte cap that rejects everything', () => {
    process.env.AUDIO_MAX_BYTES = '';
    expect(maxSourceBytes()).toBe(DEFAULT_MAX_SOURCE_BYTES);
  });
});
