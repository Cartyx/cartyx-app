import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InspectResult } from '~/server/db/inspect';
import type { BootstrapPolicy } from '~/server/db/policy';

const inspectMock = vi.hoisted(() => ({
  syncCollectionsAndIndexes: vi.fn().mockResolvedValue(undefined),
  ensureCollections: vi.fn().mockResolvedValue(undefined),
  inspectIndexes: vi.fn().mockResolvedValue({ diffs: [], ok: true, hasCriticalDrift: false }),
}));

const logMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('~/server/db/inspect', () => inspectMock);
vi.mock('~/server/db/policy', () => ({
  getBootstrapPolicy: vi.fn(),
}));
vi.mock('~/server/utils/logger', () => ({ log: logMock }));

import {
  bootstrapDB,
  isBootstrapped,
  BootstrapError,
  __resetBootstrapForTests,
} from '~/server/db/bootstrap';

/** Helper to build a policy with overrides. */
function makePolicy(overrides: Partial<BootstrapPolicy> = {}): BootstrapPolicy {
  return {
    environment: 'development',
    syncIndexes: true,
    verifyCriticalIndexes: false,
    failOnCriticalDrift: false,
    autoIndex: true,
    timeoutMs: 30_000,
    ...overrides,
  };
}

const devPolicy = makePolicy();

const prodPolicy = makePolicy({
  environment: 'production',
  syncIndexes: false,
  verifyCriticalIndexes: true,
  failOnCriticalDrift: true,
  autoIndex: false,
  timeoutMs: 10_000,
});

const stagingPolicy = makePolicy({
  environment: 'staging',
  syncIndexes: false,
  verifyCriticalIndexes: true,
  failOnCriticalDrift: false,
  autoIndex: false,
  timeoutMs: 15_000,
});

/** An InspectResult with critical drift. */
const criticalDriftResult: InspectResult = {
  diffs: [
    {
      model: 'User',
      collection: 'users',
      missing: [
        { key: { email: 1 }, options: { unique: true, sparse: true }, severity: 'critical' },
      ],
      extra: [],
      optionMismatches: [],
    },
  ],
  ok: false,
  hasCriticalDrift: true,
};

/** An InspectResult with only optional drift. */
const optionalDriftResult: InspectResult = {
  diffs: [
    {
      model: 'User',
      collection: 'users',
      missing: [{ key: { role: 1 }, severity: 'optional' }],
      extra: [],
      optionMismatches: [],
    },
  ],
  ok: false,
  hasCriticalDrift: false,
};

describe('bootstrapDB', () => {
  beforeEach(() => {
    __resetBootstrapForTests();
    inspectMock.syncCollectionsAndIndexes.mockClear().mockResolvedValue(undefined);
    inspectMock.ensureCollections.mockClear().mockResolvedValue(undefined);
    inspectMock.inspectIndexes
      .mockClear()
      .mockResolvedValue({ diffs: [], ok: true, hasCriticalDrift: false });
    logMock.info.mockClear();
    logMock.warn.mockClear();
    logMock.error.mockClear();
    logMock.debug.mockClear();

    // Silence console output during tests by default.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Development policy ──────────────────────────────────────────────

  it('calls syncCollectionsAndIndexes with development policy', async () => {
    await bootstrapDB(devPolicy);
    expect(inspectMock.syncCollectionsAndIndexes).toHaveBeenCalledTimes(1);
    expect(inspectMock.ensureCollections).not.toHaveBeenCalled();
    expect(inspectMock.inspectIndexes).not.toHaveBeenCalled();
    expect(isBootstrapped()).toBe(true);
  });

  // ── Production policy ───────────────────────────────────────────────

  it('calls ensureCollections + inspectIndexes with production policy (no drift)', async () => {
    await bootstrapDB(prodPolicy);
    expect(inspectMock.ensureCollections).toHaveBeenCalledTimes(1);
    expect(inspectMock.inspectIndexes).toHaveBeenCalledTimes(1);
    expect(inspectMock.syncCollectionsAndIndexes).not.toHaveBeenCalled();
    expect(isBootstrapped()).toBe(true);
  });

  it('throws BootstrapError on critical drift in production', async () => {
    inspectMock.inspectIndexes.mockResolvedValueOnce(criticalDriftResult);

    await expect(bootstrapDB(prodPolicy)).rejects.toThrow(BootstrapError);
    expect(isBootstrapped()).toBe(false);
  });

  it('BootstrapError includes environment and actionable details', async () => {
    inspectMock.inspectIndexes.mockResolvedValueOnce(criticalDriftResult);

    try {
      await bootstrapDB(prodPolicy);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BootstrapError);
      const e = err as BootstrapError;
      expect(e.environment).toBe('production');
      expect(e.details).toHaveLength(1);
      expect(e.details[0]).toContain('email');
      expect(e.message).toContain('npm run db:sync');
    }
  });

  it('does not fail on optional-only drift in production', async () => {
    inspectMock.inspectIndexes.mockResolvedValueOnce(optionalDriftResult);
    await bootstrapDB(prodPolicy);
    expect(isBootstrapped()).toBe(true);
  });

  // ── Staging policy ──────────────────────────────────────────────────

  it('warns but succeeds on critical drift in staging', async () => {
    inspectMock.inspectIndexes.mockResolvedValueOnce(criticalDriftResult);

    await bootstrapDB(stagingPolicy);

    expect(isBootstrapped()).toBe(true);
    const warnSpy = vi.mocked(console.warn);
    // First call is structured warning line, subsequent calls are drift details.
    expect(warnSpy.mock.calls[0]![0]).toContain('[bootstrap] warning env=staging action=verify');
    expect(warnSpy.mock.calls[0]![0]).toContain('critical_drift=true');
  });

  // ── Timeout ─────────────────────────────────────────────────────────

  it('times out when bootstrap exceeds timeoutMs', async () => {
    inspectMock.ensureCollections.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500))
    );
    const policy = makePolicy({
      environment: 'production',
      syncIndexes: false,
      verifyCriticalIndexes: true,
      failOnCriticalDrift: true,
      timeoutMs: 50,
    });

    await expect(bootstrapDB(policy)).rejects.toThrow('timed out');
    expect(isBootstrapped()).toBe(false);

    // Timeout errors now flow through structured failure logging with action.
    const errorSpy = vi.mocked(console.error);
    expect(errorSpy.mock.calls.some((c) => c[0].includes('[bootstrap] failure'))).toBe(true);
  });

  it('prevents overlapping bootstrap attempts after timeout', async () => {
    let resolveFirst!: () => void;
    let firstCallCount = 0;
    inspectMock.syncCollectionsAndIndexes.mockImplementation(() => {
      firstCallCount++;
      if (firstCallCount === 1) {
        // First call: slow (will timeout)
        return new Promise<void>((r) => {
          resolveFirst = r;
        });
      }
      // Second call: fast
      return Promise.resolve();
    });

    const slowPolicy = makePolicy({ timeoutMs: 50 });

    // First attempt times out.
    await expect(bootstrapDB(slowPolicy)).rejects.toThrow('timed out');
    expect(isBootstrapped()).toBe(false);

    // Second attempt should wait for the first's underlying work to settle
    // before starting, not race with it.
    const retryPromise = bootstrapDB(devPolicy);

    // Let the first attempt's underlying work finish.
    resolveFirst();

    await retryPromise;
    expect(isBootstrapped()).toBe(true);
    // Both calls should have happened sequentially, not concurrently.
    expect(inspectMock.syncCollectionsAndIndexes).toHaveBeenCalledTimes(2);
  });

  // ── Idempotency & concurrency ───────────────────────────────────────

  it('runs only once per process (idempotent)', async () => {
    await bootstrapDB(devPolicy);
    await bootstrapDB(devPolicy);
    expect(inspectMock.syncCollectionsAndIndexes).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls share the same bootstrap and only run setup once', async () => {
    inspectMock.syncCollectionsAndIndexes.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 50))
    );

    const [r1, r2] = await Promise.all([bootstrapDB(devPolicy), bootstrapDB(devPolicy)]);

    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
    expect(inspectMock.syncCollectionsAndIndexes).toHaveBeenCalledTimes(1);
    expect(isBootstrapped()).toBe(true);
  });

  // ── Error handling ──────────────────────────────────────────────────

  it('does not swallow errors from sync', async () => {
    inspectMock.syncCollectionsAndIndexes.mockRejectedValueOnce(new Error('sync error'));
    await expect(bootstrapDB(devPolicy)).rejects.toThrow('sync error');
  });

  it('retries after a previous failure (bootstrapped flag stays false)', async () => {
    inspectMock.syncCollectionsAndIndexes.mockRejectedValueOnce(new Error('transient'));

    await expect(bootstrapDB(devPolicy)).rejects.toThrow('transient');
    expect(isBootstrapped()).toBe(false);

    await bootstrapDB(devPolicy);
    expect(inspectMock.syncCollectionsAndIndexes).toHaveBeenCalledTimes(2);
    expect(isBootstrapped()).toBe(true);
  });

  // ── Observability ───────────────────────────────────────────────────

  it('does not use console.log for bootstrap lifecycle events', async () => {
    await bootstrapDB(devPolicy);

    // eslint-disable-next-line no-console
    const logSpy = vi.mocked(console.log);
    const bootstrapLogs = logSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[bootstrap]')
    );
    expect(bootstrapLogs).toHaveLength(0);
  });

  it('logs db.bootstrap.start via the structured logger with policy fields, not Umami', async () => {
    await bootstrapDB(devPolicy);

    expect(logMock.info).toHaveBeenCalledWith(
      {
        bootstrap_env: 'development',
        sync_indexes: true,
        verify_critical: false,
        timeout_ms: 30_000,
      },
      'db.bootstrap.start'
    );
  });

  it('logs db.bootstrap.success via log.info on the sync path', async () => {
    await bootstrapDB(devPolicy);

    expect(logMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrap_env: 'development',
        action: 'sync',
        duration_ms: expect.any(Number),
      }),
      'db.bootstrap.success'
    );
  });

  it('logs db.bootstrap.success via log.info on the production verify path', async () => {
    await bootstrapDB(prodPolicy);

    expect(logMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrap_env: 'production',
        action: 'verify',
        duration_ms: expect.any(Number),
        models_checked: 0,
        indexes_ok: true,
      }),
      'db.bootstrap.success'
    );
  });

  it('logs db.bootstrap.failure via log.error with the original error on critical drift in production', async () => {
    inspectMock.inspectIndexes.mockResolvedValueOnce(criticalDriftResult);

    await expect(bootstrapDB(prodPolicy)).rejects.toThrow(BootstrapError);

    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrap_env: 'production',
        action: 'verify',
        missing_indexes: 1,
        critical_drift: true,
        err: expect.any(BootstrapError),
      }),
      'db.bootstrap.failure'
    );
  });

  it('logs db.bootstrap.warning via log.warn on critical drift in staging', async () => {
    inspectMock.inspectIndexes.mockResolvedValueOnce(criticalDriftResult);

    await bootstrapDB(stagingPolicy);

    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrap_env: 'staging',
        action: 'verify',
        missing_indexes: 1,
        critical_drift: true,
      }),
      'db.bootstrap.warning'
    );
  });

  it('logs db.bootstrap.failure via log.error with the original error on timeout', async () => {
    inspectMock.ensureCollections.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500))
    );
    const policy = makePolicy({
      environment: 'production',
      syncIndexes: false,
      verifyCriticalIndexes: true,
      failOnCriticalDrift: true,
      timeoutMs: 50,
    });

    await expect(bootstrapDB(policy)).rejects.toThrow('timed out');

    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrap_env: 'production',
        action: 'ensure_collections',
        err: expect.any(Error),
      }),
      'db.bootstrap.failure'
    );
  });
});
