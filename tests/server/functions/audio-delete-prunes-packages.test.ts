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
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';
import { AudioPackage } from '~/server/db/models/AudioPackage';
import { serverCaptureException } from '~/server/utils/telemetry';

/**
 * Drives BOTH halves of the prune's two-query read from one fixture list:
 * the `find` that collects candidate ids, and the per-package `findOne` that
 * loads one document at a time.
 *
 * The split is a memory bound (see the prune's own comment in
 * `~/server/functions/audio.ts` — the single unprojected `find` it replaced
 * could hold ~41 MiB of package documents at once). Mirroring it here rather
 * than flattening it back into one mock is deliberate: a fixture that served
 * whole documents from `find` would keep passing against a reverted
 * implementation, which is the failure mode this repo's mongoose mocks are
 * most prone to.
 */
function mockAffectedPackages(docs: Record<string, unknown>[]) {
  vi.mocked(AudioPackage.find).mockReturnValue({
    lean: () => Promise.resolve(docs.map((doc) => ({ _id: doc._id }))),
  } as never);
  vi.mocked(AudioPackage.findOne).mockImplementation(((filter: { _id: unknown }) => ({
    lean: () => Promise.resolve(docs.find((doc) => doc._id === filter._id) ?? null),
  })) as never);
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
    expect(filter).toEqual({ _id: 'p1', ownerId: 'u1', updatedAt: null });
    expect(update.$set.items).toEqual([item2]);
    expect(update.$set.moods).toHaveLength(1);
    expect(update.$set.moods[0].states).toHaveLength(1);
    // Deep-equal against the ORIGINAL survivor state object — catches a
    // rebuild-from-items fix that would produce a same-itemId state with
    // the override stripped.
    expect(update.$set.moods[0].states[0]).toEqual(survivorState);
  });

  /**
   * An UPPER-CASED asset id. `objectId` is `/^[0-9a-fA-F]{24}$/`, so upper-case
   * hex passes validation, and Mongo's own ObjectId cast is case-insensitive,
   * so the `find` above matches the package and the asset delete proceeds — but
   * `String(item.assetId)` always renders LOWER-case, so the original
   * `String(item.assetId) !== data.id` comparison was `true` for every item and
   * the `$set` wrote the array back untouched.
   *
   * The result was the worst possible combination: the asset and all six of its
   * R2 objects deleted, every referencing item surviving as a permanent
   * tombstone against the 64-item cap, and `pruneOrphanedMoodStates` no-opping
   * too because the "surviving items" it was handed were the unchanged
   * original. Task 20, defeated by the case of one request field.
   *
   * Uses a REAL 24-hex id, not the short `a1` fixtures the other tests use:
   * `a1` has no case to get wrong, which is exactly why nothing caught this.
   */
  it('prunes the item when the caller supplies the id in upper-case hex', async () => {
    const LOWER = '507f1f77bcf86cd799439011';
    const UPPER = LOWER.toUpperCase();

    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: LOWER,
      ownerId: 'u1',
      sourceKey: 'src-key',
    } as never);

    const doomed = {
      id: 'i1',
      // Server-derived, as a lean document renders it: lower-case.
      assetId: LOWER,
      volume: 1,
      fadeSeconds: 2,
      loop: false,
      sortIndex: 0,
    };
    const survivor = {
      id: 'i2',
      assetId: '507f1f77bcf86cd799439012',
      volume: 1,
      fadeSeconds: 2,
      loop: true,
      sortIndex: 1,
    };
    mockAffectedPackages([
      {
        _id: 'p1',
        ownerId: 'u1',
        items: [doomed, survivor],
        moods: [
          {
            id: 'm1',
            name: 'Overhead',
            states: [
              { itemId: 'i1', playing: true },
              { itemId: 'i2', playing: false },
            ],
          },
        ],
      },
    ]);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await deleteAudioAsset({ data: { id: UPPER }, userId: 'u1' });

    const [, update] = vi.mocked(AudioPackage.updateOne).mock.calls[0] as unknown as [
      unknown,
      { $set: { items: { id: string }[]; moods: { states: { itemId: string }[] }[] } },
    ];
    expect(update.$set.items).toEqual([survivor]);
    // And the mood state that named the removed item went with it — the prune
    // is driven by the surviving-items list, so a no-op on items silently
    // no-ops here too.
    expect(update.$set.moods[0].states).toEqual([{ itemId: 'i2', playing: false }]);
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
