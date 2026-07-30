import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  claimNext,
  reapStale,
  computeBackoffMs,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
  REAP_UPLOAD_BATCH,
} from '../src/claim.js';
import { logger } from '../src/logger.js';

/**
 * The heartbeat is counted, not written: `beat()` is a synchronous
 * `writeFileSync`, and what these tests need to assert is HOW OFTEN the reaper
 * signals progress — the liveness threshold is justified as 2x the longest gap
 * between two beats, so the count is the contract.
 */
const beats = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/heartbeat.js', () => ({
  beat: () => {
    beats.count += 1;
  },
  isHeartbeatFresh: () => true,
}));

const UPLOAD_STALE_MS = 900_000;

/**
 * A reaper model. `find` returns the abandoned `uploading` rows; `updateOne`
 * reports a match by default, which is what the real driver always does.
 *
 * `find` is FILTER-AWARE as of Task 18's review fix round: `reapStale` now
 * issues TWO `find` calls — `reapAbandonedUploads`'s (`variant: { $ne:
 * 'once' }`) and the new `reapAbandonedOnceUploads`'s (`variant: 'once'`) —
 * against the same mocked collection. A filter-blind mock that returned
 * `abandoned` for either call would silently double-process every fixture
 * row through both reapers, which is exactly the kind of bug a real Mongo
 * query (which actually filters) would never reproduce and this suite would
 * then have zero coverage of. Routing on `variant` keeps every EXISTING test
 * below exercising only the main-upload reaper (its default `onceAbandoned:
 * []` makes the once-reaper a no-op) while the new
 * `reapAbandonedOnceUploads` tests opt in via the third parameter.
 */
function reaperModel(
  abandoned: { _id: unknown; sourceKey?: string }[] = [],
  updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 }),
  onceAbandoned: { _id: unknown; onceSourceKey?: string }[] = []
) {
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  // `limit` is HONOURED here, as the real driver honours it. A fake that
  // returned every row regardless would make the bound look like it worked
  // while testing a code path that never sees it.
  const find = vi.fn((f: unknown, options?: { limit?: number }) => {
    const isOnceQuery = (f as { variant?: unknown } | undefined)?.variant === 'once';
    const source = isOnceQuery ? onceAbandoned : abandoned;
    return { toArray: async () => (options?.limit ? source.slice(0, options.limit) : source) };
  });
  return { updateMany, updateOne, find };
}

describe('claimNext', () => {
  it('claims the oldest pending asset atomically and marks it processing', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ _id: 'a1' });
    const model = { findOneAndUpdate } as never;

    const doc = await claimNext(model, 'worker-1');
    expect(doc).toEqual({ _id: 'a1' });

    // Exact shape, not just `filter.status`: a loosened assertion would let a
    // future extra clause silently narrow (or widen) what gets claimed. The
    // `$or` dates can't be literal, so they're matched by type — everything
    // else is pinned, including that there are no other keys.
    const [filter, update, opts] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      status: 'pending',
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: expect.any(Date) } }],
    });
    expect(update.$set.status).toBe('processing');
    expect(update.$set.claimedBy).toBe('worker-1');
    expect(update.$inc).toEqual({ attempts: 1 });
    expect(opts.sort).toEqual({ createdAt: 1 });
    // Raw driver option. `new: true` is the Mongoose *model* option and would
    // silently hand back the pre-update document here.
    expect(opts.returnDocument).toBe('after');
  });

  it('refuses to claim a pending row whose retry backoff has not elapsed', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    const model = { findOneAndUpdate } as never;

    const before = Date.now();
    await claimNext(model, 'worker-1');
    const after = Date.now();

    // Without this clause a requeued row keeps its original createdAt, stays the
    // oldest pending doc under `sort: { createdAt: 1 }`, and is re-claimed on the
    // very next loop iteration — burning all three attempts in milliseconds.
    const [filter] = findOneAndUpdate.mock.calls[0];
    expect(filter.$or).toHaveLength(2);
    // `{ nextAttemptAt: null }` also matches documents where the field is absent
    // (Mongo equality-to-null), so never-retried and pre-existing rows stay
    // immediately claimable.
    expect(filter.$or[0]).toEqual({ nextAttemptAt: null });
    const gate = filter.$or[1].nextAttemptAt.$lte as Date;
    expect(gate).toBeInstanceOf(Date);
    expect(gate.getTime()).toBeGreaterThanOrEqual(before);
    expect(gate.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns null when nothing is pending', async () => {
    const model = { findOneAndUpdate: vi.fn().mockResolvedValue(null) } as never;
    expect(await claimNext(model, 'w')).toBeNull();
  });
});

describe('computeBackoffMs', () => {
  afterEach(() => {
    delete process.env.RETRY_BACKOFF_MS;
    delete process.env.RETRY_BACKOFF_MAX_MS;
  });

  it('grows exponentially per attempt', () => {
    expect(computeBackoffMs(1)).toBe(DEFAULT_RETRY_BASE_MS);
    expect(computeBackoffMs(2)).toBe(DEFAULT_RETRY_BASE_MS * 2);
    expect(computeBackoffMs(3)).toBe(DEFAULT_RETRY_BASE_MS * 4);
  });

  it('never returns zero, so a requeued row is always gated behind a real delay', () => {
    expect(computeBackoffMs(0)).toBeGreaterThan(0);
    expect(computeBackoffMs(-5)).toBeGreaterThan(0);
  });

  it('is capped so a misconfigured base cannot park a row for hours', () => {
    expect(computeBackoffMs(50)).toBe(DEFAULT_RETRY_MAX_MS);
  });

  it('honours RETRY_BACKOFF_MS', () => {
    process.env.RETRY_BACKOFF_MS = '1000';
    expect(computeBackoffMs(1)).toBe(1000);
    expect(computeBackoffMs(2)).toBe(2000);
  });

  it('falls back to the default for a non-numeric or non-positive override', () => {
    process.env.RETRY_BACKOFF_MS = 'not-a-number';
    expect(computeBackoffMs(1)).toBe(DEFAULT_RETRY_BASE_MS);
    process.env.RETRY_BACKOFF_MS = '0';
    expect(computeBackoffMs(1)).toBe(DEFAULT_RETRY_BASE_MS);
  });
});

describe('reapStale', () => {
  it('returns processing rows under the attempt cap to pending, clearing the backoff gate', async () => {
    const model = reaperModel();
    model.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const n = await reapStale(model as never, 600_000, UPLOAD_STALE_MS);
    expect(n).toBe(2);

    const [filter, update] = model.updateMany.mock.calls[0];
    expect(filter.status).toBe('processing');
    expect(filter.claimedAt.$lt).toBeInstanceOf(Date);
    expect(filter.attempts.$lt).toBe(3);
    expect(update.$set.status).toBe('pending');
    // The row already waited out the full stale timeout, so no further backoff
    // is warranted — and a stale future value left by an earlier
    // requeueForRetry must not park it a second time.
    expect(update.$set.nextAttemptAt).toBeNull();
  });

  it('fails rows that have exhausted their attempts', async () => {
    const model = reaperModel();
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS);
    const secondCall = model.updateMany.mock.calls[1];
    expect(secondCall[0].attempts.$gte).toBe(3);
    expect(secondCall[1].$set.status).toBe('failed');
  });

  it('bumps updatedAt on every clause — these are real status transitions', async () => {
    const model = reaperModel([
      { _id: 'u1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/a.wav' },
    ]);
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS);

    // The UI reads updatedAt as "when did this row last change". Reaped rows
    // are by definition hours stale by the time this runs, so omitting it makes
    // them claim to have last changed when they were created — most misleading
    // for exactly the rows this function produces. markFailed and
    // requeueForRetry (process.ts) already do this.
    expect(model.updateMany).toHaveBeenCalledTimes(2);
    for (const [, update] of model.updateMany.mock.calls) {
      expect(update.$set.updatedAt).toBeInstanceOf(Date);
    }
    expect(model.updateOne.mock.calls[0][1].$set.updatedAt).toBeInstanceOf(Date);
  });

  it('fails rows abandoned in `uploading` past the upload timeout', async () => {
    const model = reaperModel([
      { _id: 'u1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/a.wav' },
    ]);

    const before = Date.now();
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS);

    // Nothing but confirmAudioUpload ever writes an `uploading` row, so a
    // browser that died between presign and confirm (or a failed PUT, which
    // uploadAudioFile correctly refuses to confirm) leaves it there forever:
    // an indefinite spinner in the UI, a /audio route polling every 4s
    // forever, and a sourceKey that keeps its R2 object referenced (so no
    // orphan scan may reclaim it) while nothing can ever play it.
    const [findFilter] = model.find.mock.calls[0];
    expect((findFilter as { status: string }).status).toBe('uploading');
    const cutoff = (findFilter as { createdAt: { $lt: Date } }).createdAt.$lt;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - UPLOAD_STALE_MS + 1);

    const [filter, update] = model.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'u1', status: 'uploading' });
    expect(update.$set.status).toBe('failed');
    expect(update.$set.lastError).toBe('Upload never completed');
  });

  it('leaves a freshly created uploading row alone', async () => {
    const model = reaperModel();
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS);

    // The cutoff must be strictly in the past by the full timeout — a filter of
    // `{ $lt: now }` would fail every in-flight upload the instant it started.
    const cutoff = (model.find.mock.calls[0][0] as { createdAt: { $lt: Date } }).createdAt.$lt;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(UPLOAD_STALE_MS);
  });
});

/**
 * B10 — the storage leak. Reaping an abandoned `uploading` row used to leave
 * its R2 object stranded indefinitely: the failed row keeps advertising its
 * `sourceKey`, and a referenced key is exactly what the owner-scoped audio
 * cleanup refuses to reclaim. The object never passed confirm, so there is
 * nothing worth keeping — delete it here rather than leaving it to a scan that
 * is, correctly, not allowed to touch it.
 */
describe('reapStale reclaims abandoned upload objects', () => {
  it('deletes the R2 object of every row it fails', async () => {
    const model = reaperModel([
      { _id: 'u1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/a.wav' },
      { _id: 'u2', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/b.wav' },
    ]);
    const deleteSource = vi.fn().mockResolvedValue(undefined);

    await reapStale(model as never, 600_000, UPLOAD_STALE_MS, deleteSource);

    // ONE call carrying both keys, not one call per key — see REAP_UPLOAD_BATCH.
    expect(deleteSource).toHaveBeenCalledTimes(1);
    expect(deleteSource.mock.calls[0][0]).toEqual([
      'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/a.wav',
      'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/b.wav',
    ]);
  });

  it('does not delete the object of a row that got confirmed in the meantime', async () => {
    // The fenced write no-ops because the row is no longer `uploading`; the
    // object now belongs to a real, confirmed asset.
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const model = reaperModel(
      [{ _id: 'u1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/a.wav' }],
      updateOne
    );
    const deleteSource = vi.fn().mockResolvedValue(undefined);

    await reapStale(model as never, 600_000, UPLOAD_STALE_MS, deleteSource);

    expect(deleteSource).not.toHaveBeenCalled();
  });

  it('keeps failing rows when R2 is down — the delete is best effort', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const model = reaperModel([
      { _id: 'u1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/a.wav' },
      { _id: 'u2', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/b.wav' },
    ]);
    const deleteSource = vi.fn().mockRejectedValue(new Error('R2 down'));

    // A failed delete must not stop the status transitions that unstick the
    // users' spinners — those are already written by the time the batch runs.
    await expect(
      reapStale(model as never, 600_000, UPLOAD_STALE_MS, deleteSource)
    ).resolves.toBeTypeOf('number');
    expect(model.updateOne).toHaveBeenCalledTimes(2);
    expect(deleteSource).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('still transitions rows when no deleter is supplied', async () => {
    const model = reaperModel([
      { _id: 'u1', sourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/a.wav' },
    ]);
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
  });
});

/**
 * The reaper as a denial of service.
 *
 * `createAudioUploadFn` has no rate limit and needs no upload, so any
 * authenticated user can mint rows by the thousand and wait `UPLOAD_TIMEOUT_MS`.
 * The reap then ran one Atlas `updateOne` and one R2 `DeleteObject` for EVERY
 * abandoned row, sequentially, with no `.limit()`, no `beat()`, and no reading
 * of the shutdown flag — inside the worker's single loop. Ten thousand rows is
 * roughly ten minutes of that: the heartbeat goes stale at 600 s, the liveness
 * probe kills the pod, SIGTERM only sets a flag this code never read, and the
 * pod hangs to the 900 s grace and is SIGKILLed. On restart it re-lists the
 * survivors and repeats — permanent CrashLoopBackOff, and no asset transcodes
 * for anyone.
 */
describe('reapStale is bounded, beaten and interruptible', () => {
  /** 10 000 abandoned rows: the attack, as a list. */
  function flood(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      _id: `u${i}`,
      sourceKey: `uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/${i}.wav`,
    }));
  }

  it('asks Mongo for a bounded page rather than every abandoned row', async () => {
    const model = reaperModel(flood(10_000));
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS, vi.fn());

    // Without this the DoS is unbeatable no matter what the loop does: the
    // driver materialises all 10 000 documents before the first write.
    const [, options] = model.find.mock.calls[0] as [unknown, { limit?: number }];
    expect(options.limit).toBe(REAP_UPLOAD_BATCH);
    expect(REAP_UPLOAD_BATCH).toBeLessThanOrEqual(1000);
  });

  it('beats for every row it writes, so a long batch cannot stale the heartbeat', async () => {
    const model = reaperModel(flood(50));
    const before = beats.count;

    await reapStale(model as never, 600_000, UPLOAD_STALE_MS, vi.fn());

    // One per row, plus one per delete batch. The liveness threshold is
    // justified as 2x the longest gap between two beats; a reap pass that
    // beats only at the top of the loop makes that arithmetic false, and the
    // probe then kills a pod that is working perfectly well.
    expect(beats.count - before).toBeGreaterThanOrEqual(50);
  });

  it('deletes in batches R2 can actually take, not one request per key', async () => {
    const deleteSource = vi.fn().mockResolvedValue(undefined);
    const model = reaperModel(flood(10_000));

    await reapStale(model as never, 600_000, UPLOAD_STALE_MS, deleteSource);

    // At most REAP_UPLOAD_BATCH rows are touched per pass, and DeleteObjects
    // takes 1000 keys — so the whole pass is one R2 request.
    expect(deleteSource).toHaveBeenCalledTimes(1);
    for (const [keys] of deleteSource.mock.calls) {
      expect(keys.length).toBeLessThanOrEqual(1000);
    }
    expect(model.updateOne.mock.calls.length).toBe(REAP_UPLOAD_BATCH);
  });

  it('stops mid-batch on SIGTERM instead of running to the grace period', async () => {
    let running = true;
    const model = reaperModel(flood(200));
    // SIGTERM lands after the 5th row.
    model.updateOne.mockImplementation(async () => {
      if (model.updateOne.mock.calls.length >= 5) running = false;
      return { matchedCount: 1 };
    });

    await reapStale(model as never, 600_000, UPLOAD_STALE_MS, vi.fn(), () => running);

    // index.ts's handler only clears `running`; before this the reap never read
    // it, so shutdown waited out terminationGracePeriodSeconds (900 s) and ended
    // in a SIGKILL — with the reap's own writes half-applied either way.
    expect(model.updateOne.mock.calls.length).toBeLessThan(200);
    expect(model.updateOne.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('runs the whole batch when nothing asks it to stop', async () => {
    const model = reaperModel(flood(200));
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS, vi.fn(), () => true);
    expect(model.updateOne.mock.calls.length).toBe(200);
  });
});

/**
 * Task 18 review Critical 1, reproduced and fixed.
 *
 * `createOnceVariantUpload` flips an EXISTING, potentially long-lived row to
 * `status: 'uploading'` to attach a once-variant. Its `createdAt` is
 * whenever the MAIN asset was first uploaded — routinely hours or days in
 * the past. Before this fix, `reapAbandonedUploads`'s `createdAt`-gated
 * query matched such a row on the very next reap pass (default poll
 * interval: seconds) — while the browser's PUT to the once-variant's
 * presigned URL was still in flight — failed it, and pushed `row.sourceKey`
 * — the MAIN asset's source, not the once-variant's — into a real
 * `DeleteObjects` call. The renditions survive untouched, which is what
 * makes it silent in production: the asset keeps playing right up until
 * someone needs to re-transcode it.
 */
describe('reapStale handles once-variant attaches separately (Task 18 review Critical 1)', () => {
  const ONCE_STALE_MS = UPLOAD_STALE_MS; // reapStale reuses uploadTimeoutMs for both.

  it('excludes once-variant attaches from the main abandoned-upload query — the exact clause that closes the bug', async () => {
    const model = reaperModel();
    await reapStale(model as never, 600_000, UPLOAD_STALE_MS);

    const mainFindCall = model.find.mock.calls.find(
      ([f]) => (f as { variant?: unknown })?.variant !== 'once'
    );
    expect(mainFindCall).toBeDefined();
    const [filter] = mainFindCall!;
    expect((filter as { status: string }).status).toBe('uploading');
    // `$ne`, not `!== 'once'` in JS: this is a MongoDB query clause, and a
    // real Mongo evaluates it server-side — that evaluation, not anything in
    // this process, is what actually stops a once-row reaching this reaper's
    // row-processing code (which has no per-row variant check of its own; it
    // trusts the query). This assertion pins the clause the fix depends on.
    expect((filter as { variant?: unknown }).variant).toEqual({ $ne: 'once' });
  });

  it("never deletes an UNRELATED main asset's sourceKey while reaping a mid-attach once-variant — the two reapers do not cross-contaminate", async () => {
    // A genuinely abandoned MAIN upload (a different asset entirely — this
    // is what `reapAbandonedUploads` exists to catch) alongside a
    // mid-attach once-variant row (a SECOND, unrelated asset, already
    // `ready`, now mid-PUT on its once source). Each is placed only where a
    // real Mongo query honouring the two reapers' respective filters would
    // actually return it — `abandoned` for the plain main upload,
    // `onceAbandoned` for the once-variant, never both — because the query
    // filter, not any row-level check inside either reaper, is the entire
    // mechanism under test: neither reaper's row-processing code checks
    // `variant` itself, both simply trust what `find` returned.
    const model = reaperModel(
      [{ _id: 'genuinely-abandoned-main', sourceKey: 'uploads/audio/prefix/main-src.wav' }],
      undefined,
      [{ _id: 'mid-attach-once', onceSourceKey: 'uploads/audio/prefix/once-src.wav' }]
    );
    const deleteSource = vi.fn().mockResolvedValue(undefined);

    await reapStale(model as never, 600_000, ONCE_STALE_MS, deleteSource);

    const deletedKeys = deleteSource.mock.calls.flatMap(([keys]) => keys as string[]);
    // The genuinely-abandoned main upload is still correctly reclaimed...
    expect(deletedKeys).toContain('uploads/audio/prefix/main-src.wav');
    // ...and so is the once-attach's own source, via the once-specific
    // path...
    expect(deletedKeys).toContain('uploads/audio/prefix/once-src.wav');
    // ...but the two rows' outcomes are not swapped or merged: the
    // mid-attach row's update never references the OTHER asset's key, and
    // vice versa.
    const onceUpdateCall = model.updateOne.mock.calls.find(
      ([f]) => (f as { _id: unknown })._id === 'mid-attach-once'
    );
    expect(onceUpdateCall![1]).not.toHaveProperty('sourceKey');
    const mainUpdateCall = model.updateOne.mock.calls.find(
      ([f]) => (f as { _id: unknown })._id === 'genuinely-abandoned-main'
    );
    expect(mainUpdateCall![1].$set).not.toHaveProperty('onceSourceKey');
  });

  it('reverts a stale once-attach to ready/main on updatedAt, not createdAt', async () => {
    const model = reaperModel([], undefined, [
      { _id: 'once-1', onceSourceKey: 'uploads/audio/prefix/once-src.wav' },
    ]);
    const before = Date.now();

    await reapStale(model as never, 600_000, ONCE_STALE_MS, vi.fn());

    const onceFindCall = model.find.mock.calls.find(
      ([f]) => (f as { variant?: unknown })?.variant === 'once'
    );
    expect(onceFindCall).toBeDefined();
    const [filter] = onceFindCall!;
    expect((filter as { status: string }).status).toBe('uploading');
    // updatedAt, NOT createdAt — the entire fix. A cutoff gated on createdAt
    // would match this row (and every other once-attach) immediately, since
    // the MAIN asset's createdAt is whatever it always was.
    expect(filter).not.toHaveProperty('createdAt');
    const cutoff = (filter as { updatedAt: { $lt: Date } }).updatedAt.$lt;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - ONCE_STALE_MS + 1);

    const onceUpdateCall = model.updateOne.mock.calls.find(
      ([f]) => (f as { _id: unknown })._id === 'once-1'
    );
    expect(onceUpdateCall).toBeDefined();
    const [updateFilter, update] = onceUpdateCall!;
    expect(updateFilter).toEqual({ _id: 'once-1', status: 'uploading', variant: 'once' });
    expect(update.$set).toMatchObject({
      status: 'ready',
      variant: 'main',
      onceSourceKey: null,
    });
    expect(update.$set.onceLastError).toBeTypeOf('string');
    expect(update.$set.claimedAt).toBeNull();
    expect(update.$set.claimedBy).toBeNull();
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it('leaves a freshly started once-attach alone (nothing in the once-abandoned candidate set)', async () => {
    // No onceAbandoned rows supplied — mirrors a real Mongo query finding
    // nothing because the attach is still well within its timeout window.
    const model = reaperModel();
    const deleteSource = vi.fn().mockResolvedValue(undefined);

    await reapStale(model as never, 600_000, ONCE_STALE_MS, deleteSource);

    expect(deleteSource).not.toHaveBeenCalled();
  });

  it('does not touch a once-attach that got confirmed in the meantime — the fenced write correctly no-ops', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const model = reaperModel([], updateOne, [
      { _id: 'once-1', onceSourceKey: 'uploads/audio/prefix/once-src.wav' },
    ]);
    const deleteSource = vi.fn().mockResolvedValue(undefined);

    await reapStale(model as never, 600_000, ONCE_STALE_MS, deleteSource);

    // matchedCount: 0 means confirmOnceVariantUpload already moved the row
    // past `uploading` before this write landed — its once source is now a
    // real part of a `pending`/`processing` asset and must not be deleted.
    expect(deleteSource).not.toHaveBeenCalled();
  });
});
