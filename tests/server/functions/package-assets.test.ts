import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_PACKAGE_ITEMS } from '~/types/soundboard';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

const pkgFindOneLean = vi.fn();
const pkgFindOne = vi.fn((_query?: Record<string, unknown>) => ({ lean: pkgFindOneLean }));
vi.mock('~/server/db/models/AudioPackage', () => ({
  AudioPackage: { find: vi.fn(), findOne: pkgFindOne, findOneAndUpdate: vi.fn(), create: vi.fn() },
}));

const assetFindLean = vi.fn();
const assetFind = vi.fn((_query?: Record<string, unknown>) => ({ lean: assetFindLean }));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: { find: assetFind },
}));

function packageDoc(assetIds: string[], ownerId: string | null = null) {
  return {
    _id: 'p1',
    ownerId,
    name: 'System Set',
    description: null,
    items: assetIds.map((assetId, idx) => ({
      id: `i${idx}`,
      assetId,
      volume: 1,
      fadeSeconds: 2,
      loop: false,
      sortIndex: idx,
    })),
    moods: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function assetDoc(id: string, ownerId: string | null) {
  return {
    _id: id,
    ownerId,
    title: `asset-${id}`,
    kind: 'ambience',
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    peaks: [],
    renditions: {},
    status: 'ready',
    durationMs: null,
    durationSamples: null,
    loudnessTargetLufs: null,
    lastError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe('listPackageAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a package the caller cannot see, without querying assets at all', async () => {
    // The visibility-filtered findOne finds nothing — either the id is bogus,
    // or it's another user's private package. Either way, Gate 1 must stop
    // execution before Gate 2 ever runs.
    pkgFindOneLean.mockResolvedValue(null);
    const { listPackageAssets } = await import('~/server/functions/packages');
    await expect(listPackageAssets({ data: { packageId: 'p1' }, userId: 'u1' })).rejects.toThrow(
      /not found/i
    );
    // Asserting only the rejection would pass even with Gate 1 deleted,
    // because a later line (or a TypeError from a null pkg) throws anyway.
    // This is the assertion that actually proves no asset query ran.
    expect(assetFind).not.toHaveBeenCalled();
  });

  it('returns system-owned assets referenced by a system package', async () => {
    // The case that is broken today: a system package (ownerId: null)
    // referencing a system-owned asset (ownerId: null) must be playable by
    // any caller who can see the package.
    pkgFindOneLean.mockResolvedValue(packageDoc(['a1']));
    assetFindLean.mockResolvedValue([assetDoc('a1', null)]);
    const { listPackageAssets } = await import('~/server/functions/packages');
    const res = await listPackageAssets({ data: { packageId: 'p1' }, userId: 'u1' });

    const filter = vi.mocked(assetFind).mock.calls[0][0] as Record<string, unknown>;
    // Both clauses, not either alone — half a fix (just $in, or just $or)
    // would pass a weaker version of this assertion.
    expect(filter._id).toEqual({ $in: ['a1'] });
    expect(filter.$or).toEqual([{ ownerId: 'u1' }, { ownerId: null }]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe('a1');
  });

  it('does not return an asset the package does not reference', async () => {
    // The caller owns two assets (a1, a2); the package references only a1.
    // A resolver that ignores $in and just re-queries the owner's library
    // would pass every other test in this file — the only thing that catches
    // it is asserting the exact $in list passed to Mongo, since the mock
    // returns whatever it's told regardless of the query shape.
    pkgFindOneLean.mockResolvedValue(packageDoc(['a1'], 'u1'));
    assetFindLean.mockResolvedValue([assetDoc('a1', 'u1')]);
    const { listPackageAssets } = await import('~/server/functions/packages');
    await listPackageAssets({ data: { packageId: 'p1' }, userId: 'u1' });

    const filter = vi.mocked(assetFind).mock.calls[0][0] as Record<string, unknown>;
    expect(filter._id).toEqual({ $in: ['a1'] });
    expect((filter._id as { $in: string[] }).$in).not.toContain('a2');
  });

  it("returns all of a full package's assets, with no pagination boundary", async () => {
    // MAX_PACKAGE_ITEMS items — a 3-item fixture cannot detect the
    // pagination defect this task exists to fix (listAudioAssets caps at
    // 50 by default, 200 max). Imported, not hardcoded: if the cap is ever
    // raised, a literal 64 here would keep asserting the old bound and
    // silently stop testing the real one.
    const ids = Array.from({ length: MAX_PACKAGE_ITEMS }, (_, i) => `a${i}`);
    pkgFindOneLean.mockResolvedValue(packageDoc(ids, 'u1'));
    assetFindLean.mockResolvedValue(ids.map((id) => assetDoc(id, 'u1')));
    const { listPackageAssets } = await import('~/server/functions/packages');
    const res = await listPackageAssets({ data: { packageId: 'p1' }, userId: 'u1' });

    expect(res.items).toHaveLength(MAX_PACKAGE_ITEMS);
    const filter = vi.mocked(assetFind).mock.calls[0][0] as Record<string, unknown>;
    expect((filter._id as { $in: string[] }).$in).toHaveLength(MAX_PACKAGE_ITEMS);
  });

  it('does not report a "not found" to GlitchTip — same reasoning as getPackage', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    pkgFindOneLean.mockResolvedValue(null);
    const { listPackageAssets } = await import('~/server/functions/packages');
    await expect(listPackageAssets({ data: { packageId: 'p1' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });
});
