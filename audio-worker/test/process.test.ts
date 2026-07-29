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
  return { S3Client: FakeS3Client, GetObjectCommand, PutObjectCommand };
});

import { processAsset } from '../src/process.js';
import { MAX_ATTEMPTS } from '../src/claim.js';

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
});

describe('processAsset retry semantics', () => {
  it('requeues to pending with lastError when attempts is below MAX_ATTEMPTS', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = { updateOne } as never;

    await processAsset(model, {
      _id: 'asset-below-cap',
      sourceKey: 'uploads/audio/x.wav',
      attempts: MAX_ATTEMPTS - 1,
    });

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'asset-below-cap' });
    expect(update.$set.status).toBe('pending');
    expect(update.$set.lastError).toContain('simulated R2 failure');
    expect(update.$set.claimedAt).toBeNull();
    expect(update.$set.claimedBy).toBeNull();
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it('marks failed (not pending) when attempts is at MAX_ATTEMPTS', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = { updateOne } as never;

    await processAsset(model, {
      _id: 'asset-at-cap',
      sourceKey: 'uploads/audio/x.wav',
      attempts: MAX_ATTEMPTS,
    });

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'asset-at-cap' });
    expect(update.$set.status).toBe('failed');
    expect(update.$set.lastError).toContain('simulated R2 failure');
    expect(update.$set.claimedAt).toBeNull();
    expect(update.$set.claimedBy).toBeNull();
  });

  it('marks failed immediately for a malformed row with no sourceKey, without retrying', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = { updateOne } as never;

    // attempts: 0 — if this were treated as a retryable error it would go
    // to `pending`. A missing sourceKey is a permanent condition (retrying
    // can never produce one), so it must fail immediately regardless of
    // the attempt count.
    await processAsset(model, { _id: 'asset-no-key', attempts: 0 });

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'asset-no-key' });
    expect(update.$set.status).toBe('failed');
    expect(update.$set.lastError).toBe('Asset has no sourceKey');
  });

  it('treats a missing attempts field as already at the cap (fails, does not retry forever)', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = { updateOne } as never;

    await processAsset(model, { _id: 'asset-no-attempts', sourceKey: 'uploads/audio/x.wav' });

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
  });
});
