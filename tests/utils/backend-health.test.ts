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

  describe('probe timeout', () => {
    it('treats a probe that never settles as failed after probeTimeoutMs, then backs off and stays open', async () => {
      const releaseProbes: Array<() => void> = [];
      const probe = vi.fn(
        () =>
          new Promise((resolve) => {
            releaseProbes.push(() => resolve({ ok: true }));
          })
      );
      const deps = makeDeps({ probe, probeTimeoutMs: 10_000 });
      const health = createBackendHealth(deps);
      for (let i = 0; i < 5; i++) health.reportFailure(networkError());

      await vi.advanceTimersByTimeAsync(5_000); // first probe fires (hangs)
      expect(probe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000); // probe timeout elapses -> treated as failed
      expect(health.isDown()).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000); // next probe scheduled per backoff (10s)
      expect(probe).toHaveBeenCalledTimes(2);
      expect(health.isDown()).toBe(true);

      // The stale first probe resolving after its timeout must not close the
      // breaker, even though a second probe is now legitimately in flight.
      releaseProbes[0]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(health.isDown()).toBe(true);
    });

    it('behaves normally when the probe settles well within the timeout (2s)', async () => {
      const probe = vi.fn(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 2_000))
      );
      const deps = makeDeps({ probe, probeTimeoutMs: 10_000 });
      const health = createBackendHealth(deps);
      for (let i = 0; i < 5; i++) health.reportFailure(networkError());

      await vi.advanceTimersByTimeAsync(5_000); // probe begins
      await vi.advanceTimersByTimeAsync(2_000); // probe resolves well before the timeout
      expect(health.isDown()).toBe(false);
    });

    it('defaults probeTimeoutMs to 10s when not provided', async () => {
      const probe = vi.fn(() => new Promise(() => {})); // never settles
      const deps = makeDeps({ probe });
      const health = createBackendHealth(deps);
      for (let i = 0; i < 5; i++) health.reportFailure(networkError());

      await vi.advanceTimersByTimeAsync(5_000); // probe begins
      await vi.advanceTimersByTimeAsync(9_999);
      expect(probe).toHaveBeenCalledTimes(1); // still within default timeout, no reschedule yet
      await vi.advanceTimersByTimeAsync(1);
      // timeout elapsed -> probe treated as failed -> resolveProbe(false) -> stays open,
      // backoff reschedules (10s) without throwing.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(probe).toHaveBeenCalledTimes(2);
      expect(health.isDown()).toBe(true);
    });

    it('does not reschedule when a side effect throws after the breaker already closed (freebie)', async () => {
      const probe = vi.fn().mockResolvedValue({ ok: true });
      const capture = vi.fn((event: string) => {
        if (event === 'backend_circuit_closed') throw new Error('capture boom');
      });
      const deps = makeDeps({ probe, capture });
      const health = createBackendHealth(deps);
      for (let i = 0; i < 5; i++) health.reportFailure(networkError());

      await vi.advanceTimersByTimeAsync(5_000); // probe fires, succeeds, capture throws
      expect(probe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000); // no perpetual reschedule
      expect(probe).toHaveBeenCalledTimes(1);
    });
  });

  describe('browser online events while the breaker is open', () => {
    it('re-asserts offline when the browser fires online while the breaker is open', () => {
      let onlineListener: ((online: boolean) => void) | undefined;
      const deps = makeDeps({
        subscribeOnline: (listener) => {
          onlineListener = listener;
        },
      });
      const health = createBackendHealth(deps);

      for (let i = 0; i < 5; i++) health.reportFailure(networkError());
      expect(deps.setOnline).toHaveBeenLastCalledWith(false);
      (deps.setOnline as ReturnType<typeof vi.fn>).mockClear();

      // Simulate a laptop wake / Wi-Fi switch firing the browser's online event.
      onlineListener?.(true);

      expect(deps.setOnline).toHaveBeenCalledWith(false);
      expect(health.isDown()).toBe(true);
    });

    it('does not force offline from the online subscription when the breaker is closed', () => {
      let onlineListener: ((online: boolean) => void) | undefined;
      const deps = makeDeps({
        subscribeOnline: (listener) => {
          onlineListener = listener;
        },
      });
      const health = createBackendHealth(deps);

      onlineListener?.(true);

      expect(deps.setOnline).not.toHaveBeenCalled();
      expect(health.isDown()).toBe(false);
    });
  });
});
