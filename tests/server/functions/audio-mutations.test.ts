import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
  getAudioUploadUrl: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: {
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    findOne: vi.fn(),
    deleteOne: vi.fn(),
  },
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';

describe('updateAudioAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes the update to the owner', async () => {
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as never);
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await updateAudioAsset({ data: { id: 'a1', title: 'New' }, userId: 'u1' });
    expect(vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });
  });

  it('sets only the fields actually provided, leaving the rest untouched', async () => {
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as never);
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await updateAudioAsset({ data: { id: 'a1', title: 'New Title' }, userId: 'u1' });
    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    // Only `title` (plus the always-bumped updatedAt) should be present — kind,
    // environment, mood, intensity, and tags were never passed and must not appear
    // as explicit `undefined`/null overwrites.
    expect(update.$set).toEqual({ title: 'New Title', updatedAt: expect.any(Date) });
    expect('kind' in update.$set).toBe(false);
    expect('tags' in update.$set).toBe(false);
  });

  it('normalizes tags when tags are provided', async () => {
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as never);
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await updateAudioAsset({
      data: { id: 'a1', tags: [' Storm ', '#storm', 'RAIN'] },
      userId: 'u1',
    });
    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.tags).toEqual(['storm', 'rain']);
  });

  it('throws when the asset does not exist (or belongs to another owner)', async () => {
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue(null as never);
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await expect(
      updateAudioAsset({ data: { id: 'a1', title: 'X' }, userId: 'u2' })
    ).rejects.toThrow(/not found/i);
  });
});

describe('bulkTagAudioAssets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('add mode uses $addToSet with $each and normalizes tags, scoped by ownerId', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 2 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    const res = await bulkTagAudioAssets({
      data: { ids: ['a', 'b'], tags: [' Storm ', '#storm'], tagMode: 'add' },
      userId: 'u1',
    });

    const [filter, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ _id: { $in: ['a', 'b'] }, ownerId: 'u1' });
    expect(update.$addToSet).toEqual({ tags: { $each: ['storm'] } });
    expect((update.$set as Record<string, unknown>).tags).toBeUndefined();
    expect(res).toEqual({ modified: 2 });
  });

  it('replace mode uses $set with the full normalized tag array, scoped by ownerId', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    await bulkTagAudioAssets({
      data: { ids: ['a'], tags: [' Storm ', 'RAIN'], tagMode: 'replace' },
      userId: 'u1',
    });

    const [filter, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ _id: { $in: ['a'] }, ownerId: 'u1' });
    expect(update.$addToSet).toBeUndefined();
    expect((update.$set as Record<string, unknown>).tags).toEqual(['storm', 'rain']);
  });

  it('sets facet fields via $set when provided, without requiring tags', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    await bulkTagAudioAssets({
      data: { ids: ['a'], environment: ['forest'], intensity: 3, tagMode: 'add' },
      userId: 'u1',
    });

    const [, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect((update.$set as Record<string, unknown>).environment).toEqual(['forest']);
    expect((update.$set as Record<string, unknown>).intensity).toBe(3);
    expect(update.$addToSet).toBeUndefined();
  });
});

describe('deleteAudioAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes every R2 object (source + each rendition) before deleting the row, scoped by ownerId', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
      renditions: { opus: { key: 'opus-key' }, aac: { key: 'aac-key' } },
    } as never);
    vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    const res = await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    expect(vi.mocked(AudioAsset.findOne).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });

    expect(send).toHaveBeenCalledTimes(3);
    const calls = send.mock.calls.map(([cmd]) => cmd as DeleteObjectCommand);
    for (const cmd of calls) expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    const keys = calls.map((c) => c.input.Key).sort();
    expect(keys).toEqual(['aac-key', 'opus-key', 'src-key']);
    for (const cmd of calls) expect(cmd.input.Bucket).toBe('b');

    expect(vi.mocked(AudioAsset.deleteOne).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });
    expect(res).toEqual({ deleted: true });
  });

  it('deletes only the objects that exist when a rendition is missing', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
      renditions: { opus: { key: 'opus-key' } },
    } as never);
    vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    expect(send).toHaveBeenCalledTimes(2);
    const keys = send.mock.calls.map(([cmd]) => (cmd as DeleteObjectCommand).input.Key).sort();
    expect(keys).toEqual(['opus-key', 'src-key']);
  });

  it("does not touch R2 or delete the row for another owner's asset", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(null as never);
    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await expect(deleteAudioAsset({ data: { id: 'a1' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
    expect(vi.mocked(AudioAsset.findOne).mock.calls[0][0]).toEqual({ _id: 'a1', ownerId: 'u2' });
    expect(send).not.toHaveBeenCalled();
    expect(AudioAsset.deleteOne).not.toHaveBeenCalled();
  });
});
