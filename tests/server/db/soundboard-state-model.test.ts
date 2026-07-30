import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/*
 * setup.ts mocks mongoose with a MockSchema that does not track paths (and
 * whose `model()` returns a plain object, not a constructor). Schema-level
 * tests need real mongoose, so unmock + resetModules and dynamically import —
 * the same approach used in tests/server/db/audio-package-model.test.ts.
 */
describe('SoundboardState model', () => {
  let SoundboardState: any;

  beforeAll(async () => {
    vi.unmock('mongoose');
    vi.resetModules();
    const mod = await import('~/server/db/models/SoundboardState');
    SoundboardState = mod.SoundboardState;
  });

  afterAll(() => {
    // Restore the global mongoose mock so other tests in this worker are unaffected.
    vi.doMock('mongoose', () => {
      class MockSchema {
        constructor(_def?: unknown) {}
        static Types = { ObjectId: String };
        pre(_hook: string, _fn: unknown) {}
        index(_def?: unknown) {}
      }
      const mockModel = vi.fn(() => ({
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        findById: vi.fn(),
        find: vi.fn(),
        create: vi.fn(),
        deleteOne: vi.fn(),
        deleteMany: vi.fn(),
      }));
      return {
        default: {
          connect: vi.fn(),
          connection: { readyState: 0 },
          Schema: MockSchema,
          model: mockModel,
          models: {},
        },
        Schema: MockSchema,
        model: mockModel,
        models: {},
        connection: { readyState: 0 },
      };
    });
    vi.resetModules();
  });

  // Baseline positive control every negative test below is measured against:
  // the only fields present are the two genuinely required ones (campaignId,
  // updatedBy). packageId/moodId are nullable, items defaults to [],
  // masterVolume defaults — so this must validate cleanly.
  it('allows a document with only campaignId and updatedBy set', async () => {
    const doc = new SoundboardState({
      campaignId: '507f1f77bcf86cd799439011',
      updatedBy: '507f1f77bcf86cd799439012',
    });
    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.packageId).toBeNull();
    expect(doc.moodId).toBeNull();
    expect(doc.items).toEqual([]);
  });

  // The only field missing here is campaignId — updatedBy is present (a
  // valid, required value), so a rejection can only be about campaignId.
  it('requires campaignId', async () => {
    const doc = new SoundboardState({
      updatedBy: '507f1f77bcf86cd799439012',
    });
    await expect(doc.validate()).rejects.toBeTruthy();
  });

  // The only field missing here is updatedBy — campaignId is present, so a
  // rejection can only be about updatedBy.
  it('requires updatedBy', async () => {
    const doc = new SoundboardState({
      campaignId: '507f1f77bcf86cd799439011',
    });
    await expect(doc.validate()).rejects.toBeTruthy();
  });

  // Direct path inspection, not just a validation-passes test: pins the
  // instance/ref/required flags so the baseline test above can't pass for
  // the wrong reason (e.g. campaignId typed as Mixed).
  it('declares campaignId as a required ObjectId ref to Campaign', () => {
    const path = SoundboardState.schema.path('campaignId');
    expect(path).toBeDefined();
    expect(path.instance).toBe('ObjectId');
    expect(path.options.ref).toBe('Campaign');
    expect(path.isRequired).toBe(true);
  });

  // updatedBy references the Mongo User _id, never an OAuth provider id —
  // pinned the same way as campaignId above.
  it('declares updatedBy as a required ObjectId ref to User', () => {
    const path = SoundboardState.schema.path('updatedBy');
    expect(path).toBeDefined();
    expect(path.instance).toBe('ObjectId');
    expect(path.options.ref).toBe('User');
    expect(path.isRequired).toBe(true);
  });

  // packageId is nullable — a campaign can have a live board with nothing
  // loaded yet. Pinning instance/ref/required (not just "validate() didn't
  // throw") closes the hole where a Mixed-typed field would pass the same
  // way for the wrong reason.
  it('declares packageId as a nullable, non-required ObjectId ref to AudioPackage', () => {
    const path = SoundboardState.schema.path('packageId');
    expect(path).toBeDefined();
    expect(path.instance).toBe('ObjectId');
    expect(path.options.ref).toBe('AudioPackage');
    expect(path.isRequired).toBeFalsy();

    const doc = new SoundboardState({
      campaignId: '507f1f77bcf86cd799439011',
      updatedBy: '507f1f77bcf86cd799439012',
    });
    expect(doc.packageId).toBeNull();
  });

  // moodId and items[].itemId are package-scoped stable string ids, never
  // Mongo refs — moods/items live inside AudioPackage documents, not as
  // separate collections. Typing either as ObjectId would silently break
  // resolution the moment a real package-scoped id (not 24-hex) is stored.
  it('types moodId and items.itemId as plain strings, not ObjectId refs', () => {
    const moodIdPath = SoundboardState.schema.path('moodId');
    expect(moodIdPath).toBeDefined();
    expect(moodIdPath.instance).toBe('String');

    const itemIdPath = SoundboardState.schema.path('items.itemId');
    expect(itemIdPath).toBeDefined();
    expect(itemIdPath.instance).toBe('String');
  });

  // Embedded items carry the package-scoped itemId as their only identity —
  // a Mongo-assigned _id here would be pure noise, matching AudioPackage's
  // embedded-array precedent (_id: false).
  it('does not assign Mongo _ids to embedded items', () => {
    const doc = new SoundboardState({
      campaignId: '507f1f77bcf86cd799439011',
      updatedBy: '507f1f77bcf86cd799439012',
      items: [{ itemId: 'item-1', playing: true, volume: 0.5 }],
    });
    const obj = doc.toObject();
    expect(obj.items[0]._id).toBeUndefined();
    expect(obj.items[0].itemId).toBe('item-1');
  });

  // THE test that matters for this task: one live state per campaign is the
  // entire point of a dedicated collection, and Task 6's upsert
  // (findOneAndUpdate({ campaignId }, ..., { upsert: true })) depends on
  // there being exactly one document to write. Asserted against the exact
  // registered index tuple — spec AND options — not just the key shape,
  // since an index missing `unique: true` would let two documents pile up
  // for the same campaignId while still passing a spec-only assertion.
  it('has a unique index on campaignId', () => {
    const specs = SoundboardState.schema.indexes() as Array<
      [Record<string, unknown>, Record<string, unknown>]
    >;
    const match = specs.find(([spec]) => spec.campaignId === 1);
    expect(match).toBeDefined();
    expect(match?.[1]).toMatchObject({ unique: true });
  });
});
