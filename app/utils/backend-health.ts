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
  /**
   * Optional hook into the browser's online/offline signal (e.g. TanStack
   * Query's onlineManager). A laptop wake / Wi-Fi switch fires `online` even
   * while the breaker is open, which would otherwise un-pause queries and
   * mutations against a backend we already know is down.
   */
  subscribeOnline?: (listener: (online: boolean) => void) => void;
  /**
   * Upper bound on how long a recovery probe is allowed to hang before it's
   * treated as failed. A probe stuck on a dead connection (no timeout of its
   * own) would otherwise stall the breaker's entire backoff schedule.
   * Defaults to 10s.
   */
  probeTimeoutMs?: number;
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
  const probeTimeoutMs = deps.probeTimeoutMs ?? 10_000;

  function notify() {
    for (const listener of listeners) listener();
  }

  function scheduleProbe() {
    setTimeout(() => void runProbe(), breaker.probeDelayMs());
  }

  // Races the probe against a deadline. If the deadline wins, the probe is
  // treated as failed; a stale probe that later settles is ignored (guarded
  // by `settled`) so it can't resolve twice or flip breaker state after the
  // fact.
  function raceProbeWithTimeout(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, probeTimeoutMs);
      deps.probe().then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          resolve(true);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          resolve(false);
        }
      );
    });
  }

  async function runProbe() {
    try {
      breaker.beginProbe();
      const ok = await raceProbeWithTimeout();
      if (breaker.resolveProbe(ok) === 'closed') {
        // Compute downtime before mutating the snapshot below, then run all
        // state/side effects before telemetry: a throwing `capture` must not
        // strand the breaker resolved-closed while our own snapshot/
        // onlineManager/waiters still think it's down.
        const downtimeMs = snapshot.downSinceMs === null ? 0 : deps.now() - snapshot.downSinceMs;
        const probeAttempts = breaker.probeAttempts();
        snapshot = { down: false, downSinceMs: null };
        deps.setOnline(true);
        const waiters = upWaiters;
        upWaiters = [];
        for (const resolve of waiters) resolve();
        notify();
        try {
          deps.capture('backend_circuit_closed', {
            downtime_ms: downtimeMs,
            probe_attempts: probeAttempts,
          });
        } catch {
          // Telemetry failures must not affect breaker state; the breaker is
          // already resolved-closed and its side effects already ran above.
        }
      } else {
        scheduleProbe();
      }
    } catch {
      // A throwing side effect (capture/setOnline/breaker call) must not
      // become an unhandled rejection that strands the breaker open with no
      // probe scheduled — fall back to rescheduling on the existing backoff.
      // Only do so if the breaker is still open: if it already closed, a
      // side effect throwing after the fact must not spin up a perpetual
      // no-op probe timer.
      if (breaker.state() === 'open') scheduleProbe();
    }
  }

  if (deps.subscribeOnline) {
    deps.subscribeOnline((online) => {
      if (online && snapshot.down) deps.setOnline(false);
    });
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
      probe: () => healthCheck({ signal: AbortSignal.timeout(10_000) }),
      setOnline: (online) => onlineManager.setOnline(online),
      capture: captureEvent,
      now: () => Date.now(),
      subscribeOnline: (listener) => {
        onlineManager.subscribe(() => listener(onlineManager.isOnline()));
      },
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
