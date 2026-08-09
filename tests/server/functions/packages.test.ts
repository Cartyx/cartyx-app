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

// `updatePackage` resolves every `items[].assetId` it is asked to write, so a
// draft cannot put back a pad whose audio was deleted underneath it (see
// `dropUnresolvableItems`). Default: every referenced id still exists, so the
// pre-existing tests below — none of which are about that check — are
// unaffected. Tests that care override `assetFindLean` explicitly.
const assetFindLean = vi.fn(async () => [] as { _id: unknown }[]);
const assetFind = vi.fn((_query?: unknown, _projection?: unknown) => ({ lean: assetFindLean }));
vi.mock('~/server/db/models/AudioAsset', () => ({ AudioAsset: { find: assetFind } }));

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

/**
 * What the stored `p1` is at, and the older revision a second tab would still
 * be holding. Deliberately an hour apart rather than a millisecond: a fixture
 * whose two timestamps differed only in sub-second digits would still pass if
 * the precondition were compared as a truncated string somewhere.
 */
const STORED_UPDATED_AT = new Date('2026-07-31T10:00:00.000Z');
const STALE_UPDATED_AT = new Date('2026-07-31T09:00:00.000Z');

const storedDoc = () => ({ ...baseDoc(), updatedAt: STORED_UPDATED_AT });

/**
 * A filter-EVALUATING fake, not a canned answer, and that distinction is the
 * whole test.
 *
 * A mock returns whatever it was told regardless of what the query asked, so
 * `findOneAndUpdateLean.mockResolvedValue(null)` would make a "stale write is
 * refused" test pass with the precondition deleted from the source — the
 * function would still see no document, still run the discriminating read,
 * and still throw the stale-write error. This fake instead applies the filter
 * it is actually handed to a stored document.
 *
 * Note the shape of the `updatedAt` clause specifically: an ABSENT
 * precondition MATCHES here. That is the property that gives the stale test
 * teeth — delete `updatedAt` from `updatePackage`'s filter and this fake
 * happily returns the document, so the write succeeds and the test fails on
 * its "rejects" assertion. A fake that refused whenever the clause was
 * missing would fail the same test for the opposite reason, and would prove
 * nothing about the source.
 */
function fenceTheModel() {
  findOneAndUpdateLean.mockImplementation(async () => {
    const filter = (vi.mocked(findOneAndUpdate).mock.calls.at(-1)?.[0] ?? {}) as {
      _id?: string;
      ownerId?: string;
      updatedAt?: Date;
    };
    if (filter._id !== 'p1' || filter.ownerId !== 'u1') return null;
    if (
      filter.updatedAt !== undefined &&
      filter.updatedAt.getTime() !== STORED_UPDATED_AT.getTime()
    ) {
      return null;
    }
    return storedDoc();
  });
  // The discriminating read `staleWriteOrNotFound` performs on the failure
  // path: `p1` DOES exist and IS `u1`'s, so a refusal for `u1` can only be a
  // stale write.
  findOneLean.mockResolvedValue({ _id: 'p1', updatedAt: STORED_UPDATED_AT });
}

describe('updatePackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fenceTheModel();
  });

  it('updates are owner-scoped, so a system package cannot be mutated', async () => {
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: { id: 'p1', expectedUpdatedAt: STORED_UPDATED_AT.toISOString(), name: 'x' },
      userId: 'u1',
    }).catch(() => {});
    const filter = vi.mocked(findOneAndUpdate).mock.calls[0][0];
    expect(filter).toEqual({ _id: 'p1', ownerId: 'u1', updatedAt: STORED_UPDATED_AT });
    expect(filter).not.toHaveProperty('$or');
  });

  it('sets only the fields actually provided', async () => {
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: { id: 'p1', expectedUpdatedAt: STORED_UPDATED_AT.toISOString(), name: 'New Name' },
      userId: 'u1',
    });
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
      data: { id: 'p1', expectedUpdatedAt: STORED_UPDATED_AT.toISOString(), name: 'New Name' },
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
    // `u2` fails the fake's ownership clause, and the discriminating read
    // finds nothing for `u2` either — a package that is not yours must stay
    // indistinguishable from one that does not exist.
    findOneLean.mockResolvedValue(null);
    const { updatePackage } = await import('~/server/functions/packages');
    await expect(
      updatePackage({
        data: { id: 'p1', expectedUpdatedAt: STORED_UPDATED_AT.toISOString(), name: 'x' },
        userId: 'u2',
      })
    ).rejects.toThrow(/not found/i);
  });
});

/**
 * Task 7: the editor replaces `items` and `moods` wholesale, so an unfenced
 * update is last-write-wins over entire arrays — an idle tab does not merely
 * lose the newer edit, it resurrects whatever the newer write removed
 * (including items `deleteAudioAsset`'s prune took out because their asset is
 * gone).
 */
describe('updatePackage optimistic concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fenceTheModel();
  });

  /**
   * The stale write. Both halves matter:
   *
   * - the FILTER assertion pins the precondition actually handed to Mongo, as
   *   a `Date` (a BSON date never equals a string, so shipping the raw ISO
   *   would refuse every save rather than only the stale ones — the "guard
   *   must not make every save fail" failure mode, arriving through the type
   *   rather than through the logic);
   * - the REJECTION comes from the filter-evaluating fake above, so it is the
   *   precondition doing the refusing rather than a canned `null`.
   */
  it('refuses a save built on a stale read, and hands Mongo the precondition as a Date', async () => {
    const { updatePackage } = await import('~/server/functions/packages');
    await expect(
      updatePackage({
        data: {
          id: 'p1',
          expectedUpdatedAt: STALE_UPDATED_AT.toISOString(),
          name: 'From the idle tab',
          items: [],
        },
        userId: 'u1',
      })
    ).rejects.toThrow(/changed somewhere else/i);

    const filter = vi.mocked(findOneAndUpdate).mock.calls[0][0] as { updatedAt?: unknown };
    expect(filter).toEqual({ _id: 'p1', ownerId: 'u1', updatedAt: STALE_UPDATED_AT });
    expect(filter.updatedAt).toBeInstanceOf(Date);
  });

  /**
   * "Distinguishable from a not-found" means two identities, not two
   * spellings of one. This asserts the identity the BROWSER sees — `.name`,
   * via the shared predicate — because the server's class does not survive
   * the server-fn wire and a UI keyed on `instanceof` would silently stop
   * recognising the refusal in production while every unit test still passed.
   */
  it('refuses with an identity distinguishable from a not-found, and files no GlitchTip event', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    const { isStalePackageWriteError } = await import('~/lib/soundboard/stale-write');
    const { updatePackage, PackageStaleWriteError, PackageClientError } =
      await import('~/server/functions/packages');

    const stale = await updatePackage({
      data: { id: 'p1', expectedUpdatedAt: STALE_UPDATED_AT.toISOString(), name: 'x' },
      userId: 'u1',
    }).catch((e: unknown) => e);

    expect(stale).toBeInstanceOf(PackageStaleWriteError);
    expect(isStalePackageWriteError(stale)).toBe(true);
    expect((stale as Error).name).toBe('PackageStaleWriteError');
    // Not a not-found, by message as well as by type: the two failures are
    // adjacent enough that a copy-paste of the wrong string is the likely
    // regression.
    expect((stale as Error).message).not.toMatch(/not found/i);
    // The token a "keep my edits" retry needs, so the retry is a fresh
    // compare-and-swap rather than an unfenced force.
    expect((stale as { currentUpdatedAt?: string }).currentUpdatedAt).toBe(
      STORED_UPDATED_AT.toISOString()
    );

    // The same run, through the OTHER door: nothing to update because the
    // package is not this caller's. Same `findOneAndUpdate` miss, different
    // refusal — which is exactly what the second read exists to decide.
    findOneLean.mockResolvedValue(null);
    const missing = await updatePackage({
      data: { id: 'p1', expectedUpdatedAt: STALE_UPDATED_AT.toISOString(), name: 'x' },
      userId: 'u2',
    }).catch((e: unknown) => e);

    expect(missing).toBeInstanceOf(PackageClientError);
    expect(missing).not.toBeInstanceOf(PackageStaleWriteError);
    expect(isStalePackageWriteError(missing)).toBe(false);
    expect((missing as Error).message).toMatch(/not found/i);

    // Neither refusal is a server fault, and both are caller-triggerable at
    // will (an open second tab; a guessed id) — so neither may author a
    // GlitchTip event.
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });

  /**
   * The guard must not make every save fail. Same fixture, same fake, same
   * code path — only the caller's expectation is current — and this must go
   * all the way through to the serialized result and the telemetry event, not
   * merely "not throw".
   */
  it('lets a save built on the current revision through', async () => {
    const { serverCaptureEvent } = await import('~/server/utils/telemetry');
    const { updatePackage } = await import('~/server/functions/packages');

    const res = await updatePackage({
      data: {
        id: 'p1',
        expectedUpdatedAt: STORED_UPDATED_AT.toISOString(),
        name: 'Storm Set',
        items: [],
      },
      userId: 'u1',
    });

    expect(res.id).toBe('p1');
    expect(vi.mocked(serverCaptureEvent)).toHaveBeenCalledTimes(1);
    // The success path must NOT pay for the discriminating read — that one
    // exists only to tell the two refusals apart.
    expect(vi.mocked(findOne)).not.toHaveBeenCalled();
    const filter = vi.mocked(findOneAndUpdate).mock.calls[0][0];
    expect(filter).toEqual({ _id: 'p1', ownerId: 'u1', updatedAt: STORED_UPDATED_AT });
  });

  /**
   * The discriminating read must repeat the ownership scope. Re-reading by
   * `_id` alone would answer "does this document exist" instead of "does it
   * exist for you", turning a probe against somebody else's package id into a
   * stale-write refusal — an existence oracle for documents the caller cannot
   * see. Asserted on the filter argument, because a mock that was told to
   * return a document returns it whatever the filter said.
   */
  it('scopes the discriminating read to the same owner, so another user stays invisible', async () => {
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: { id: 'p1', expectedUpdatedAt: STALE_UPDATED_AT.toISOString(), name: 'x' },
      userId: 'u1',
    }).catch(() => {});
    expect(vi.mocked(findOne).mock.calls[0][0]).toEqual({ _id: 'p1', ownerId: 'u1' });
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

/**
 * THE OTHER HALF OF THE OPTIMISTIC-CONCURRENCY FENCE.
 *
 * The fence's stated justification is that an unfenced whole-array replace
 * "RESURRECTS whatever the newer write removed, including the items
 * `deleteAudioAsset`'s prune took out because their asset no longer exists."
 * The fence REFUSES such a save — and the editor's conflict notice then offers
 * "Keep my edits and overwrite", which replays the same draft against the
 * newer revision. That is the right affordance, and without a check on the
 * server it was also a supported two-click path back into precisely the state
 * the fence exists to prevent: the deleted asset's pad returns, permanently
 * dangling, and nothing tells the GM it happened.
 *
 * These tests drive the SECOND write — the overwrite — because that is the
 * one the fence lets through.
 */
describe('updatePackage drops items whose asset no longer resolves', () => {
  const deadItem = {
    id: 'i-dead',
    assetId: 'a'.repeat(24),
    volume: 1,
    fadeSeconds: 2,
    loop: false,
    sortIndex: 0,
  };
  const liveItem = {
    id: 'i-live',
    assetId: 'b'.repeat(24),
    volume: 1,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fenceTheModel();
    // Only the live asset comes back — the other was deleted between the
    // editor's load and this save.
    assetFindLean.mockResolvedValue([{ _id: liveItem.assetId }]);
  });

  async function overwrite(items: unknown[], moods?: unknown[]) {
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: {
        id: 'p1',
        expectedUpdatedAt: STORED_UPDATED_AT.toISOString(),
        items,
        ...(moods ? { moods } : {}),
      },
      userId: 'u1',
    } as never);
    const [, update] = vi.mocked(findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    return update.$set;
  }

  it('writes only the items whose asset still exists', async () => {
    const set = await overwrite([deadItem, liveItem]);
    expect(set.items).toEqual([liveItem]);
  });

  it('prunes the mood states that referenced the dropped item', async () => {
    // Moods reference `item.id`, never `assetId`, so dropping an item without
    // this leaves states pointing at an id that no longer exists — the same
    // orphan `deleteAudioAsset`'s prune handles with the same helper.
    const survivor = { itemId: 'i-live', playing: true, volume: 0.35 };
    const orphan = { itemId: 'i-dead', playing: true, volume: 0.7 };
    const set = await overwrite(
      [deadItem, liveItem],
      [{ id: 'm1', name: 'Overhead', states: [orphan, survivor] }]
    );
    const moods = set.moods as { states: unknown[] }[];
    expect(moods).toHaveLength(1);
    expect(moods[0].states).toEqual([survivor]);
  });

  /**
   * EXISTENCE, NOT VISIBILITY — the distinction this function turns on.
   *
   * A package may legitimately reference an asset its owner cannot read: a
   * foreign-owned one, which `listPackageAssets` deliberately refuses to
   * return so the board renders the pad in its unresolved group. That asset
   * is ALIVE and that reference is intact. An ownership-scoped query here
   * cannot tell it apart from a deleted one and deletes it on the owner's
   * next save — the exact data loss this check exists to prevent, aimed at a
   * case that was working.
   *
   * The first version of this check was ownership-scoped and did precisely
   * that; `e2e/soundboard.spec.ts` caught it, because it seeds a
   * foreign-owned item for this reason. The unit mocks could not: a mongoose
   * mock returns what it was told regardless of the filter, so only an
   * assertion on the filter ITSELF pins this.
   */
  it('asks only whether the asset EXISTS, with no ownership clause', async () => {
    await overwrite([liveItem]);
    const [filter] = vi.mocked(assetFind).mock.calls[0] as [Record<string, unknown>, unknown];
    expect(filter).toEqual({ _id: { $in: [liveItem.assetId] } });
    expect(filter).not.toHaveProperty('$or');
    expect(filter).not.toHaveProperty('ownerId');
  });

  it('keeps an item whose asset exists but belongs to someone else', async () => {
    // The `find` resolves it — it exists — even though `listPackageAssets`
    // would refuse to return it to this caller. The board's unresolved group
    // is where that pad belongs; the package must not lose it.
    const foreignItem = { ...deadItem, id: 'i-foreign' };
    assetFindLean.mockResolvedValue([{ _id: liveItem.assetId }, { _id: foreignItem.assetId }]);

    const set = await overwrite([foreignItem, liveItem]);
    expect(set.items).toEqual([foreignItem, liveItem]);
  });

  it('leaves an all-live draft byte-identical, and does not touch moods it was not given', async () => {
    // The no-op case has to stay a genuine no-op: this check must not become
    // a silent rewrite of every save, and an omitted `moods` must stay
    // omitted rather than being materialised by the prune.
    const set = await overwrite([liveItem]);
    expect(set.items).toEqual([liveItem]);
    expect('moods' in set).toBe(false);
  });

  it('issues no asset query at all for a save that carries no items', async () => {
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: { id: 'p1', expectedUpdatedAt: STORED_UPDATED_AT.toISOString(), name: 'Renamed' },
      userId: 'u1',
    });
    expect(vi.mocked(assetFind)).not.toHaveBeenCalled();
  });
});

/**
 * The mood half of the same invariant: whatever this write leaves standing as
 * `items` and `moods` must be mutually consistent. Two cases the first cut of
 * the check got wrong, both found by re-reviewing its own diff.
 */
describe('updatePackage keeps moods consistent with the items it writes', () => {
  const deadItem = {
    id: 'i-dead',
    assetId: 'a'.repeat(24),
    volume: 1,
    fadeSeconds: 2,
    loop: false,
    sortIndex: 0,
  };
  const liveItem = {
    id: 'i-live',
    assetId: 'b'.repeat(24),
    volume: 1,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fenceTheModel();
    assetFindLean.mockResolvedValue([{ _id: liveItem.assetId }]);
  });

  function setFromCall() {
    const [, update] = vi.mocked(findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    return update.$set;
  }

  /**
   * `updatePackageSchema` allows `items` without `moods`. The editor always
   * sends both, so this is the caller the first version silently got wrong:
   * it dropped the dead item and left the STORED moods untouched, still naming
   * that item's id. Exactly the orphan the whole prune exists to avoid,
   * reintroduced by the fix for a different bug.
   */
  it('prunes the STORED moods when items are dropped and none were supplied', async () => {
    const survivor = { itemId: 'i-live', playing: true, volume: 0.35 };
    const orphan = { itemId: 'i-dead', playing: true, volume: 0.7 };
    findOneLean.mockResolvedValue({
      moods: [{ id: 'm1', name: 'Overhead', states: [orphan, survivor] }],
    });

    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: {
        id: 'p1',
        expectedUpdatedAt: STORED_UPDATED_AT.toISOString(),
        items: [deadItem, liveItem],
      },
      userId: 'u1',
    } as never);

    const set = setFromCall();
    expect(set.items).toEqual([liveItem]);
    const moods = set.moods as { states: unknown[] }[];
    expect(moods[0].states).toEqual([survivor]);
    // Owner-scoped, like every other read in this file.
    expect(vi.mocked(findOne).mock.calls[0][0]).toEqual({ _id: 'p1', ownerId: 'u1' });
  });

  it('does not read or write moods when nothing was dropped', async () => {
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: { id: 'p1', expectedUpdatedAt: STORED_UPDATED_AT.toISOString(), items: [liveItem] },
      userId: 'u1',
    } as never);

    // The extra read is on the failure path only — an ordinary save must not
    // pay for it, and an untouched `moods` must stay untouched.
    expect(vi.mocked(findOne)).not.toHaveBeenCalled();
    expect('moods' in setFromCall()).toBe(false);
  });

  /**
   * `items: []` with mood states in the payload is every state orphaned. The
   * first version returned early on the empty array and skipped mood pruning
   * entirely, so the guarantee held for 1..64 items and failed at 0 — the
   * shape of edge case that reads like an optimisation.
   */
  it('strips every mood state when the caller clears all items', async () => {
    const { updatePackage } = await import('~/server/functions/packages');
    await updatePackage({
      data: {
        id: 'p1',
        expectedUpdatedAt: STORED_UPDATED_AT.toISOString(),
        items: [],
        moods: [{ id: 'm1', name: 'Overhead', states: [{ itemId: 'i-live', playing: true }] }],
      },
      userId: 'u1',
    } as never);

    const moods = setFromCall().moods as { states: unknown[] }[];
    expect(moods[0].states).toEqual([]);
    // No ids to resolve, so no query either.
    expect(vi.mocked(assetFind)).not.toHaveBeenCalled();
  });
});
