import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the S3 client so this test can force a failure deterministically,
// without needing real ffmpeg or real R2 credentials. `send()` always
// rejects, which triggers processAsset's catch block on the very first R2
// call — before ffmpeg or peaks.ts are ever invoked, so those don't need
// mocking either.
vi.mock('@aws-sdk/client-s3', () => {
  class FakeS3Client {
    async send(): Promise<never> {
      throw new Error('simulated R2 failure');
    }
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand };
});

import { processAsset } from '../src/process.js';
import { MAX_ATTEMPTS, computeBackoffMs } from '../src/claim.js';
import { logger } from '../src/logger.js';

const WORKER = 'worker-test';

// r2() throws its own named R2ConfigError if these are absent — set fake
// values so the failure under test is the mocked S3 error, not a config
// error, and restore whatever was there before so this doesn't leak into
// other test files sharing the process.
const FAKE_R2_ENV = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  CDN_URL: 'https://cdn.example.test',
};
const originalEnv: Record<string, string | undefined> = {};

/** The raw driver always reports matchedCount; mirror it, or every write reads as lost. */
function fakeUpdateOne() {
  return vi.fn().mockResolvedValue({ matchedCount: 1 });
}

beforeEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) {
    originalEnv[key] = process.env[key];
  }
  Object.assign(process.env, FAKE_R2_ENV);
});

afterEach(() => {
  for (const key of Object.keys(FAKE_R2_ENV)) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

describe('processAsset retry semantics', () => {
  it('requeues to pending with lastError when attempts is below MAX_ATTEMPTS', async () => {
    const updateOne = fakeUpdateOne();
    const model = { updateOne } as never;

    await processAsset(
      model,
      {
        _id: 'asset-below-cap',
        sourceKey: 'uploads/audio/x.wav',
        attempts: MAX_ATTEMPTS - 1,
      },
      WORKER
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('pending');
    expect(update.$set.lastError).toContain('simulated R2 failure');
    expect(update.$set.claimedAt).toBeNull();
    expect(update.$set.claimedBy).toBeNull();
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it('gates the requeued row behind an exponential backoff instead of making it instantly claimable', async () => {
    const updateOne = fakeUpdateOne();
    const model = { updateOne } as never;

    const attempts = MAX_ATTEMPTS - 2;
    const before = Date.now();
    await processAsset(
      model,
      {
        _id: 'asset-backoff',
        sourceKey: 'uploads/audio/x.wav',
        attempts,
      },
      WORKER
    );
    const after = Date.now();

    const [, update] = updateOne.mock.calls[0];
    const next = update.$set.nextAttemptAt as Date;
    // Without nextAttemptAt the requeued row keeps its original createdAt, so
    // claimNext's `sort: { createdAt: 1 }` re-claims it on the very next loop
    // iteration and the whole retry budget is spent in milliseconds against a
    // fault that hasn't had time to clear.
    expect(next).toBeInstanceOf(Date);
    const expected = computeBackoffMs(attempts);
    expect(next.getTime()).toBeGreaterThanOrEqual(before + expected);
    expect(next.getTime()).toBeLessThanOrEqual(after + expected);
    expect(expected).toBeGreaterThan(0);
  });

  it('marks failed (not pending) when attempts is at MAX_ATTEMPTS', async () => {
    const updateOne = fakeUpdateOne();
    const model = { updateOne } as never;

    await processAsset(
      model,
      {
        _id: 'asset-at-cap',
        sourceKey: 'uploads/audio/x.wav',
        attempts: MAX_ATTEMPTS,
      },
      WORKER
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
    expect(update.$set.lastError).toContain('simulated R2 failure');
    expect(update.$set.claimedAt).toBeNull();
    expect(update.$set.claimedBy).toBeNull();
    // The success path and requeueForRetry both bump updatedAt; markFailed must
    // too, or a failed asset's row looks older than its actual last transition.
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    // Exhausting the budget against a TRANSIENT fault (here: R2 unreachable)
    // must leave the row retryable. `permanentFailure` is reserved for a source
    // the worker has actually judged unusable — conflating the two would make
    // the Retry button useless for exactly the failures it exists to recover
    // from.
    expect(update.$set.permanentFailure).toBe(false);
  });

  it('marks failed immediately for a malformed row with no sourceKey, without retrying', async () => {
    const updateOne = fakeUpdateOne();
    const model = { updateOne } as never;

    // attempts: 0 — if this were treated as a retryable error it would go
    // to `pending`. A missing sourceKey is a permanent condition (retrying
    // can never produce one), so it must fail immediately regardless of
    // the attempt count.
    await processAsset(model, { _id: 'asset-no-key', attempts: 0 }, WORKER);

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
    expect(update.$set.lastError).toBe('Asset has no sourceKey');
    expect(update.$set.permanentFailure).toBe(true);
  });

  it('treats a missing attempts field as already at the cap (fails, does not retry forever)', async () => {
    const updateOne = fakeUpdateOne();
    const model = { updateOne } as never;

    await processAsset(
      model,
      { _id: 'asset-no-attempts', sourceKey: 'uploads/audio/x.wav' },
      WORKER
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
  });
});

/**
 * B3. `claimNext` stamps `claimedBy` so ownership can be proven; before this,
 * nothing ever read it back and every terminal write filtered on `{ _id }`
 * alone. A worker whose claim the reaper revoked mid-job would then overwrite
 * the row a second worker had legitimately taken.
 */
describe('processAsset fences its writes on the claim it holds', () => {
  it.each([
    ['requeue', MAX_ATTEMPTS - 1],
    ['terminal failure', MAX_ATTEMPTS],
  ])('filters the %s write on claimedBy and status: processing', async (_label, attempts) => {
    const updateOne = fakeUpdateOne();
    const model = { updateOne } as never;

    await processAsset(model, { _id: 'a1', sourceKey: 'uploads/audio/x.wav', attempts }, WORKER);

    const [filter] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'a1', status: 'processing', claimedBy: WORKER });
  });

  it('fences the permanent-failure write too', async () => {
    const updateOne = fakeUpdateOne();
    const model = { updateOne } as never;

    await processAsset(model, { _id: 'a2', attempts: 0 }, WORKER);

    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'a2', status: 'processing', claimedBy: WORKER });
    expect(update.$set.permanentFailure).toBe(true);
  });

  it('logs when the write matched nothing — the reaper revoked a live claim', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const model = { updateOne } as never;

    await processAsset(
      model,
      { _id: 'a3', sourceKey: 'uploads/audio/x.wav', attempts: MAX_ATTEMPTS },
      WORKER
    );

    // Silently no-opping would hide a CLAIM_TIMEOUT_MS set below real
    // worst-case processing time, which is a config bug, not a normal event.
    expect(warn).toHaveBeenCalledTimes(1);
    const [context] = warn.mock.calls[0];
    expect(context).toMatchObject({ assetId: 'a3', workerId: WORKER });
  });

  it('stays quiet on a normal write', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const model = { updateOne: fakeUpdateOne() } as never;

    await processAsset(
      model,
      { _id: 'a4', sourceKey: 'uploads/audio/x.wav', attempts: MAX_ATTEMPTS },
      WORKER
    );

    expect(warn).not.toHaveBeenCalled();
  });
});
