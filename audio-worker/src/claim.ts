export const MAX_ATTEMPTS = 3;

type ClaimModel = {
  findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => Promise<unknown>;
  updateMany: (f: unknown, u: unknown) => Promise<{ modifiedCount?: number }>;
};

/**
 * Atomically take the oldest pending asset. A single findOneAndUpdate is what
 * makes this safe with multiple workers — two cannot claim the same row.
 *
 * NOTE: this runs against the raw driver collection
 * (`mongoose.connection.collection(...)`), so the "give me the updated doc"
 * option is `returnDocument: 'after'`. Mongoose models use `new: true`; passing
 * that here is silently ignored and you get the pre-update document back.
 */
export async function claimNext<T>(model: ClaimModel, workerId: string): Promise<T | null> {
  const doc = await model.findOneAndUpdate(
    { status: 'pending' },
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
 */
export async function reapStale(model: ClaimModel, timeoutMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);

  const requeued = await model.updateMany(
    { status: 'processing', claimedAt: { $lt: cutoff }, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: 'pending', claimedAt: null, claimedBy: null } }
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

  return requeued.modifiedCount ?? 0;
}
