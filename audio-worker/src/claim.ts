import { envMs } from './config.js';
import { logger } from './logger.js';
import { beat } from './heartbeat.js';
import { captureException } from './telemetry.js';

export const MAX_ATTEMPTS = 3;

/** Default base retry delay: the first requeue waits this long, each further attempt doubles it. */
export const DEFAULT_RETRY_BASE_MS = 30_000;

/** Default upper bound on a single backoff step, so a misconfigured base can't park a row for hours. */
export const DEFAULT_RETRY_MAX_MS = 300_000;

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
  updateOne: (f: unknown, u: unknown) => Promise<{ matchedCount?: number }>;
  find: (
    f: unknown,
    o?: unknown
  ) => {
    toArray: () => Promise<{ _id: unknown; sourceKey?: string; onceSourceKey?: string }[]>;
  };
};

/**
 * Deletes a BATCH of R2 objects. Supplied by `index.ts` (see
 * `makeSourceDeleter`), which maps it onto `DeleteObjects` — one request per
 * 1000 keys instead of one request per key.
 */
export type SourceDeleter = (keys: string[]) => Promise<void>;

/**
 * The most `uploading` rows one reap pass will touch.
 *
 * This bound is the whole fix, and its absence was a self-sustaining denial of
 * service. `createAudioUpload` needs no upload and has no rate limit, so any
 * authenticated user can create rows by the thousand; every one of them ages
 * into `uploading`-abandoned after `UPLOAD_TIMEOUT_MS`; and the reaper then ran
 * one Atlas `updateOne` plus one R2 `DeleteObject` for EVERY one of them,
 * sequentially, inside the single worker loop with no `beat()` anywhere in it.
 * Ten thousand rows is roughly ten minutes of that, the heartbeat goes stale at
 * 600 s, the liveness probe kills the pod, SIGTERM only clears a flag the reap
 * loop never read, so the pod hangs until the 900 s grace expires and is
 * SIGKILLed — then restarts, re-lists the survivors, and does it again. It
 * never converges: permanent CrashLoopBackOff, no asset ever transcodes, and
 * every user's queue is blocked.
 *
 * 200 is sized to finish well inside one loop iteration: 200 sequential Atlas
 * round trips is a couple of seconds, and the whole batch's deletes fit in a
 * SINGLE `DeleteObjects` request (the API takes 1000 keys). Backlogs simply
 * take more passes — and each pass still claims and transcodes an asset, so a
 * backlog no longer starves the queue it shares a loop with.
 */
export const REAP_UPLOAD_BATCH = 200;

/** `DeleteObjects` accepts at most 1000 keys per request. */
const R2_DELETE_BATCH = 1000;

/**
 * Checked between reaper iterations so SIGTERM is honoured mid-batch.
 *
 * `index.ts` flips `running` on SIGTERM, and the loop it guards is only
 * consulted between whole assets — a reap pass that ignores it turns an orderly
 * shutdown into a wait for `terminationGracePeriodSeconds` (900 s) and a
 * SIGKILL.
 */
export type ShouldContinue = () => boolean;

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
 * in-use. Presigned URLs expire in 300s, so a row older than this cap is
 * definitively abandoned and is failed with an honest message, which stops the
 * poll.
 *
 * That reap also DELETES the abandoned R2 object, and it has to. The previous
 * version of this comment claimed the reap "lets delete/orphan-scan reclaim
 * it", which was false by construction: `collectInUseKeys`
 * (app/server/functions/cleanup.ts) has no status filter, so the failed row
 * goes on advertising its `sourceKey` as in-use forever and no orphan scan can
 * ever reclaim the object. Deleting here loses nothing — the object never
 * passed `confirmAudioUpload`, so it was never accepted as a source in the
 * first place.
 *
 * The delete is BEST EFFORT and runs AFTER the status write: an R2 outage must
 * not keep a user's spinner alive, so a failed delete is logged and reported,
 * not thrown. It is also skipped when the fenced write matched nothing, which
 * is how a confirm landing between the read and the write keeps its object.
 *
 * That upload reap is BOUNDED — `REAP_UPLOAD_BATCH` rows per pass, a `beat()`
 * per row, batched deletes, and `shouldContinue` honoured between rows. It was
 * none of those things, and the result was a denial of service any authenticated
 * user could trigger; see `REAP_UPLOAD_BATCH`.
 *
 * **Task 18 review Critical 1.** `reapAbandonedUploads` below now EXCLUDES
 * `variant: 'once'` rows and a SIBLING reaper
 * (`reapAbandonedOnceUploads`) handles them instead, on `updatedAt` rather
 * than `createdAt`. The distinction is the entire fix, so it is worth
 * spelling out why sharing the first reaper was actively dangerous:
 * `createOnceVariantUpload` flips an EXISTING, potentially long-lived row to
 * `status: 'uploading'` to attach a once-variant. That row's `createdAt` is
 * whenever the MAIN asset was first uploaded — routinely hours or days in
 * the past. Filtering abandoned-upload candidates on `createdAt` therefore
 * matched every such row on the very next reap pass (this loop's default
 * poll interval is seconds), while the browser's PUT to the once-variant's
 * presigned URL was still in flight. The reaper then failed the row and
 * pushed its `sourceKey` — the MAIN asset's source, not the once-variant's —
 * into a real `DeleteObjects` call. The renditions survive untouched, which
 * is what makes it silent: the asset keeps playing right up until someone
 * needs to re-transcode it, at which point the source is already gone.
 *
 * That sibling gates on `onceUploadStartedAt`, a field whose sole writer is
 * `createOnceVariantUpload`, so it reads "how long has THIS attach been
 * stuck" instead of "how old is the row." It originally used `updatedAt`,
 * which was better than `createdAt` but still wrong for the same underlying
 * reason: `updatedAt` records modification, not progress, and the app's two
 * unfenced facet editors reset it — see that function's own `$or` for the
 * whole argument.
 */
export async function reapStale(
  model: ClaimModel,
  timeoutMs: number,
  uploadTimeoutMs: number,
  deleteSource?: SourceDeleter,
  shouldContinue?: ShouldContinue
): Promise<number> {
  const now = Date.now();
  const cutoff = new Date(now - timeoutMs);

  // Every clause bumps `updatedAt`: these are real status transitions, and the
  // UI reads that timestamp as "when did this row last change". Without it a
  // reaped row claims to have last changed whenever it was created — which is
  // most misleading for exactly the rows the reaper produces, since those are
  // by definition hours stale by the time it touches them. `markFailed` and
  // `requeueForRetry` in process.ts already do this.
  const requeued = await model.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $lt: MAX_ATTEMPTS } },
    {
      $set: {
        status: 'pending',
        claimedAt: null,
        claimedBy: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      },
    }
  );

  await model.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $gte: MAX_ATTEMPTS } },
    {
      $set: {
        status: 'failed',
        lastError: 'Processing timed out',
        claimedAt: null,
        claimedBy: null,
        updatedAt: new Date(),
      },
    }
  );

  await reapAbandonedUploads(model, new Date(now - uploadTimeoutMs), deleteSource, shouldContinue);
  await reapAbandonedOnceUploads(
    model,
    new Date(now - uploadTimeoutMs),
    deleteSource,
    shouldContinue
  );

  return requeued.modifiedCount ?? 0;
}

/**
 * Fail up to `REAP_UPLOAD_BATCH` rows abandoned in `uploading`, one at a time,
 * then delete their R2 objects in batches.
 *
 * Row-at-a-time STATUS WRITES rather than one `updateMany` because the delete
 * has to be tied to a write this call actually performed. A user can confirm an
 * upload in the window between reading the candidate list and writing the
 * failure; the write is fenced on `status: 'uploading'` so it correctly no-ops
 * for that row, and only a matched write authorizes deleting the object. A bulk
 * update cannot report which rows it moved, so pairing it with a delete loop
 * would destroy the source of a freshly confirmed asset.
 *
 * The DELETES are batched anyway, because that authorization is per row but the
 * R2 call is not: keys are collected as each fenced write matches and handed to
 * `deleteSource` in chunks, so 200 rows cost 200 Atlas round trips and ONE R2
 * request rather than 400 round trips.
 *
 * `beat()` per row, because this loop is the one place in the worker that can
 * legitimately run for seconds without touching a pipeline stage, and a stale
 * heartbeat here gets a perfectly healthy pod killed mid-reap — which is how
 * the backlog became self-sustaining.
 *
 * `variant: { $ne: 'once' }` — Task 18 review Critical 1. Without this
 * clause, a once-variant attach (which flips an EXISTING, long-lived row to
 * `status: 'uploading'`) matches on `createdAt` alone — that row's
 * `createdAt` is the MAIN asset's original upload time, not when the attach
 * started, so every once-attach older than `uploadTimeoutMs` (i.e.
 * essentially all of them) was abandoned-reaped within one poll interval of
 * starting, deleting the MAIN source object. `reapAbandonedOnceUploads`
 * below handles once-attaches instead, gated on `updatedAt`. `$ne` (not
 * `!= 'once'`) so rows written before this field existed — where `variant`
 * is absent, i.e. every ordinary main upload — still match (Mongo's
 * equality-to-missing-field semantics for `$ne` exclude only an explicit
 * `'once'`).
 */
async function reapAbandonedUploads(
  model: ClaimModel,
  cutoff: Date,
  deleteSource?: SourceDeleter,
  shouldContinue?: ShouldContinue
): Promise<void> {
  const abandoned = await model
    .find(
      { status: 'uploading', variant: { $ne: 'once' }, createdAt: { $lt: cutoff } },
      { projection: { sourceKey: 1 }, limit: REAP_UPLOAD_BATCH }
    )
    .toArray();

  const reclaimable: string[] = [];

  for (const row of abandoned) {
    // Between rows, not between passes: a shutdown mid-batch leaves the
    // untouched rows exactly as they were, and the next start re-lists them.
    if (shouldContinue && !shouldContinue()) break;

    const result = await model.updateOne(
      // `variant: { $ne: 'once' }` is re-asserted here, NOT just in the
      // `find` above — final-review fix, symmetric with
      // `reapAbandonedOnceUploads`'s own fenced write, which has always
      // carried its `variant: 'once'`. The window is real if narrow: this
      // loop can run for seconds (bounded batch, `beat()` per row, an
      // Atlas round trip each), and a row listed as an abandoned MAIN
      // upload can complete confirm -> transcode -> once-attach before its
      // turn comes. Without this clause that write matches the now-`once`
      // row, and `row.sourceKey` — the MAIN source, projected before the
      // attach existed — goes into a real `DeleteObjects`. That is Task
      // 18's Critical 1 data loss reached through timing instead of by
      // design. `$ne` (not `!=`) for the same reason the `find` uses it:
      // rows predating the field have no `variant` and must still match.
      { _id: row._id, status: 'uploading', variant: { $ne: 'once' } },
      {
        $set: {
          status: 'failed',
          lastError: 'Upload never completed',
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        },
      }
    );
    beat();
    // Explicit 0 only: the raw driver always reports matchedCount, and treating
    // a missing field as "didn't match" would silently stop reclaiming objects.
    if (result?.matchedCount === 0) continue;
    if (row.sourceKey) reclaimable.push(row.sourceKey);
  }

  if (!deleteSource) return;

  for (let i = 0; i < reclaimable.length; i += R2_DELETE_BATCH) {
    const chunk = reclaimable.slice(i, i + R2_DELETE_BATCH);
    try {
      await deleteSource(chunk);
    } catch (err) {
      // Best effort, and per chunk: the status transitions that unstick every
      // user's spinner have already been written and must not be undone by an
      // R2 outage. A chunk that fails is simply not reclaimed this pass.
      logger.warn({ err, keys: chunk.length }, 'failed to delete abandoned upload objects');
      captureException(err, { keys: chunk.length, scope: 'reap-delete' });
    }
    beat();
  }
}

/**
 * The once-variant sibling of `reapAbandonedUploads` — Task 18 review
 * Critical 1's fix. A once-variant attach that never gets confirmed (the
 * browser dies mid-PUT, the tab closes, the PUT itself fails) must age out
 * the same way an abandoned main upload does, but it CANNOT reuse the same
 * reaper: the row it stamps `status: 'uploading'` onto already existed, with
 * a `createdAt` from whenever the MAIN asset was first uploaded, so an
 * age check against `createdAt` fires immediately instead of after a real
 * timeout.
 *
 * Gated on `onceUploadStartedAt` instead — the app field
 * `createOnceVariantUpload` stamps, and the only writer of it — so this
 * reads "how long has the CURRENT once-attach been stuck," which is the
 * question that needs answering. (It was `updatedAt` until the facet-edit
 * hole below was found; the `$or` in the query documents both.)
 *
 * Reverts the row to a fully playable state rather than failing it: `status:
 * 'ready'` (the main content was never touched by this abandoned attach),
 * `variant: 'main'` (no once job is in flight anymore), `onceSourceKey:
 * null` (nothing references it, so the orphan scanner can reclaim the
 * object). `onceLastError` records the reason for anyone who looks — see
 * `markOnceFailed` in `process.ts`, whose terminal write this mirrors for
 * the "worker never got to run at all" case.
 *
 * Structurally identical to `reapAbandonedUploads` — bounded batch, row-at-a-
 * time fenced writes (a confirm landing between the read and the write
 * correctly no-ops), batched deletes, `beat()` per row, `shouldContinue`
 * honoured between rows — for the same reasons; see that function's doc
 * comment.
 */
async function reapAbandonedOnceUploads(
  model: ClaimModel,
  cutoff: Date,
  deleteSource?: SourceDeleter,
  shouldContinue?: ShouldContinue
): Promise<void> {
  const abandoned = await model
    .find(
      {
        status: 'uploading',
        variant: 'once',
        // Gated on `onceUploadStartedAt` — the web app's dedicated
        // attach-liveness stamp — NOT on `updatedAt`, which is what this
        // reaper originally used and which cannot answer the question.
        //
        // `updatedAt` means "when was this document last modified at all",
        // and two unfenced facet editors bump it on any row their owner
        // touches: `updateAudioAsset` and `bulkTagAudioAssets` in
        // `app/server/functions/audio.ts`. So a GM who retitles or retags a
        // track whose once-attach died mid-PUT reset this reaper's only
        // clock and bought the dead attach another full timeout — and there
        // is no way out from the other side either, because
        // `createOnceVariantUpload` refuses anything that isn't
        // `status: 'ready'` and the row is stuck in `uploading`. Edit it
        // again and it is postponed again: the row can be held out of reach
        // of the reaper forever by ordinary library housekeeping, with the
        // asset unplayable the whole time (`status` is shared with the main
        // pipeline — see `variant` on the app's AudioAsset model).
        // `onceUploadStartedAt` has exactly one writer, the attach itself,
        // so nothing unrelated can move it.
        //
        // The `$or` is the migration fallback, and its second branch is
        // deliberately the OLD predicate. `onceUploadStartedAt: null`
        // matches both an explicit null and a document where the field is
        // absent (Mongo equality-to-null semantics), i.e. every row written
        // before the app started stamping it — including any attach that
        // was in flight across the deploy. Those rows keep exactly today's
        // behaviour. The alternative, treating a missing stamp as
        // infinitely stale, would have this reaper revert every in-flight
        // once-attach in the collection on its first pass after the deploy
        // and delete their once-source objects: the fix's own failure mode,
        // inflicted on the users who happened to be mid-upload.
        $or: [
          { onceUploadStartedAt: { $lt: cutoff } },
          { onceUploadStartedAt: null, updatedAt: { $lt: cutoff } },
        ],
      },
      { projection: { onceSourceKey: 1 }, limit: REAP_UPLOAD_BATCH }
    )
    .toArray();

  const reclaimable: string[] = [];

  for (const row of abandoned) {
    if (shouldContinue && !shouldContinue()) break;

    const result = await model.updateOne(
      {
        _id: row._id,
        status: 'uploading',
        variant: 'once',
        // `onceSourceKey` identifies WHICH attach this write is reverting —
        // without it the fence is satisfied by any once-attach on this row,
        // including one that started after the candidate list was read.
        //
        // `{_id, status: 'uploading', variant: 'once'}` describes the state a
        // SECOND attach puts the row in just as exactly as it describes the
        // abandoned first one, and this loop runs for real time (bounded
        // batch, a `beat()` and an Atlas round trip per row) — so a second
        // attach can appear between the `find` above and this row's turn.
        //
        // What does NOT get there is the obvious story, and it is worth
        // saying so because it is the one a reader will assume: the GM
        // CANNOT simply give up on a stuck attach and start another one.
        // `createOnceVariantUpload` is fenced on `status: 'ready'`
        // (app/server/functions/audio.ts), and the stuck row is `uploading`.
        // Something must return it to `ready` first. Two things do:
        //
        //   (a) The browser's PUT finally lands and
        //       `confirmOnceVariantUpload` REJECTS the file — over
        //       `AUDIO_MAX_BYTES`, unsupported type, or the pending-job cap.
        //       Every one of those paths reverts the row to `ready`/`main`
        //       and records `onceLastError`. The GM sees the failure, picks a
        //       better file, and attaches again — now permitted, because the
        //       row is `ready`. All of it can happen while this pass is
        //       working through earlier rows.
        //   (b) More than one worker running at once. Replica 1 reverts this
        //       row (or any of the app paths above does) while replica 2 still
        //       has it listed from its own `find`, and a re-attach lands in
        //       the gap. `audioWorker.replicaCount` is 1 today, but that is
        //       NOT a single-writer guarantee: the chart sets `strategy:
        //       Recreate` precisely because the default RollingUpdate starts
        //       the new pod before the old one terminates, so every deploy
        //       would otherwise run two workers even at `replicas: 1` (see
        //       deploy/charts/cartyx/values.yaml). A data fence that leans on
        //       a Deployment strategy is a fence that stops holding the day
        //       someone changes that strategy, or scales the replica count for
        //       a bulk import — which values.yaml explicitly contemplates.
        //       `claimNext` refuses to assume a single writer anywhere else;
        //       this write must not assume it either.
        //
        // Either way, by the time this row's turn comes
        // `createOnceVariantUpload` has minted a NEW `onceSourceKey` and
        // restamped the row. The unfenced write then reverted that
        // seconds-old attach to `ready`/`main`, told the user it "never
        // completed", and — because `row.onceSourceKey` was projected BEFORE
        // the re-attach — pushed the OLD key into `DeleteObjects` while the
        // new object, now referenced by nothing, was stranded. The browser's
        // PUT to the new presigned URL lands on an object no row points at,
        // the worker never sees the job, and nothing reports any of it.
        //
        // Same class its sibling `reapAbandonedUploads` was hardened against
        // one review earlier, and the same remedy: make the fence describe
        // the unit of work, not just the state.
        //
        // `?? null` because a projected-but-absent field arrives as
        // `undefined`, and `{ onceSourceKey: null }` is the filter that
        // matches null-or-missing in Mongo. Such a row has nothing to delete
        // anyway (`row.onceSourceKey` is falsy below), but it still has to be
        // reverted out of `uploading` or it is stuck forever, which is this
        // reaper's whole purpose.
        onceSourceKey: row.onceSourceKey ?? null,
      },
      {
        $set: {
          status: 'ready',
          variant: 'main',
          onceSourceKey: null,
          // Paired with `onceSourceKey` above, same reasoning as
          // `markOnceFailed` in `process.ts`: cartyx-app's Task 3b review
          // finding requires `onceSourceBytes` reset wherever
          // `onceSourceKey` is cleared or replaced, so a row abandoned
          // before it ever reached `confirmOnceVariantUpload` (this reaper's
          // whole reason to exist) can't leave a PRIOR successful attach's
          // stale byte count standing against a key that no longer exists.
          onceSourceBytes: null,
          onceLastError: 'Once-variant upload never completed',
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        },
      }
    );
    beat();
    if (result?.matchedCount === 0) continue;
    if (row.onceSourceKey) reclaimable.push(row.onceSourceKey);
  }

  if (!deleteSource) return;

  for (let i = 0; i < reclaimable.length; i += R2_DELETE_BATCH) {
    const chunk = reclaimable.slice(i, i + R2_DELETE_BATCH);
    try {
      await deleteSource(chunk);
    } catch (err) {
      logger.warn(
        { err, keys: chunk.length },
        'failed to delete abandoned once-variant upload objects'
      );
      captureException(err, { keys: chunk.length, scope: 'reap-once-delete' });
    }
    beat();
  }
}
