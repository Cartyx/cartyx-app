import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  claimNext,
  reapStale,
  computeBackoffMs,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
} from '../src/claim.js';

const UPLOAD_STALE_MS = 900_000;

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
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const model = { updateMany } as never;

    const n = await reapStale(model, 600_000, UPLOAD_STALE_MS);
    expect(n).toBe(2);

    const [filter, update] = updateMany.mock.calls[0];
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
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const model = { updateMany } as never;
    await reapStale(model, 600_000, UPLOAD_STALE_MS);
    const secondCall = updateMany.mock.calls[1];
    expect(secondCall[0].attempts.$gte).toBe(3);
    expect(secondCall[1].$set.status).toBe('failed');
  });

  it('bumps updatedAt on every clause — these are real status transitions', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const model = { updateMany } as never;
    await reapStale(model, 600_000, UPLOAD_STALE_MS);

    // The UI reads updatedAt as "when did this row last change". Reaped rows
    // are by definition hours stale by the time this runs, so omitting it makes
    // them claim to have last changed when they were created — most misleading
    // for exactly the rows this function produces. markFailed and
    // requeueForRetry (process.ts) already do this.
    expect(updateMany).toHaveBeenCalledTimes(3);
    for (const [, update] of updateMany.mock.calls) {
      expect(update.$set.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('fails rows abandoned in `uploading` past the upload timeout', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const model = { updateMany } as never;

    const before = Date.now();
    await reapStale(model, 600_000, UPLOAD_STALE_MS);

    // Nothing but confirmAudioUpload ever writes an `uploading` row, so a
    // browser that died between presign and confirm (or a failed PUT, which
    // uploadAudioFile correctly refuses to confirm) leaves it there forever:
    // an indefinite spinner in the UI, a /audio route polling every 4s
    // forever, and a sourceKey the orphan scanner treats as in-use.
    const [filter, update] = updateMany.mock.calls[2];
    expect(filter.status).toBe('uploading');
    const cutoff = filter.createdAt.$lt as Date;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - UPLOAD_STALE_MS + 1);
    expect(update.$set.status).toBe('failed');
    expect(update.$set.lastError).toBe('Upload never completed');
  });

  it('leaves a freshly created uploading row alone', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const model = { updateMany } as never;
    await reapStale(model, 600_000, UPLOAD_STALE_MS);

    // The cutoff must be strictly in the past by the full timeout — a filter of
    // `{ $lt: now }` would fail every in-flight upload the instant it started.
    const cutoff = updateMany.mock.calls[2][0].createdAt.$lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(UPLOAD_STALE_MS);
  });
});
