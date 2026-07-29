import { describe, it, expect, vi } from 'vitest';
import { claimNext, reapStale } from '../src/claim.js';

describe('claimNext', () => {
  it('claims the oldest pending asset atomically and marks it processing', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ _id: 'a1' });
    const model = { findOneAndUpdate } as never;

    const doc = await claimNext(model, 'worker-1');
    expect(doc).toEqual({ _id: 'a1' });

    const [filter, update, opts] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ status: 'pending' });
    expect(update.$set.status).toBe('processing');
    expect(update.$set.claimedBy).toBe('worker-1');
    expect(update.$inc).toEqual({ attempts: 1 });
    expect(opts.sort).toEqual({ createdAt: 1 });
    // Raw driver option. `new: true` is the Mongoose *model* option and would
    // silently hand back the pre-update document here.
    expect(opts.returnDocument).toBe('after');
  });

  it('returns null when nothing is pending', async () => {
    const model = { findOneAndUpdate: vi.fn().mockResolvedValue(null) } as never;
    expect(await claimNext(model, 'w')).toBeNull();
  });
});

describe('reapStale', () => {
  it('returns processing rows under the attempt cap to pending', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const model = { updateMany } as never;

    const n = await reapStale(model, 600_000);
    expect(n).toBe(2);

    const [filter, update] = updateMany.mock.calls[0];
    expect(filter.status).toBe('processing');
    expect(filter.claimedAt.$lt).toBeInstanceOf(Date);
    expect(filter.attempts.$lt).toBe(3);
    expect(update.$set.status).toBe('pending');
  });

  it('fails rows that have exhausted their attempts', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const model = { updateMany } as never;
    await reapStale(model, 600_000);
    const secondCall = updateMany.mock.calls[1];
    expect(secondCall[0].attempts.$gte).toBe(3);
    expect(secondCall[1].$set.status).toBe('failed');
  });
});
