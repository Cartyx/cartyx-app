import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
  getAudioUploadUrl: vi.fn(async () => ({
    uploadUrl: 'https://signed/put',
    key: 'uploads/audio/1-a.wav',
    publicUrl: 'https://cdn.test/uploads/audio/1-a.wav',
  })),
}));
vi.mock('~/server/functions/audio-storage', () => ({
  resolveAudioStoragePrefix: vi.fn(async () => 'a1b2c3d4e5f60718293a4b5c6d7e8f90'),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: {
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    findOne: vi.fn(),
    deleteOne: vi.fn(),
  },
}));
vi.mock('~/server/db/models/AudioPackage', () => ({
  AudioPackage: {
    find: vi.fn(),
    updateOne: vi.fn(),
  },
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';
import { AudioPackage } from '~/server/db/models/AudioPackage';
import { serverCaptureException } from '~/server/utils/telemetry';

/** Mirrors a real `Model.find(...).lean()` chain — same convention as
 * `mockUpdateResult` in `audio-mutations.test.ts`. */
function mockAffectedPackages(docs: Record<string, unknown>[]) {
  vi.mocked(AudioPackage.find).mockReturnValue({
    lean: () => Promise.resolve(docs),
  } as never);
}

describe('deleteAudioAsset — package/mood pruning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue(undefined);
    vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);
    vi.mocked(AudioPackage.updateOne).mockResolvedValue({ acknowledged: true } as never);
  });

  it('removes the item AND the mood states that referenced it', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
    } as never);

    // Two items — one references the asset being deleted (i1 -> a1), one
    // doesn't (i2 -> a2). One mood whose states[] names BOTH, and the
    // surviving state (i2) carries real overrides so a rebuild-from-items
    // implementation (which would emit a fresh, default-only state) is
    // also caught.
    const item1 = {
      id: 'i1',
      assetId: 'a1',
      label: 'Thunder',
      volume: 1,
      fadeSeconds: 2,
      loop: false,
      sortIndex: 0,
    };
    const item2 = {
      id: 'i2',
      assetId: 'a2',
      label: 'Rain',
      volume: 1,
      fadeSeconds: 2,
      loop: true,
      sortIndex: 1,
    };
    const survivorState = { itemId: 'i2', playing: true, volume: 0.35, fadeSeconds: 3 };
    const droppedState = { itemId: 'i1', playing: true, volume: 0.7 };
    mockAffectedPackages([
      {
        _id: 'p1',
        ownerId: 'u1',
        items: [item1, item2],
        moods: [{ id: 'm1', name: 'Overhead', states: [droppedState, survivorState] }],
      },
    ]);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    const res = await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    expect(res).toEqual({ deleted: true });
    expect(AudioPackage.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = vi.mocked(AudioPackage.updateOne).mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: { items: unknown[]; moods: { states: unknown[] }[] } },
    ];
    expect(filter).toEqual({ _id: 'p1', ownerId: 'u1' });
    expect(update.$set.items).toEqual([item2]);
    expect(update.$set.moods).toHaveLength(1);
    expect(update.$set.moods[0].states).toHaveLength(1);
    // Deep-equal against the ORIGINAL survivor state object — catches a
    // rebuild-from-items fix that would produce a same-itemId state with
    // the override stripped.
    expect(update.$set.moods[0].states[0]).toEqual(survivorState);
  });

  it("never touches another owner's packages", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
    } as never);
    mockAffectedPackages([]);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    // Assert on the ACTUAL filter passed to the model, not on a mocked
    // return value — a mock returns whatever it's told regardless of what
    // the query actually asked for, so only inspecting the filter object
    // proves the ownership clause is really there.
    expect(AudioPackage.find).toHaveBeenCalledTimes(1);
    expect(vi.mocked(AudioPackage.find).mock.calls[0][0]).toEqual({
      ownerId: 'u1',
      'items.assetId': 'a1',
    });
  });

  it('leaves system packages alone', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
    } as never);
    mockAffectedPackages([]);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    // The prune filter must be a plain ownerId equality scoped to the
    // caller — never the read-side `packageVisibilityFilter` `$or`
    // ([{ ownerId: userId }, { ownerId: null }]) that `getPackage`/
    // `listPackages` use, which WOULD match a system package
    // (`ownerId: null`). No `$or` key at all is the structural proof that
    // a system package can never be matched by this query.
    const filter = vi.mocked(AudioPackage.find).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(filter).not.toHaveProperty('$or');
    expect(filter.ownerId).toBe('u1');
  });

  it('still deletes the asset when the prune throws', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
    } as never);
    vi.mocked(AudioPackage.find).mockImplementation(() => {
      throw new Error('Mongo unavailable');
    });

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    const res = await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    // The user asked for the asset to be gone — a prune failure must not
    // block the row delete.
    expect(res).toEqual({ deleted: true });
    expect(AudioAsset.deleteOne).toHaveBeenCalledTimes(1);
    expect(vi.mocked(AudioAsset.deleteOne).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });

    const reported = vi
      .mocked(serverCaptureException)
      .mock.calls.find(
        ([, , props]) =>
          (props as Record<string, unknown> | undefined)?.action ===
          'deleteAudioAsset.prunePackages'
      );
    expect(reported).toBeDefined();
    expect((reported?.[0] as Error).message).toMatch(/Mongo unavailable/);
  });
});
