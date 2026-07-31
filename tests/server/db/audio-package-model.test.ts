import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/*
 * setup.ts mocks mongoose with a MockSchema that does not track paths (and
 * whose `model()` returns a plain object, not a constructor). Schema-level
 * tests need real mongoose, so unmock + resetModules and dynamically import —
 * the same approach used in tests/server/db/audio-asset-model.test.ts.
 */
describe('AudioPackage model', () => {
  let AudioPackage: any;

  beforeAll(async () => {
    vi.unmock('mongoose');
    vi.resetModules();
    const mod = await import('~/server/db/models/AudioPackage');
    AudioPackage = mod.AudioPackage;
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

  // A system package is one whose ownerId is null — Task 4's visibility rule
  // ($or: [{ ownerId: userId }, { ownerId: null }]) is built directly on this.
  // `name` is present so the only thing under test is ownerId's nullability.
  it('allows a null ownerId, which is what makes a package a system package', async () => {
    const doc = new AudioPackage({ ownerId: null, name: 'Tavern' });
    await expect(doc.validate()).resolves.toBeUndefined();
  });

  // The only field missing here is `name` — ownerId is explicitly null (a
  // valid value), items/moods default to [], so a rejection can only be
  // about `name`.
  it('requires a name', async () => {
    const doc = new AudioPackage({ ownerId: null });
    await expect(doc.validate()).rejects.toBeTruthy();
  });

  // Direct path inspection, not just a validation-passes test: if `ownerId`
  // were typed as Mixed (or anything that never enforces `required`), the
  // "allows null" test above would pass for the wrong reason. Pinning the
  // path's instance/ref/required flags closes that hole.
  it('declares ownerId as a nullable, non-required ObjectId ref to User', () => {
    const path = AudioPackage.schema.path('ownerId');
    expect(path).toBeDefined();
    expect(path.instance).toBe('ObjectId');
    expect(path.options.ref).toBe('User');
    expect(path.isRequired).toBeFalsy();

    const doc = new AudioPackage({ name: 'Tavern' });
    expect(doc.ownerId).toBeNull();
  });

  // Task 4's visibility query ($or: [{ ownerId: userId }, { ownerId: null }])
  // and the owned-packages list both filter on ownerId; `{ ownerId: 1, name: 1 }`
  // additionally serves a name-sorted/filtered listing within an owner's
  // packages. Asserted against the schema's real registered index set, not
  // by reading the source — an index assertion that silently matches nothing
  // is worse than no test (see audio-asset-model.test.ts's equivalent).
  it('indexes ownerId (and ownerId+name) so the visibility query is served', () => {
    const specs = (AudioPackage.schema.indexes() as Array<[Record<string, unknown>, unknown]>).map(
      ([spec]) => spec
    );

    expect(specs).toContainEqual({ ownerId: 1 });
    expect(specs).toContainEqual({ ownerId: 1, name: 1 });
    expect(specs).toHaveLength(2);
  });

  // `items[]` and `moods[].states[]` carry their own client-generated `id`
  // fields (stable within the package); a Mongo-assigned `_id` on the
  // subdocument would be noise that Task 5's clone would have to strip to
  // avoid leaking the source document's subdocument ids into the copy. This
  // is only meaningful if the fixture actually exercises nested arrays
  // (moods[].states[] inside moods[]), not just a flat items[] array.
  it('does not assign Mongo _ids to embedded items or moods (or moods.states)', () => {
    const doc = new AudioPackage({
      ownerId: null,
      name: 'Tavern',
      items: [
        {
          id: 'item-1',
          assetId: '507f1f77bcf86cd799439011',
          volume: 1,
          fadeSeconds: 2,
          loop: false,
          sortIndex: 0,
        },
      ],
      moods: [
        {
          id: 'mood-1',
          name: 'Calm',
          states: [{ itemId: 'item-1', playing: true }],
        },
      ],
    });

    const obj = doc.toObject();
    expect(obj.items[0]._id).toBeUndefined();
    expect(obj.moods[0]._id).toBeUndefined();
    expect(obj.moods[0].states[0]._id).toBeUndefined();
    // And the client-supplied ids themselves survive untouched.
    expect(obj.items[0].id).toBe('item-1');
    expect(obj.moods[0].id).toBe('mood-1');
    expect(obj.moods[0].states[0].itemId).toBe('item-1');
  });

  // Moods reference `item.id` (a package-scoped string), never `assetId` —
  // the whole point of the indirection (per the design doc) is that one
  // asset can appear in many items/moods at different rates without
  // duplication. Pinning the path type guards against someone "fixing"
  // `itemId` into an ObjectId ref later, which would break that contract.
  it('types moods.states.itemId as a plain string, not an ObjectId ref', () => {
    const path = AudioPackage.schema.path('moods.states.itemId');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
  });
});
