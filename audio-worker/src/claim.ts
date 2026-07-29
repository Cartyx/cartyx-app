export const MAX_ATTEMPTS = 3;

/** Default base retry delay: the first requeue waits this long, each further attempt doubles it. */
export const DEFAULT_RETRY_BASE_MS = 30_000;

/** Default upper bound on a single backoff step, so a misconfigured base can't park a row for hours. */
export const DEFAULT_RETRY_MAX_MS = 300_000;

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Exponential backoff for the Nth attempt. `attempts` is the value AFTER
 * claimNext's `$inc`, so the row that just failed its 1st attempt passes 1 and
 * waits one base interval before its 2nd.
 *
 * Backoff is the entire point of the retry budget: without a delay a requeued
 * row keeps its original `createdAt`, stays the oldest `pending` document, and
 * is re-claimed on the very next loop iteration — so all three attempts burn
 * back-to-back within milliseconds and the transient failures retries exist to
 * survive (an R2 blip, a brief Atlas failover) still end in permanent `failed`.
 * The delay also removes head-of-line blocking: a failing asset no longer
 * jumps ahead of every other pending row on every pass.
 */
export function computeBackoffMs(attempts: number): number {
  const base = envMs('RETRY_BACKOFF_MS', DEFAULT_RETRY_BASE_MS);
  const max = envMs('RETRY_BACKOFF_MAX_MS', DEFAULT_RETRY_MAX_MS);
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(max, base * 2 ** (n - 1));
}

export type ClaimModel = {
  findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => Promise<unknown>;
  updateMany: (f: unknown, u: unknown) => Promise<{ modifiedCount?: number }>;
};

/**
 * Atomically take the oldest pending asset whose backoff has elapsed. A single
 * findOneAndUpdate is what makes this safe with multiple workers — two cannot
 * claim the same row.
 *
 * The `nextAttemptAt` clause is what enforces the backoff written by
 * `requeueForRetry`. `{ nextAttemptAt: null }` matches both an explicit null
 * and a document where the field is absent entirely (Mongo equality-to-null
 * semantics), so rows that have never been retried — and rows written before
 * this field existed — remain immediately claimable.
 *
 * NOTE: this runs against the raw driver collection
 * (`mongoose.connection.collection(...)`), so the "give me the updated doc"
 * option is `returnDocument: 'after'`. Mongoose models use `new: true`; passing
 * that here is silently ignored and you get the pre-update document back.
 */
export async function claimNext<T>(model: ClaimModel, workerId: string): Promise<T | null> {
  const doc = await model.findOneAndUpdate(
    {
      status: 'pending',
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
    },
    {
      $set: { status: 'processing', claimedAt: new Date(), claimedBy: workerId },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );
  return (doc as T | null) ?? null;
}

/**
 * Recover rows whose worker died mid-job. Under the attempt cap they go back to
 * pending; at or over it they fail, so a poison file cannot loop forever.
 *
 * Requeued rows get `nextAttemptAt: null`: they have already waited out the
 * full stale timeout, so no further backoff is warranted, and clearing it stops
 * a stale future value left by an earlier `requeueForRetry` from parking the
 * row a second time.
 *
 * `uploadTimeoutMs` handles the *other* stuck state: a row stays
 * `status: 'uploading'` from the moment `createAudioUpload` presigns until
 * `confirmAudioUpload` flips it to `pending`, and nothing else ever writes it.
 * A browser that dies between those two steps — or a PUT that fails, which
 * `uploadAudioFile` correctly refuses to confirm — leaves the row there
 * forever: an animated spinner in the UI that never resolves, a `/audio` route
 * that polls every 4s forever, and a `sourceKey` the orphan scanner treats as
 * in-use so the R2 object is never reclaimed either. Presigned URLs expire in
 * 300s, so a row older than this cap is definitively abandoned and is failed
 * with an honest message, which stops the poll and lets delete/orphan-scan
 * reclaim it.
 */
export async function reapStale(
  model: ClaimModel,
  timeoutMs: number,
  uploadTimeoutMs: number
): Promise<number> {
  const now = Date.now();
  const cutoff = new Date(now - timeoutMs);

  const requeued = await model.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: 'pending', claimedAt: null, claimedBy: null, nextAttemptAt: null } }
  );

  await model.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $gte: MAX_ATTEMPTS } },
    {
      $set: {
        status: 'failed',
        lastError: 'Processing timed out',
        claimedAt: null,
        claimedBy: null,
      },
    }
  );

  await model.updateMany(
    { status: 'uploading', createdAt: { $lt: new Date(now - uploadTimeoutMs) } },
    {
      $set: {
        status: 'failed',
        lastError: 'Upload never completed',
        claimedAt: null,
        claimedBy: null,
      },
    }
  );

  return requeued.modifiedCount ?? 0;
}
