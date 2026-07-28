import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * `addPrivateWindow` enforces dedup and the per-screen cap inside its updateOne
 * FILTER (`$nor` + `$expr`) rather than from a read-then-write, because two
 * concurrent calls both read the array before either write lands.
 *
 * The rest of the suite mocks mongoose per-model, so nothing there ever casts
 * that filter against the real schema — and a mis-cast filter fails OPEN: it
 * simply matches nothing (or everything) with no error at all. These tests use
 * the REAL model to prove both halves are well-formed:
 *
 *   - `$nor`/`$elemMatch` IS cast by mongoose, so its ObjectId paths must come
 *     out as ObjectIds even though the handler passes strings.
 *   - `$expr` is NOT cast by mongoose (it is a raw aggregation expression), so
 *     the handler builds the ObjectId itself. If that ever regressed to a
 *     string, `$eq` against the stored ObjectId would never match, the count
 *     would always be 0, and the cap would silently stop working.
 *
 * The global setup.ts mocks mongoose with a MockSchema that does not track
 * paths, so this unmocks + resets modules like tests/server/db/lore-model.ts.
 */

const CAMPAIGN_ID = '65c0000000000000000000c1';
const USER_ID = '65c0000000000000000000a1';
const SCREEN_ID = '65c0000000000000000000e1';
const DOC_ID = '65c0000000000000000000f1';

/** Mirrors MAX_PRIVATE_WINDOWS; imported dynamically would drag in the whole
 *  server-functions module under real mongoose, so it is asserted separately in
 *  tests/server/functions/privateWindows.test.ts. */
const CAP = 20;

// Top level: vitest hoists this regardless, and a nested call is a future error.
vi.unmock('mongoose');

describe('addPrivateWindow dedup/cap filter — casts against the real schema', () => {
  // Dynamically imported real mongoose/model — untyped by nature.
  let RealModel: ReturnType<typeof Object> & Record<string, never>;
  let realMongoose: typeof import('mongoose').default;

  beforeAll(async () => {
    vi.resetModules();
    realMongoose = (await import('mongoose')).default;
    const mod = await import('~/server/db/models/TabletopPlayerState');
    RealModel = mod.TabletopPlayerState;
  });

  afterAll(() => {
    // Restore the global mongoose mock so other tests in this worker are unaffected.
    vi.doMock('mongoose', () => {
      class MockSchema {
        constructor(_def?: unknown) {}
        static Types = { ObjectId: String };
        pre(_hook: string, _fn: unknown) {}
        index(_spec?: unknown, _opts?: unknown) {}
      }
      const mockModel = vi.fn(() => ({
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        findById: vi.fn(),
        find: vi.fn(),
        create: vi.fn(),
        exists: vi.fn(),
        save: vi.fn(),
        updateOne: vi.fn(),
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

  /** The exact filter shape addPrivateWindow builds. */
  function buildFilter() {
    return {
      campaignId: CAMPAIGN_ID,
      userId: USER_ID,
      $nor: [
        {
          privateWindows: {
            $elemMatch: {
              surface: 'tabletop',
              screenId: SCREEN_ID,
              collection: 'lore',
              documentId: DOC_ID,
            },
          },
        },
      ],
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ['$privateWindows', []] },
                cond: {
                  $and: [
                    { $eq: ['$$this.surface', 'tabletop'] },
                    { $eq: ['$$this.screenId', new realMongoose.Types.ObjectId(SCREEN_ID)] },
                  ],
                },
              },
            },
          },
          CAP,
        ],
      },
    };
  }

  /**
   * Casts the filter the way mongoose does at EXECUTION time.
   *
   * `getFilter()` deliberately returns the raw, uncast filter — asserting on it
   * proves nothing about what reaches the server. `Query.cast(model)` is the
   * step `updateOne` runs internally, so that is what these tests inspect.
   */
  function castFilter() {
    const q = RealModel.updateOne(buildFilter(), { $set: {} });
    return q.cast(RealModel);
  }

  it('casts without throwing', () => {
    expect(() => castFilter()).not.toThrow();
  });

  it('casts the $nor/$elemMatch ObjectId paths to ObjectIds', () => {
    const cast = castFilter();
    const em = cast.$nor[0].privateWindows.$elemMatch;

    // Strings in, ObjectIds out — otherwise the dedup guard silently never
    // matches and every double-click lands a duplicate window.
    expect(em.screenId).toBeInstanceOf(realMongoose.Types.ObjectId);
    expect(String(em.screenId)).toBe(SCREEN_ID);
    expect(em.documentId).toBeInstanceOf(realMongoose.Types.ObjectId);
    expect(String(em.documentId)).toBe(DOC_ID);
    // Plain string paths are left alone.
    expect(em.surface).toBe('tabletop');
  });

  it('leaves $expr untouched, so its ObjectId must already be one', () => {
    const cast = castFilter();
    const screenEq = cast.$expr.$lt[0].$size.$filter.cond.$and[1].$eq;

    expect(screenEq[1]).toBeInstanceOf(realMongoose.Types.ObjectId);
    expect(cast.$expr.$lt[1]).toBe(CAP);
  });

  it('stores privateWindows.screenId as an ObjectId — what $expr compares against', () => {
    // Proves the $expr comparison is ObjectId-vs-ObjectId, not ObjectId-vs-string.
    const doc = new RealModel({
      campaignId: CAMPAIGN_ID,
      userId: USER_ID,
      privateWindows: [
        { surface: 'tabletop', screenId: SCREEN_ID, collection: 'lore', documentId: DOC_ID },
      ],
    });

    expect(doc.validateSync()).toBeUndefined();
    const stored = doc.privateWindows[0];
    expect(stored.screenId).toBeInstanceOf(realMongoose.Types.ObjectId);
    expect(stored.documentId).toBeInstanceOf(realMongoose.Types.ObjectId);
    // Defaults the serializer relies on.
    expect(stored.state).toBe('open');
    expect(stored.zIndex).toBe(0);
  });

  it("casts updatePrivateWindow's positional filter path to an ObjectId", () => {
    // `privateWindows._id` selects the subdocument the positional `$` then
    // updates. Left as a string it would match nothing and every drag/resize
    // would silently fail to persist — with no error anywhere.
    const q = RealModel.updateOne(
      {
        campaignId: CAMPAIGN_ID,
        userId: USER_ID,
        'privateWindows._id': '65c0000000000000000000d1',
      },
      { $set: { 'privateWindows.$.x': 10 } }
    );
    const cast = q.cast(RealModel);

    expect(cast['privateWindows._id']).toBeInstanceOf(realMongoose.Types.ObjectId);
    expect(String(cast['privateWindows._id'])).toBe('65c0000000000000000000d1');
  });

  it('rejects a surface outside the enum', () => {
    const doc = new RealModel({
      campaignId: CAMPAIGN_ID,
      userId: USER_ID,
      privateWindows: [
        { surface: 'elsewhere', screenId: SCREEN_ID, collection: 'lore', documentId: DOC_ID },
      ],
    });

    expect(doc.validateSync()).toBeDefined();
  });
});
