import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

const findLean = vi.fn();
const findSort = vi.fn((_sort?: Record<string, unknown>) => ({ lean: findLean }));
const find = vi.fn((_query?: Record<string, unknown>, _projection?: Record<string, unknown>) => ({
  sort: findSort,
}));
const findOneLean = vi.fn();
const findOne = vi.fn((_query?: Record<string, unknown>) => ({ lean: findOneLean }));
const findOneAndUpdateLean = vi.fn();
const findOneAndUpdate = vi.fn((_query?: unknown, _update?: unknown, _opts?: unknown) => ({
  lean: findOneAndUpdateLean,
}));
const create = vi.fn();
const deleteOne = vi.fn();
const countDocuments = vi.fn(async (_filter?: Record<string, unknown>) => 0);

vi.mock('~/server/db/models/AudioPackage', () => ({
  AudioPackage: { find, findOne, findOneAndUpdate, create, deleteOne, countDocuments },
}));

const baseDoc = () => ({
  _id: 'p1',
  ownerId: 'u1',
  name: 'Storm Set',
  description: null,
  items: [],
  moods: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('packageVisibilityFilter', () => {
  it('is exactly $or: [{ownerId: userId}, {ownerId: null}]', async () => {
    const { packageVisibilityFilter } = await import('~/server/functions/packages');
    expect(packageVisibilityFilter('u1')).toEqual({
      $or: [{ ownerId: 'u1' }, { ownerId: null }],
    });
  });
});

describe('listPackages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countDocuments.mockResolvedValue(0);
    findLean.mockResolvedValue([]);
  });

  /**
   * The list is the ONLY unbounded read in this file — every other one is
   * `_id`-scoped to a single document — and it fires on every
   * `/audio/packages` visit and every soundboard mount. A maxed package (64
   * items with 200-char labels, 32 moods of 64 states, a 2000-char
   * description) serializes to ~410 KiB, essentially all of it `items`/
   * `moods`, and the web pod is `replicaCount: 1` at 512Mi. Loading whole
   * documents here made one user's package count an out-of-memory kill for
   * every user of the site, retriggered by the victim's own next page load.
   *
   * Asserted on the projection actually handed to the model, not on the
   * serialized output: a mock returns whatever it was told regardless of what
   * the query asked for, so only the argument itself proves the arrays never
   * left Mongo.
   */
  it('projects items/moods away and asks Mongo for their sizes instead', async () => {
    const { listPackages } = await import('~/server/functions/packages');
    await listPackages({ userId: 'u1' });
    const projection = vi.mocked(find).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(projection).toBeDefined();
    // Neither array may be requested — not as `1`, and not as `0` either: a
    // `{ items: 0 }` exclusion projection cannot coexist with the inclusions
    // this needs, and would silently return every other field too.
    expect(projection).not.toHaveProperty('items');
    expect(projection).not.toHaveProperty('moods');
    expect(projection.itemCount).toEqual({ $size: { $ifNull: ['$items', []] } });
    expect(projection.moodCount).toEqual({ $size: { $ifNull: ['$moods', []] } });
  });

  it('serializes counts, and never an items/moods array', async () => {
    findLean.mockResolvedValue([{ ...baseDoc(), itemCount: 7, moodCount: 3 }]);
    const { listPackages } = await import('~/server/functions/packages');
    const res = await listPackages({ userId: 'u1' });
    expect(res.items[0].itemCount).toBe(7);
    expect(res.items[0].moodCount).toBe(3);
    expect(res.items[0]).not.toHaveProperty('items');
    expect(res.items[0]).not.toHaveProperty('moods');
  });

  /**
   * A document written before the counts existed — or any document Mongo
   * returns without the field — must serialize as 0, not `NaN` or a crash.
   */
  it('treats a missing count as zero', async () => {
    findLean.mockResolvedValue([baseDoc()]);
    const { listPackages } = await import('~/server/functions/packages');
    const res = await listPackages({ userId: 'u1' });
    expect(res.items[0].itemCount).toBe(0);
    expect(res.items[0].moodCount).toBe(0);
  });

  it('reads are visible to the owner and to everyone for system packages', async () => {
    const { listPackages } = await import('~/server/functions/packages');
    await listPackages({ userId: 'u1' });
    expect(vi.mocked(find).mock.calls[0][0]).toEqual({
      $or: [{ ownerId: 'u1' }, { ownerId: null }],
    });
  });

  it('serializes the rows it gets back', async () => {
    findLean.mockResolvedValue([baseDoc()]);
    const { listPackages } = await import('~/server/functions/packages');
    const res = await listPackages({ userId: 'u1' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe('p1');
    expect(res.items[0].ownerId).toBe('u1');
  });

  it('serializes a system package (null ownerId) without throwing', async () => {
    findLean.mockResolvedValue([{ ...baseDoc(), ownerId: null }]);
    const { listPackages } = await import('~/server/functions/packages');
    const res = await listPackages({ userId: 'u1' });
    expect(res.items[0].ownerId).toBeNull();
  });

  it('tags telemetry with the session identity, not the Mongo id', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    findLean.mockRejectedValue(new Error('atlas is down'));
    const { listPackages } = await import('~/server/functions/packages');
    await expect(
      listPackages({ userId: 'mongo-id-1', sessionUserId: 'provider-id-1' })
    ).rejects.toThrow('atlas is down');
    expect(vi.mocked(serverCaptureException).mock.calls[0][1]).toBe('provider-id-1');
  });
});

describe('getPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads through the visibility filter, scoped to the requested id', async () => {
    findOneLean.mockResolvedValue(baseDoc());
    const { getPackage } = await import('~/server/functions/packages');
    await getPackage({ data: { id: 'p1' }, userId: 'u1' });
    expect(vi.mocked(findOne).mock.calls[0][0]).toEqual({
      _id: 'p1',
      $or: [{ ownerId: 'u1' }, { ownerId: null }],
    });
  });

  it('serializes a system package (ownerId: null) in the response without rejecting it', async () => {
    findOneLean.mockResolvedValue({ ...baseDoc(), ownerId: null });
    const { getPackage } = await import('~/server/functions/packages');
    const res = await getPackage({ data: { id: 'p1' }, userId: 'u2' });
    expect(res.ownerId).toBeNull();
  });

  it('throws "not found" when the model returns no document', async () => {
    findOneLean.mockResolvedValue(null);
    const { getPackage } = await import('~/server/functions/packages');
    await expect(getPackage({ data: { id: 'p1' }, userId: 'u2' })).rejects.toThrow(/not found/i);
  });

  it('does not report a "not found" to GlitchTip — it is the caller asking about a document it cannot see, not a server fault', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    findOneLean.mockResolvedValue(null);
    const { getPackage } = await import('~/server/functions/packages');
    await expect(getPackage({ data: { id: 'p1' }, userId: 'u2' })).rejects.toThrow(/not found/i);
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });
});

describe('createPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countDocuments.mockResolvedValue(0);
  });

  /**
   * The cap, and the query that enforces it. `ownerId: userId` ALONE — never
   * `packageVisibilityFilter`'s `$or`, which also matches `ownerId: null`:
   * counting the shared system catalogue against a user's own allowance would
   * mean phase 3 publishing packages silently consumed everyone's budget, and
   * (once the catalogue passed the cap) locked every user out of creating any
   * package at all. Asserted on the filter itself, because a mocked count
   * returns the same number whatever it was asked.
   */
  it("counts only the caller's own packages before inserting", async () => {
    create.mockResolvedValue({ toObject: () => baseDoc() });
    const { createPackage } = await import('~/server/functions/packages');
    await createPackage({ data: { name: 'Storm Set', items: [], moods: [] }, userId: 'u1' });
    expect(countDocuments).toHaveBeenCalledTimes(1);
    expect(vi.mocked(countDocuments).mock.calls[0][0]).toEqual({ ownerId: 'u1' });
  });

  it('refuses a create at the cap, and writes nothing', async () => {
    const { MAX_PACKAGES_PER_USER } = await import('~/types/soundboard');
    countDocuments.mockResolvedValue(MAX_PACKAGES_PER_USER);
    const { createPackage } = await import('~/server/functions/packages');
    await expect(
      createPackage({ data: { name: 'Storm Set', items: [], moods: [] }, userId: 'u1' })
    ).rejects.toThrow(/maximum of 100 sound packages/i);
    // The count is taken BEFORE the insert precisely so a refused create has
    // not already written the document it is refusing.
    expect(create).not.toHaveBeenCalled();
  });

  it('allows the create that lands exactly on the cap', async () => {
    const { MAX_PACKAGES_PER_USER } = await import('~/types/soundboard');
    countDocuments.mockResolvedValue(MAX_PACKAGES_PER_USER - 1);
    create.mockResolvedValue({ toObject: () => baseDoc() });
    const { createPackage } = await import('~/server/functions/packages');
    await expect(
      createPackage({ data: { name: 'Storm Set', items: [], moods: [] }, userId: 'u1' })
    ).resolves.toBeDefined();
  });

  /**
   * Hitting a resource cap is the caller's own doing and entirely expected —
   * a client retrying at the cap would otherwise author one GlitchTip event
   * per click, which is the exact hazard `PackageClientError` exists for.
   */
  it('does not report a cap rejection to GlitchTip', async () => {
    const { MAX_PACKAGES_PER_USER } = await import('~/types/soundboard');
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    countDocuments.mockResolvedValue(MAX_PACKAGES_PER_USER);
    const { createPackage } = await import('~/server/functions/packages');
    await expect(
      createPackage({ data: { name: 'Storm Set', items: [], moods: [] }, userId: 'u1' })
    ).rejects.toThrow();
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });

  it('creates a package owned by the caller', async () => {
    create.mockResolvedValue({
      toObject: () => baseDoc(),
    });
    const { createPackage } = await import('~/server/functions/packages');
    await createPackage({
      data: { name: 'Storm Set', items: [], moods: [] },
      userId: 'u1',
    });
    expect(vi.mocked(create).mock.calls[0][0]).toMatchObject({ ownerId: 'u1', name: 'Storm Set' });
  });

  it('returns the serialized created package', async () => {
    create.mockResolvedValue({ toObject: () => baseDoc() });
    const { createPackage } = await import('~/server/functions/packages');
    const res = await createPackage({
      data: { name: 'Storm Set', items: [], moods: [] },
      userId: 'u1',
    });
    expect(res.id).toBe('p1');
    expect(res.name).toBe('Storm Set');
  });
});

describe('updatePackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates are owner-scoped, so a system package cannot be mutated', async () => {
    findOneAndUpdateLean.mockResolvedValue(null);
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({ data: { id: 'p1', name: 'x' }, userId: 'u1' }).catch(() => {});
    const filter = vi.mocked(findOneAndUpdate).mock.calls[0][0];
    expect(filter).toEqual({ _id: 'p1', ownerId: 'u1' });
    expect(filter).not.toHaveProperty('$or');
  });

  it('sets only the fields actually provided', async () => {
    findOneAndUpdateLean.mockResolvedValue(baseDoc());
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({ data: { id: 'p1', name: 'New Name' }, userId: 'u1' });
    const [, update] = vi.mocked(findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.name).toBe('New Name');
    expect('items' in update.$set).toBe(false);
    expect('moods' in update.$set).toBe(false);
  });

  /**
   * `serverCaptureEvent(distinctId, event, properties)` — distinctId FIRST.
   * Phase 1's own plan had the first two arguments swapped and shipped that
   * way; nothing about the call site's own shape would catch a transposition
   * (both are strings), so this pins the exact tuple rather than checking
   * each argument in isolation, and uses the session identity (not the Mongo
   * id) so a swap fails on BOTH the position and the value.
   */
  it('emits package_updated with distinctId first, tagged with the session identity', async () => {
    const { serverCaptureEvent } = await import('~/server/utils/telemetry');
    findOneAndUpdateLean.mockResolvedValue(baseDoc());
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: { id: 'p1', name: 'New Name' },
      userId: 'mongo-id-1',
      sessionUserId: 'provider-id-1',
    });
    expect(vi.mocked(serverCaptureEvent).mock.calls[0]).toEqual([
      'provider-id-1',
      'package_updated',
      { packageId: 'p1' },
    ]);
  });

  it('throws "not found" when the model returns no document (does not distinguish absent vs. another owner)', async () => {
    findOneAndUpdateLean.mockResolvedValue(null);
    const { updatePackage } = await import('~/server/functions/packages');
    await expect(updatePackage({ data: { id: 'p1', name: 'x' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
  });
});

describe('deletePackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes are owner-scoped too', async () => {
    deleteOne.mockResolvedValue({ deletedCount: 1 });
    const { deletePackage } = await import('~/server/functions/packages');
    await deletePackage({ data: { id: 'p1' }, userId: 'u1' });
    const filter = vi.mocked(deleteOne).mock.calls[0][0];
    expect(filter).toEqual({ _id: 'p1', ownerId: 'u1' });
    expect(filter).not.toHaveProperty('$or');
  });

  it("throws and does not report to GlitchTip as a server fault when nothing matched (another owner's package)", async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    deleteOne.mockResolvedValue({ deletedCount: 0 });
    const { deletePackage } = await import('~/server/functions/packages');
    await expect(deletePackage({ data: { id: 'p1' }, userId: 'u2' })).rejects.toThrow(/not found/i);
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });
});

describe('serializePackage normalises Mongoose null defaults to undefined', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Task 2's model defaults `label`, `volumeJitter`, `panJitter`,
   * `randomIntervalMin` and `randomIntervalMax` to `null`, but Task 1 types
   * those fields as bare-optional (`label?: string`), never `| null`. A naive
   * `as AudioPackageData` cast would compile and ship `null` straight into a
   * client that expects `undefined` — Task 8's `mood ?? item` resolution
   * would then treat "explicitly null" differently than "absent". This test
   * fails if the serializer casts instead of normalising.
   */
  it('serializes null item fields as undefined, not null', async () => {
    findOneLean.mockResolvedValue({
      ...baseDoc(),
      items: [
        {
          id: 'i1',
          assetId: 'a1',
          label: null,
          volume: 1,
          fadeSeconds: 2,
          loop: false,
          randomIntervalMin: null,
          randomIntervalMax: null,
          volumeJitter: null,
          panJitter: null,
          sortIndex: 0,
        },
      ],
    });
    const { getPackage } = await import('~/server/functions/packages');
    const res = await getPackage({ data: { id: 'p1' }, userId: 'u1' });
    const item = res.items[0];
    expect(item.label).toBeUndefined();
    expect(item.randomIntervalMin).toBeUndefined();
    expect(item.randomIntervalMax).toBeUndefined();
    expect(item.volumeJitter).toBeUndefined();
    expect(item.panJitter).toBeUndefined();
    // A meaningful, non-null value must survive untouched — the assertions
    // above prove `null` is normalised away, this one proves normalisation
    // isn't blanket-clobbering every field.
    expect(item.volume).toBe(1);
  });

  it('serializes null mood-state fields as undefined, not null', async () => {
    findOneLean.mockResolvedValue({
      ...baseDoc(),
      moods: [
        {
          id: 'm1',
          name: 'Calm',
          states: [
            {
              itemId: 'i1',
              playing: true,
              volume: null,
              fadeSeconds: null,
              randomIntervalMin: null,
              randomIntervalMax: null,
            },
          ],
        },
      ],
    });
    const { getPackage } = await import('~/server/functions/packages');
    const res = await getPackage({ data: { id: 'p1' }, userId: 'u1' });
    const state = res.moods[0].states[0];
    expect(state.playing).toBe(true);
    expect(state.volume).toBeUndefined();
    expect(state.fadeSeconds).toBeUndefined();
    expect(state.randomIntervalMin).toBeUndefined();
    expect(state.randomIntervalMax).toBeUndefined();
  });
});
