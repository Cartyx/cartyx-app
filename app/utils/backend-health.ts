/**
 * Browser-only integration between the circuit breaker and the app.
 *
 * When the breaker opens we flip TanStack Query's onlineManager to offline —
 * that pauses every query refetch and mutation centrally (paused mutations
 * auto-resume on recovery). Recovery is driven by probing the healthCheck
 * server fn on the breaker's backoff schedule. Direct callers that bypass
 * TanStack Query (withRetry, uploadToR2) consult isBackendDown()/whenBackendUp().
 *
 * On the server every facade function is a no-op that reports "up".
 */
import { onlineManager } from '@tanstack/react-query';
import { createCircuitBreaker, type CircuitBreaker } from '~/utils/circuit-breaker';
import { isInfrastructureFailure } from '~/utils/error-classification';
import { captureEvent } from '~/utils/posthog-client';
// ~/server/functions/rpc is the sanctioned client-safe RPC facade (createServerFn
// strips the server body from the client bundle; see rpc.ts header comment), not a
// raw ~/server/* module.
// eslint-disable-next-line no-restricted-imports
import { healthCheck } from '~/server/functions/rpc';

export interface BackendHealthSnapshot {
  down: boolean;
  downSinceMs: number | null;
}

export interface BackendHealthDeps {
  probe: () => Promise<unknown>;
  setOnline: (online: boolean) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  now: () => number;
}

export interface BackendHealth {
  reportFailure(error: unknown): void;
  reportSuccess(): void;
  isDown(): boolean;
  whenUp(): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): BackendHealthSnapshot;
}

const UP_SNAPSHOT: BackendHealthSnapshot = { down: false, downSinceMs: null };

export function createBackendHealth(
  deps: BackendHealthDeps,
  breaker: CircuitBreaker = createCircuitBreaker()
): BackendHealth {
  const listeners = new Set<() => void>();
  let upWaiters: Array<() => void> = [];
  let snapshot: BackendHealthSnapshot = UP_SNAPSHOT;

  function notify() {
    for (const listener of listeners) listener();
  }

  function scheduleProbe() {
    setTimeout(() => void runProbe(), breaker.probeDelayMs());
  }

  async function runProbe() {
    breaker.beginProbe();
    let ok = false;
    try {
      await deps.probe();
      ok = true;
    } catch {
      ok = false;
    }
    if (breaker.resolveProbe(ok) === 'closed') {
      deps.capture('backend_circuit_closed', {
        downtime_ms: snapshot.downSinceMs === null ? 0 : deps.now() - snapshot.downSinceMs,
        probe_attempts: breaker.probeAttempts(),
      });
      snapshot = { down: false, downSinceMs: null };
      deps.setOnline(true);
      const waiters = upWaiters;
      upWaiters = [];
      for (const resolve of waiters) resolve();
      notify();
    } else {
      scheduleProbe();
    }
  }

  return {
    reportFailure(error) {
      if (!isInfrastructureFailure(error)) return;
      if (breaker.recordFailure(deps.now()) !== 'opened') return;
      snapshot = { down: true, downSinceMs: deps.now() };
      deps.setOnline(false);
      deps.capture('backend_circuit_opened', {
        consecutive_failures: breaker.consecutiveFailures(),
        trigger_error_name: error instanceof Error ? error.name : 'unknown',
      });
      scheduleProbe();
      notify();
    },
    reportSuccess() {
      breaker.recordSuccess();
    },
    isDown() {
      return snapshot.down;
    },
    whenUp() {
      if (!snapshot.down) return Promise.resolve();
      return new Promise<void>((resolve) => upWaiters.push(resolve));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

const NOOP_HEALTH: BackendHealth = {
  reportFailure() {},
  reportSuccess() {},
  isDown: () => false,
  whenUp: () => Promise.resolve(),
  subscribe: () => () => {},
  getSnapshot: () => UP_SNAPSHOT,
};

let singleton: BackendHealth | null = null;

function getBackendHealth(): BackendHealth {
  if (typeof window === 'undefined') return NOOP_HEALTH;
  if (!singleton) {
    singleton = createBackendHealth({
      probe: () => healthCheck(),
      setOnline: (online) => onlineManager.setOnline(online),
      capture: captureEvent,
      now: () => Date.now(),
    });
  }
  return singleton;
}

export const reportBackendFailure = (error: unknown): void =>
  getBackendHealth().reportFailure(error);
export const reportBackendSuccess = (): void => getBackendHealth().reportSuccess();
export const isBackendDown = (): boolean => getBackendHealth().isDown();
export const whenBackendUp = (): Promise<void> => getBackendHealth().whenUp();
export const subscribeBackendHealth = (listener: () => void): (() => void) =>
  getBackendHealth().subscribe(listener);
export const getBackendHealthSnapshot = (): BackendHealthSnapshot =>
  getBackendHealth().getSnapshot();
