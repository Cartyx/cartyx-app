/**
 * Shared per-key throttle for exception telemetry.
 *
 * A single recurring error (e.g. a failing server function hit by a
 * high-frequency mutation like token drag, or a refetch-on-focus loop) can
 * otherwise emit tens of thousands of identical PostHog exceptions — one
 * incident once produced ~183K events.
 *
 * Semantics: the first occurrence is always captured, repeats are captured at
 * most once per `throttleMs`, and forwarded captures (not raw occurrences) are
 * capped per rolling `capWindowMs` — so a burst never permanently mutes a key
 * and a later incident with the same signature still surfaces. Time is passed
 * in by the caller, keeping the logic pure and portable between the browser
 * (posthog-js `before_send`) and the server (posthog-node wrapper).
 */

export interface ExceptionThrottleOptions {
  /** Minimum gap between forwarded captures of the same key. */
  throttleMs?: number;
  /** Maximum forwarded captures per key within one cap window. */
  maxCapturesPerWindow?: number;
  /** Rolling window after which a capped key may report again. */
  capWindowMs?: number;
  /** Bound on tracked keys; the oldest key is evicted past this. */
  maxKeys?: number;
}

export interface ThrottleDecision {
  /** Whether this occurrence should be forwarded to telemetry. */
  capture: boolean;
  /** Total occurrences of this key seen since it was first tracked. */
  occurrences: number;
  /** Set on the last allowed capture of a window: suppression follows. */
  capped?: boolean;
}

interface ThrottleRecord {
  occurrences: number;
  captures: number;
  lastCaptureMs: number;
  windowStartMs: number;
}

export interface ExceptionThrottle {
  check(key: string, nowMs: number): ThrottleDecision;
  size(): number;
}

export function createExceptionThrottle(options: ExceptionThrottleOptions = {}): ExceptionThrottle {
  const {
    throttleMs = 5_000,
    maxCapturesPerWindow = 20,
    capWindowMs = 60 * 60_000,
    maxKeys = 500,
  } = options;

  const records = new Map<string, ThrottleRecord>();

  return {
    check(key, nowMs) {
      let rec = records.get(key);
      if (!rec) {
        if (records.size >= maxKeys) {
          const oldest = records.keys().next().value;
          if (oldest !== undefined) records.delete(oldest);
        }
        rec = { occurrences: 0, captures: 0, lastCaptureMs: -Infinity, windowStartMs: nowMs };
        records.set(key, rec);
      }

      rec.occurrences++;

      if (nowMs - rec.windowStartMs >= capWindowMs) {
        rec.captures = 0;
        rec.windowStartMs = nowMs;
      }

      if (rec.captures >= maxCapturesPerWindow || nowMs - rec.lastCaptureMs < throttleMs) {
        return { capture: false, occurrences: rec.occurrences };
      }

      rec.captures++;
      rec.lastCaptureMs = nowMs;
      return {
        capture: true,
        occurrences: rec.occurrences,
        ...(rec.captures === maxCapturesPerWindow && { capped: true }),
      };
    },
    size() {
      return records.size;
    },
  };
}
