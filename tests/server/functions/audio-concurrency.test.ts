import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: () => true }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/functions/audio-quota', () => ({
  getUserStorageUsage: async () => ({ bytes: 0, assetCount: 1 }),
}));
const send = vi.hoisted(() => vi.fn());
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'test' }),
  getAudioUploadUrl: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
    updateMany: vi.fn(),
    countDocuments: vi.fn(),
  },
}));
vi.mock('~/server/db/models/AudioPackage', () => ({
  AudioPackage: { find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() },
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';
import { AudioPackage } from '~/server/db/models/AudioPackage';
import {
  bulkTagAudioAssets,
  confirmOnceVariantUpload,
  deleteAudioAsset,
  serializeAudioAsset,
} from '~/server/functions/audio';
import { bulkTagAudioAssetsSchema } from '~/types/schemas/audio';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(AudioAsset.countDocuments).mockResolvedValue(0);
});

it('refuses a bulk addition that would exceed the stored tag limit', async () => {
  const assetId = '507f1f77bcf86cd799439011';
  let storedTags: string[] = [];
  vi.mocked(AudioAsset.updateMany).mockImplementation((async (
    filter: {
      $expr: { $lte: [{ $size: { $setUnion: [unknown, { $literal: string[] }] } }, number] };
    },
    update: { $addToSet: { tags: { $each: string[] } } }
  ) => {
    const [count, limit] = filter.$expr.$lte;
    const merged = [...new Set([...storedTags, ...count.$size.$setUnion[1].$literal])];
    if (merged.length > limit) return { matchedCount: 0, modifiedCount: 0 };
    storedTags = [...new Set([...storedTags, ...update.$addToSet.tags.$each])];
    return { matchedCount: 1, modifiedCount: 1 };
  }) as never);
  const first = bulkTagAudioAssetsSchema.parse({
    ids: [assetId],
    tagMode: 'add',
    tags: Array.from({ length: 30 }, (_, index) => `tag-${index}`),
  });
  await bulkTagAudioAssets({ userId: 'owner', data: first });
  vi.mocked(AudioAsset.countDocuments).mockResolvedValue(1);
  const second = bulkTagAudioAssetsSchema.parse({
    ids: [assetId],
    tagMode: 'add',
    tags: ['extra'],
  });
  await expect(bulkTagAudioAssets({ userId: 'owner', data: second })).rejects.toThrow(
    '30-tag limit'
  );
  expect(storedTags).toEqual(first.tags);
  expect(AudioAsset.countDocuments).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerId: 'owner',
      $expr: { $gt: [expect.any(Object), 30] },
    })
  );
});

it('returns a worker once-variant failure separately from main playback status', () => {
  const result = serializeAudioAsset({
    _id: 'asset',
    ownerId: 'owner',
    status: 'ready',
    lastError: null,
    onceLastError: 'Audio file is completely silent',
    onceRenditions: {},
  });
  expect(result).toMatchObject({
    status: 'ready',
    lastError: null,
    onceLastError: 'Audio file is completely silent',
  });
});

it('re-reads a package after a concurrent edit instead of overwriting that edit', async () => {
  const deletedItem = { id: 'doomed', assetId: 'asset-old' };
  const survivor = { id: 'survivor', assetId: 'asset-live' };
  const addedItem = { id: 'new-edit', assetId: 'asset-new' };
  let stored = {
    _id: 'package',
    ownerId: 'owner',
    items: [deletedItem, survivor],
    moods: [],
    updatedAt: new Date(1000),
  };
  let edited = false;
  vi.mocked(AudioAsset.findOne).mockResolvedValue({ sourceKey: 'source' } as never);
  send.mockResolvedValue({});
  vi.mocked(AudioPackage.find).mockReturnValue({ lean: async () => [{ _id: 'package' }] } as never);
  vi.mocked(AudioPackage.findOne).mockReturnValue({
    lean: async () => {
      const snapshot = structuredClone(stored);
      if (!edited) {
        stored = { ...stored, items: [...stored.items, addedItem], updatedAt: new Date(2000) };
        edited = true;
      }
      return snapshot;
    },
  } as never);
  vi.mocked(AudioPackage.updateOne).mockImplementation((async (
    filter: { updatedAt: Date },
    update: { $set: Partial<typeof stored> }
  ) => {
    if (filter.updatedAt.getTime() !== stored.updatedAt.getTime()) return { matchedCount: 0 };
    stored = { ...stored, ...update.$set };
    return { matchedCount: 1 };
  }) as never);
  vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);
  await deleteAudioAsset({ userId: 'owner', data: { id: 'asset-old' } });
  expect(stored.items.map((item) => item.id)).toEqual(['survivor', 'new-edit']);
  expect(AudioPackage.updateOne).toHaveBeenCalledTimes(2);
});

it.each([100, 100_000_000])(
  'does not let a stale once-confirm mutate a newer attachment (%i bytes)',
  async (bytes) => {
    const snapshot = {
      _id: 'asset',
      ownerId: 'owner',
      status: 'uploading',
      variant: 'once',
      onceSourceKey: 'old-source',
    };
    let stored: Record<string, unknown> = { ...snapshot };
    vi.mocked(AudioAsset.findOne).mockResolvedValue(snapshot as never);
    send.mockImplementation(async () => {
      stored = { ...stored, onceSourceKey: 'new-unconfirmed-source' };
      return { ContentLength: bytes, ContentType: 'audio/wav' };
    });
    vi.mocked(AudioAsset.findOneAndUpdate).mockImplementation((async (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> }
    ) => {
      const matches = Object.entries(filter).every(([key, value]) => stored[key] === value);
      if (!matches) return null;
      stored = { ...stored, ...update.$set };
      return stored;
    }) as never);
    await expect(
      confirmOnceVariantUpload({ userId: 'owner', data: { assetId: 'asset' } })
    ).rejects.toThrow();
    expect(stored).toMatchObject({ status: 'uploading', onceSourceKey: 'new-unconfirmed-source' });
    expect(stored).not.toHaveProperty('onceSourceBytes');
    expect(send).toHaveBeenCalledTimes(1);
  }
);
