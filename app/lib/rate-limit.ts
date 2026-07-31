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
  /** Bound on tracked keys; the oldest key (by first-seen order) is evicted past this. */
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

  const buckets = new Map<string, Bucket>();

  return {
    check(key) {
      const nowMs = now();
      let bucket = buckets.get(key);

      if (!bucket) {
        if (buckets.size >= maxKeys) {
          // Map iteration order is insertion order, so the first key is the
          // oldest — same eviction strategy as exception-throttle.ts.
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
