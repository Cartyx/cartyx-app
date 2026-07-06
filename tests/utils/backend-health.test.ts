// tests/utils/backend-health.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// backend-health imports the healthCheck RPC wrapper at module level for the
// production singleton; stub it so this test never evaluates rpc.ts.
vi.mock('~/server/functions/rpc', () => ({ healthCheck: vi.fn() }));

import { createBackendHealth, type BackendHealthDeps } from '~/utils/backend-health';

function makeDeps(overrides: Partial<BackendHealthDeps> = {}) {
  return {
    probe: vi.fn().mockResolvedValue({ ok: true }),
    setOnline: vi.fn(),
    capture: vi.fn(),
    now: () => Date.now(),
    ...overrides,
  };
}

function networkError() {
  return new TypeError('Failed to fetch');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createBackendHealth', () => {
  it('opens after 5 consecutive infrastructure failures: goes offline, notifies, captures one event', () => {
    const deps = makeDeps();
    const health = createBackendHealth(deps);
    const listener = vi.fn();
    health.subscribe(listener);

    for (let i = 0; i < 5; i++) health.reportFailure(networkError());

    expect(health.isDown()).toBe(true);
    expect(deps.setOnline).toHaveBeenCalledExactlyOnceWith(false);
    expect(deps.capture).toHaveBeenCalledExactlyOnceWith('backend_circuit_opened', {
      consecutive_failures: 5,
      trigger_error_name: 'TypeError',
    });
    expect(listener).toHaveBeenCalled();
  });

  it('ignores application errors entirely', () => {
    const deps = makeDeps();
    const health = createBackendHealth(deps);
    for (let i = 0; i < 10; i++) health.reportFailure(new Error('not found'));
    expect(health.isDown()).toBe(false);
    expect(deps.setOnline).not.toHaveBeenCalled();
  });

  it('a success between failures prevents tripping', () => {
    const deps = makeDeps();
    const health = createBackendHealth(deps);
    for (let i = 0; i < 4; i++) health.reportFailure(networkError());
    health.reportSuccess();
    for (let i = 0; i < 4; i++) health.reportFailure(networkError());
    expect(health.isDown()).toBe(false);
  });

  it('recovers via probe: goes back online and captures downtime', async () => {
    const deps = makeDeps();
    const health = createBackendHealth(deps);
    for (let i = 0; i < 5; i++) health.reportFailure(networkError());
    (deps.capture as ReturnType<typeof vi.fn>).mockClear();

    await vi.advanceTimersByTimeAsync(5_000); // first probe fires and succeeds

    expect(health.isDown()).toBe(false);
    expect(deps.setOnline).toHaveBeenLastCalledWith(true);
    expect(deps.capture).toHaveBeenCalledExactlyOnceWith('backend_circuit_closed', {
      downtime_ms: 5_000,
      probe_attempts: 1,
    });
  });

  it('failed probes back off (5s, 10s, 20s...) and stay down', async () => {
    const probe = vi.fn().mockRejectedValue(networkError());
    const deps = makeDeps({ probe });
    const health = createBackendHealth(deps);
    for (let i = 0; i < 5; i++) health.reportFailure(networkError());

    await vi.advanceTimersByTimeAsync(5_000);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(health.isDown()).toBe(true);

    probe.mockResolvedValue({ ok: true });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(health.isDown()).toBe(false);
  });

  it('whenUp resolves immediately when up and on recovery when down', async () => {
    const deps = makeDeps();
    const health = createBackendHealth(deps);
    await expect(health.whenUp()).resolves.toBeUndefined();

    for (let i = 0; i < 5; i++) health.reportFailure(networkError());
    const resolved = vi.fn();
    void health.whenUp().then(resolved);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000); // probe succeeds
    expect(resolved).toHaveBeenCalled();
  });

  it('getSnapshot returns a stable reference between transitions', () => {
    const health = createBackendHealth(makeDeps());
    const a = health.getSnapshot();
    expect(health.getSnapshot()).toBe(a);
    for (let i = 0; i < 5; i++) health.reportFailure(networkError());
    const b = health.getSnapshot();
    expect(b).not.toBe(a);
    expect(b).toEqual({ down: true, downSinceMs: 0 });
    expect(health.getSnapshot()).toBe(b);
  });
});
