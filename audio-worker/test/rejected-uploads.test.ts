import { afterEach, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { reapRejectedUploads, reapStale, type ClaimModel } from '../src/claim.js';
import { makeSourceDeleter } from '../src/process.js';

vi.mock('../src/heartbeat.js', () => ({ beat: vi.fn() }));
vi.mock('../src/telemetry.js', () => ({ captureException: vi.fn() }));
vi.mock('../src/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function collection() {
  const rows: Record<string, unknown>[] = [
    {
      _id: 'rejected',
      status: 'failed',
      confirmedAt: null,
      sourceKey: 'replayed.wav',
      createdAt: new Date(0),
    },
    {
      _id: 'retryable',
      status: 'failed',
      confirmedAt: new Date(0),
      sourceKey: 'accepted.wav',
      createdAt: new Date(0),
    },
    {
      _id: 'recent',
      status: 'failed',
      confirmedAt: null,
      sourceKey: 'live-url.wav',
      createdAt: new Date(10000),
    },
  ];
  const find = vi.fn((filter: Record<string, unknown>) => ({
    toArray: async () => {
      expect(filter).toMatchObject({
        status: 'failed',
        confirmedAt: null,
        sourceKey: { $type: 'string' },
      });
      return rows
        .filter(
          (row) =>
            row.status === filter.status &&
            row.confirmedAt == null &&
            typeof row.sourceKey === 'string' &&
            row.variant !== 'once' &&
            (row.createdAt as Date) < (filter.createdAt as { $lt: Date }).$lt
        )
        .map((row) => ({ ...row }));
    },
  }));
  const updateOne = vi.fn(
    async (
      filter: Record<string, unknown>,
      update: { $unset: Record<string, unknown>; $set: Record<string, unknown> }
    ) => {
      const row = rows.find((candidate) =>
        Object.entries(filter).every(([key, value]) => candidate[key] === value)
      );
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      for (const key of Object.keys(update.$unset)) delete row[key];
      return { matchedCount: 1 };
    }
  );
  return { rows, model: { find, updateOne } as unknown as ClaimModel, find, updateOne };
}

it('reclaims replayed rejected uploads after expiry without destroying retryable sources', async () => {
  const { model, rows } = collection();
  const objects = new Set(['replayed.wav', 'accepted.wav', 'live-url.wav']);
  const remove = vi.fn(async (keys: string[]) => {
    for (const key of keys) objects.delete(key);
  });
  await reapRejectedUploads(model, new Date(5000), remove);
  expect(objects).toEqual(new Set(['accepted.wav', 'live-url.wav']));
  expect(rows[0]).not.toHaveProperty('sourceKey');
  expect(rows[1].sourceKey).toBe('accepted.wav');
  await reapRejectedUploads(model, new Date(5000), remove);
  expect(remove).toHaveBeenCalledTimes(1);
});

it('retains failed deletions for a later retry', async () => {
  const { model, rows, updateOne } = collection();
  const remove = vi
    .fn()
    .mockRejectedValueOnce(new Error('R2 unavailable'))
    .mockResolvedValue(undefined);
  await reapRejectedUploads(model, new Date(5000), remove);
  expect(rows[0].sourceKey).toBe('replayed.wav');
  expect(updateOne).not.toHaveBeenCalled();
  await reapRejectedUploads(model, new Date(5000), remove);
  expect(rows[0]).not.toHaveProperty('sourceKey');
});

it('honors shutdown without starting rejected-upload cleanup', async () => {
  const { model, find } = collection();
  await reapRejectedUploads(model, new Date(5000), vi.fn(), () => false);
  expect(find).not.toHaveBeenCalled();
});

it('waits at least fifteen minutes even when upload timeout is configured below URL expiry', async () => {
  const now = Date.now();
  const find = vi.fn((_filter: Record<string, unknown>) => ({ toArray: async () => [] }));
  const model = {
    find,
    updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
  } as unknown as ClaimModel;
  await reapStale(model, 1000, 1000, vi.fn());
  const filter = find.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .find((query) => query.status === 'failed');
  expect((filter?.createdAt as { $lt: Date }).$lt.getTime()).toBeLessThanOrEqual(
    now - 900000 + 100
  );
});

it('treats partial R2 batch deletion errors as failures so cleanup cannot forget those keys', async () => {
  for (const name of [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'CDN_URL',
  ])
    vi.stubEnv(name, 'test');
  vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
    Errors: [{ Key: 'replayed.wav', Code: 'AccessDenied' }],
  } as never);
  await expect(makeSourceDeleter()(['replayed.wav'])).rejects.toThrow(
    'R2 refused to delete 1 audio objects'
  );
});
