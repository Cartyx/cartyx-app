/**
 * Pure circuit-breaker state machine: closed → open → half-open → closed.
 *
 * Time is passed in and no timers are owned here — the caller (see
 * ~/utils/backend-health) schedules probes using `probeDelayMs()`. This keeps
 * the transition logic deterministic and unit-testable, in the same style as
 * ~/utils/exception-throttle.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  initialProbeDelayMs?: number;
  probeBackoffFactor?: number;
  maxProbeDelayMs?: number;
}

export interface CircuitBreaker {
  state(): CircuitState;
  recordFailure(nowMs: number): 'opened' | null;
  recordSuccess(): void;
  probeDelayMs(): number;
  beginProbe(): void;
  resolveProbe(ok: boolean): CircuitState;
  consecutiveFailures(): number;
  probeAttempts(): number;
  openedAtMs(): number | null;
}

export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const {
    failureThreshold = 5,
    initialProbeDelayMs = 5_000,
    probeBackoffFactor = 2,
    maxProbeDelayMs = 60_000,
  } = options;

  let state: CircuitState = 'closed';
  let consecutiveFailures = 0;
  let probeAttempts = 0;
  let probeDelay = initialProbeDelayMs;
  let openedAt: number | null = null;

  return {
    state: () => state,
    consecutiveFailures: () => consecutiveFailures,
    probeAttempts: () => probeAttempts,
    probeDelayMs: () => probeDelay,
    openedAtMs: () => openedAt,

    recordFailure(nowMs) {
      if (state !== 'closed') return null;
      consecutiveFailures++;
      if (consecutiveFailures < failureThreshold) return null;
      state = 'open';
      openedAt = nowMs;
      probeAttempts = 0;
      probeDelay = initialProbeDelayMs;
      return 'opened';
    },

    recordSuccess() {
      if (state === 'closed') consecutiveFailures = 0;
    },

    beginProbe() {
      if (state !== 'open') throw new Error(`beginProbe called in state '${state}'`);
      state = 'half-open';
      probeAttempts++;
    },

    resolveProbe(ok) {
      if (state !== 'half-open') throw new Error(`resolveProbe called in state '${state}'`);
      if (ok) {
        state = 'closed';
        consecutiveFailures = 0;
        openedAt = null;
        return 'closed';
      }
      state = 'open';
      probeDelay = Math.min(probeDelay * probeBackoffFactor, maxProbeDelayMs);
      return 'open';
    },
  };
}
