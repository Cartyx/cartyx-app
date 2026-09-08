/**
 * Pure, framework-free token-bucket rate limiter.
 *
 * Each key gets its own bucket that starts full (`capacity` tokens) and
 * refills continuously at `refillPerSec` tokens per second. A `check(key)`
 * call consumes one token if available (`allowed: true`) or, if the bucket
 * is empty, reports how long until one token will exist (`retryAfterMs`).
 * Time is injected via `now` (defaulting to `Date.now`) so callers can drive
 * it deterministically in tests, mirroring `app/utils/exception-throttle.ts`
 * — the shape this module follows.
 *
 * Scope: this is an in-process, in-memory limiter. The web pod currently
 * runs `replicaCount: 1`, so a single process's bucket state is the whole
 * picture and this is honest as a global (or per-key) limit. If the
 * deployment is ever scaled to multiple replicas, each replica gets its own
 * independent buckets — the effective limit becomes per-replica, not
 * cluster-wide. Re-derive this module (e.g. onto a shared store) before
 * relying on it at N>1 replicas.
 */

export interface RateLimiterOptions {
  /** Maximum tokens a bucket can hold — the largest burst a key may pass in one go. */
  capacity: number;
  /** Tokens restored per second, applied continuously based on elapsed time. */
  refillPerSec: number;
  /** Injected clock in milliseconds. Defaults to `Date.now` so callers need not pass one. */
  now?: () => number;
  /**
   * Bound on tracked keys; the oldest key (by first-seen order) is evicted
   * past this. That is a MEMORY BOUND, not a fairness guarantee — see the
   * eviction site in `check` for what "oldest" does and does not mean here.
   */
  maxKeys?: number;
}

export interface RateLimitDecision {
  /** Whether this call may proceed. */
  allowed: boolean;
  /** Milliseconds until this key would next have a token available. Always `0` when `allowed` is `true`. */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSec, now = Date.now, maxKeys = 500 } = options;

  // The invariant lives here rather than at each call site. Both values are
  // divisors or ceilings of the whole mechanism: `refillPerSec <= 0` makes
  // `retryAfterMs` `Infinity` or negative and a bucket that never refills,
  // and `capacity <= 0` makes every bucket start empty, so either one turns
  // a limiter into a permanent refusal for every key — silently, at runtime,
  // long after construction. `~/lib/audio-rate-limits.ts`'s
  // `envPositiveNumber` already guards the two env-configured numbers; this
  // guards the other buckets and any future caller that forgets to.
  if (!Number.isFinite(refillPerSec) || refillPerSec <= 0) {
    throw new Error(`createRateLimiter: refillPerSec must be > 0, got ${refillPerSec}`);
  }
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error(`createRateLimiter: capacity must be > 0, got ${capacity}`);
  }

  const buckets = new Map<string, Bucket>();

  return {
    check(key) {
      const nowMs = now();
      let bucket = buckets.get(key);

      if (!bucket) {
        if (buckets.size >= maxKeys) {
          // Map iteration order is insertion order, so the first key is the
          // oldest — same eviction strategy as exception-throttle.ts.
          //
          // "Oldest" means FIRST SEEN, not least recently used: a key found
          // via `get` below never re-enters insertion order, so an actively
          // throttled key can be evicted and its bucket then re-created at
          // full capacity by its next call. This is a memory bound, not a
          // fairness guarantee, and it is deliberately left that way (it
          // matches `exception-throttle.ts`, and defeating it costs an
          // attacker `maxKeys` distinct authenticated accounts, since the key
          // is a Mongo `_id`). Do not read LRU into the word "oldest".
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
        bucket = { tokens: capacity, lastRefillMs: nowMs };
        buckets.set(key, bucket);
      } else {
        const elapsedMs = nowMs - bucket.lastRefillMs;
        if (elapsedMs > 0) {
          bucket.tokens = Math.min(capacity, bucket.tokens + (elapsedMs / 1000) * refillPerSec);
          bucket.lastRefillMs = nowMs;
        }
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, retryAfterMs: 0 };
      }

      const deficit = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil((deficit / refillPerSec) * 1000);
      return { allowed: false, retryAfterMs };
    },
  };
}
