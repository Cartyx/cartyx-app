import { describe, it, expect } from 'vitest';
import { createCircuitBreaker } from '~/utils/circuit-breaker';

describe('createCircuitBreaker', () => {
  it('starts closed and stays closed below the threshold', () => {
    const cb = createCircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) expect(cb.recordFailure(i)).toBeNull();
    expect(cb.state()).toBe('closed');
    expect(cb.consecutiveFailures()).toBe(4);
  });

  it('opens on the Nth consecutive failure and reports it', () => {
    const cb = createCircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) cb.recordFailure(i);
    expect(cb.recordFailure(100)).toBe('opened');
    expect(cb.state()).toBe('open');
    expect(cb.openedAtMs()).toBe(100);
  });

  it('a success resets the consecutive count', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure(0);
    cb.recordFailure(1);
    cb.recordSuccess();
    cb.recordFailure(2);
    cb.recordFailure(3);
    expect(cb.state()).toBe('closed');
    expect(cb.recordFailure(4)).toBe('opened');
  });

  it('failures while open or half-open are no-ops', () => {
    const cb = createCircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure(0);
    expect(cb.recordFailure(1)).toBeNull();
    cb.beginProbe();
    expect(cb.recordFailure(2)).toBeNull();
    expect(cb.state()).toBe('half-open');
  });

  it('probe backoff doubles per failed probe and is capped', () => {
    const cb = createCircuitBreaker({
      failureThreshold: 1,
      initialProbeDelayMs: 5_000,
      probeBackoffFactor: 2,
      maxProbeDelayMs: 60_000,
    });
    cb.recordFailure(0);
    expect(cb.probeDelayMs()).toBe(5_000);
    for (const expected of [10_000, 20_000, 40_000, 60_000, 60_000]) {
      cb.beginProbe();
      expect(cb.resolveProbe(false)).toBe('open');
      expect(cb.probeDelayMs()).toBe(expected);
    }
    expect(cb.probeAttempts()).toBe(5);
  });

  it('a successful probe closes the breaker and resets failure state', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2 });
    cb.recordFailure(0);
    cb.recordFailure(1);
    cb.beginProbe();
    expect(cb.resolveProbe(true)).toBe('closed');
    expect(cb.state()).toBe('closed');
    expect(cb.consecutiveFailures()).toBe(0);
    expect(cb.openedAtMs()).toBeNull();
    // probeAttempts retained for telemetry until the next open
    expect(cb.probeAttempts()).toBe(1);
  });

  it('re-opening after a recovery starts a fresh probe schedule', () => {
    const cb = createCircuitBreaker({ failureThreshold: 1, initialProbeDelayMs: 5_000 });
    cb.recordFailure(0);
    cb.beginProbe();
    cb.resolveProbe(false); // backoff now 10s
    cb.beginProbe();
    cb.resolveProbe(true); // closed
    cb.recordFailure(100); // re-opened
    expect(cb.probeDelayMs()).toBe(5_000);
    expect(cb.probeAttempts()).toBe(0);
  });

  it('guards invalid transitions', () => {
    const cb = createCircuitBreaker();
    expect(() => cb.beginProbe()).toThrow();
    expect(() => cb.resolveProbe(true)).toThrow();
  });
});
