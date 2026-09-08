import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '~/lib/rate-limit';

// The limiter is pure (time is passed in), so no fake timers are needed.

describe('createRateLimiter', () => {
  it('refills at the stated rate, not merely after "some time"', () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 1, now: () => t });

    // Starting bucket is full: the first check consumes the only token.
    expect(limiter.check('user-1').allowed).toBe(true);

    // Halfway to a full second, only 0.5 tokens have accrued — still refused.
    t = 500;
    expect(limiter.check('user-1').allowed).toBe(false);

    // A millisecond short of a full second: still not quite enough.
    t = 999;
    expect(limiter.check('user-1').allowed).toBe(false);

    // Exactly one second elapsed at 1 token/sec: the bucket now holds 1 token.
    t = 1000;
    expect(limiter.check('user-1').allowed).toBe(true);
  });

  it('lets a burst up to capacity through and refuses the next call', () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 3, refillPerSec: 1, now: () => t });

    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(true);
    // Capacity exhausted, no time has passed to refill anything.
    expect(limiter.check('user-1').allowed).toBe(false);
  });

  it('reports a retryAfterMs accurate enough to act on', () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 2, now: () => t });

    // Drain the burst.
    limiter.check('user-1');
    limiter.check('user-1');
    const refusal = limiter.check('user-1');
    expect(refusal.allowed).toBe(false);
    expect(refusal.retryAfterMs).toBeGreaterThan(0);

    // Waiting exactly the reported delay must be enough to succeed again.
    t += refusal.retryAfterMs;
    expect(limiter.check('user-1').allowed).toBe(true);

    // One millisecond earlier must NOT have been enough — otherwise the
    // reported retryAfterMs would be misleadingly generous. Uses a fresh
    // key so its bucket starts full regardless of how far `t` has moved.
    limiter.check('user-2');
    limiter.check('user-2');
    const refusal2 = limiter.check('user-2');
    t += refusal2.retryAfterMs - 1;
    expect(limiter.check('user-2').allowed).toBe(false);
  });

  it('returns retryAfterMs of 0 whenever a call is allowed', () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 1, now: () => 0 });
    expect(limiter.check('user-1')).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it('throttles distinct keys independently', () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 1, now: () => t });

    expect(limiter.check('user-1').allowed).toBe(true);
    // user-1 is now exhausted, but user-2 has never been seen — unaffected.
    expect(limiter.check('user-1').allowed).toBe(false);
    expect(limiter.check('user-2').allowed).toBe(true);
  });

  it('does not resurrect a refused key as allowed once other keys evict past maxKeys', () => {
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSec: 0.001,
      maxKeys: 3,
      now: () => 0,
    });

    // 'stale' is inserted first and never touched again — it is the true
    // oldest entry and the natural eviction target.
    limiter.check('stale');

    // 'attacker' is inserted next and immediately exhausted (burst of 1,
    // capacity 1) so it is refused from here on.
    limiter.check('attacker');
    expect(limiter.check('attacker').allowed).toBe(false);

    // 'filler' brings the map to maxKeys (3): stale, attacker, filler.
    limiter.check('filler');

    // A brand-new key forces one eviction. It must take the true oldest
    // entry ('stale'), not the more-recently-touched 'attacker'.
    limiter.check('newcomer');

    // 'attacker' must still be tracked and still refused — eviction must
    // not have wiped its bucket and handed it a fresh, full one.
    expect(limiter.check('attacker').allowed).toBe(false);
  });

  it('defaults to a real clock when now is omitted', () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 1 });
    expect(limiter.check('user-1').allowed).toBe(true);
  });

  /**
   * Final-review minor #7: the invariant belongs here rather than in every
   * call site's own env guard. Each of these values would produce a limiter
   * that refuses EVERY call for EVERY key — silently, at request time, long
   * after construction — rather than failing where the mistake was made:
   * `refillPerSec: 0` makes `retryAfterMs` `Infinity` and a bucket that never
   * refills, and `capacity: 0` starts every bucket empty.
   *
   * Enumerated rather than tested with one value, because a guard written as
   * `!refillPerSec` would pass a `0` test and admit `NaN` and negatives.
   */
  it.each([
    ['refillPerSec zero', { capacity: 5, refillPerSec: 0 }],
    ['refillPerSec negative', { capacity: 5, refillPerSec: -1 }],
    ['refillPerSec NaN', { capacity: 5, refillPerSec: Number.NaN }],
    ['capacity zero', { capacity: 0, refillPerSec: 1 }],
    ['capacity negative', { capacity: -5, refillPerSec: 1 }],
    ['capacity NaN', { capacity: Number.NaN, refillPerSec: 1 }],
  ])('refuses to construct a limiter that could never allow anything: %s', (_label, options) => {
    expect(() => createRateLimiter(options)).toThrow(/must be > 0/);
  });
});
