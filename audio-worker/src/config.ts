/**
 * Every millisecond duration the worker reads from the environment, in one
 * testable place. `index.ts` is the process entry point — it calls `main()` at
 * import time — so anything parsed inline there can never be asserted on.
 */

/**
 * Read a millisecond duration from the environment, falling back on anything
 * that isn't a positive finite number.
 *
 * The `Number.isFinite` and `> 0` guards are both load-bearing, and neither is
 * covered by the obvious `Number(process.env.X ?? fallback)`: `??` does not
 * fire for an empty string, and `Number('') === 0`. An empty value is a
 * realistic input — Helm renders an empty string for a missing `values.yaml`
 * key — and a zero is catastrophic rather than merely wrong: a 0ms upload
 * cutoff makes `reapStale` fail every in-flight upload the instant it starts,
 * and a 0ms poll interval spins the worker loop hot.
 */
export function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const DEFAULT_POLL_MS = 5_000;
export const DEFAULT_CLAIM_TIMEOUT_MS = 600_000;
/**
 * Presigned PUT URLs expire after 300s (`app/server/functions/uploads.ts`), so
 * a row still `uploading` 15 minutes after creation can never be confirmed —
 * nothing will ever move it again. See `reapStale`'s doc comment.
 */
export const DEFAULT_UPLOAD_TIMEOUT_MS = 900_000;

export type WorkerTimings = {
  /** How long to sleep when the queue is empty. */
  pollMs: number;
  /** How long a row may sit in `processing` before the reaper reclaims it. */
  staleMs: number;
  /** How long a row may sit in `uploading` before the reaper fails it. */
  uploadStaleMs: number;
};

/** Read at startup by `index.ts`. Every value goes through `envMs` — see why above. */
export function readWorkerTimings(): WorkerTimings {
  return {
    pollMs: envMs('POLL_INTERVAL_MS', DEFAULT_POLL_MS),
    staleMs: envMs('CLAIM_TIMEOUT_MS', DEFAULT_CLAIM_TIMEOUT_MS),
    uploadStaleMs: envMs('UPLOAD_TIMEOUT_MS', DEFAULT_UPLOAD_TIMEOUT_MS),
  };
}
