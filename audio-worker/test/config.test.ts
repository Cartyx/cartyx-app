import { describe, it, expect, afterEach } from 'vitest';
import {
  envMs,
  readWorkerTimings,
  DEFAULT_POLL_MS,
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_UPLOAD_TIMEOUT_MS,
} from '../src/config.js';

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
