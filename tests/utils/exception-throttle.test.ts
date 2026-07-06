import { describe, it, expect } from 'vitest';
import { createExceptionThrottle } from '~/utils/exception-throttle';

// The throttle is pure (time is passed in), so no fake timers are needed.
const SEC = 1000;
const MIN = 60 * SEC;

describe('createExceptionThrottle', () => {
  it('captures the first occurrence of a key', () => {
    const throttle = createExceptionThrottle();
    expect(throttle.check('Error:boom', 0).capture).toBe(true);
  });

  it('drops rapid repeats within the throttle window but keeps counting occurrences', () => {
    const throttle = createExceptionThrottle({ throttleMs: 5 * SEC });
    expect(throttle.check('Error:boom', 0).capture).toBe(true);
    for (let t = 10; t < 5 * SEC; t += 100) {
      expect(throttle.check('Error:boom', t).capture).toBe(false);
    }
    const next = throttle.check('Error:boom', 5 * SEC);
    expect(next.capture).toBe(true);
    expect(next.occurrences).toBeGreaterThan(2);
  });

  it('still captures periodic repeats after an initial burst (cap counts captures, not occurrences)', () => {
    // Regression: a burst of >20 occurrences in the first window must NOT
    // permanently silence the key — that was the original bug.
    const throttle = createExceptionThrottle({ throttleMs: 5 * SEC, maxCapturesPerWindow: 20 });
    let captured = 0;
    for (let i = 0; i < 30; i++) {
      if (throttle.check('Error:storm', i * 10).capture) captured++;
    }
    expect(captured).toBe(1);
    // The same error keeps recurring once a minute — it must still be reported.
    for (let i = 1; i <= 10; i++) {
      if (throttle.check('Error:storm', i * MIN).capture) captured++;
    }
    expect(captured).toBe(11);
  });

  it('caps forwarded captures per window even when spaced beyond the throttle gap', () => {
    const throttle = createExceptionThrottle({ throttleMs: 5 * SEC, maxCapturesPerWindow: 20 });
    let captured = 0;
    for (let i = 0; i < 100; i++) {
      if (throttle.check('Error:persistent', i * 6 * SEC).capture) captured++;
    }
    expect(captured).toBe(20);
  });

  it('resets the cap after the cap window elapses instead of muting forever', () => {
    const throttle = createExceptionThrottle({
      throttleMs: 5 * SEC,
      maxCapturesPerWindow: 20,
      capWindowMs: 60 * MIN,
    });
    for (let i = 0; i < 30; i++) throttle.check('Error:outage', i * 6 * SEC);
    expect(throttle.check('Error:outage', 30 * 6 * SEC).capture).toBe(false);
    // A later, genuinely new incident with the same key surfaces again.
    expect(throttle.check('Error:outage', 61 * MIN).capture).toBe(true);
  });

  it('flags the final allowed capture before suppression begins', () => {
    const throttle = createExceptionThrottle({ throttleMs: 0, maxCapturesPerWindow: 3 });
    expect(throttle.check('Error:capped', 1).capped).toBeUndefined();
    expect(throttle.check('Error:capped', 2).capped).toBeUndefined();
    expect(throttle.check('Error:capped', 3).capped).toBe(true);
    expect(throttle.check('Error:capped', 4).capture).toBe(false);
  });

  it('throttles distinct keys independently', () => {
    const throttle = createExceptionThrottle();
    expect(throttle.check('Error:a', 0).capture).toBe(true);
    expect(throttle.check('Error:b', 0).capture).toBe(true);
  });

  it('reports cumulative occurrences for the key', () => {
    const throttle = createExceptionThrottle({ throttleMs: 5 * SEC });
    throttle.check('Error:counted', 0);
    throttle.check('Error:counted', 10);
    throttle.check('Error:counted', 20);
    const res = throttle.check('Error:counted', 6 * SEC);
    expect(res.capture).toBe(true);
    expect(res.occurrences).toBe(4);
  });

  it('bounds the number of tracked keys by evicting the oldest', () => {
    const throttle = createExceptionThrottle({ maxKeys: 3 });
    throttle.check('Error:1', 0);
    throttle.check('Error:2', 0);
    throttle.check('Error:3', 0);
    throttle.check('Error:4', 0); // evicts Error:1
    expect(throttle.size()).toBe(3);
    // Error:1 was evicted, so it is treated as new again (captured, count restarts).
    const res = throttle.check('Error:1', 1);
    expect(res.capture).toBe(true);
    expect(res.occurrences).toBe(1);
  });
});
