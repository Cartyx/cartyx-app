import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/*
 * The global setup.ts mocks mongoose with a MockSchema that does not track
 * paths. Schema-level tests need real mongoose, so we unmock + reset modules
 * and dynamically import the real Lore model — the same approach used in
 * tests/server/db/gmscreen.test.ts.
 */
describe('Lore model', () => {
   
  let RealLore: any;

  beforeAll(async () => {
    vi.unmock('mongoose');
    vi.resetModules();
    const mod = await import('~/server/db/models/Lore');
    RealLore = mod.Lore;
  });

  afterAll(() => {
    // Restore the global mongoose mock so other tests in this worker are unaffected.
    vi.doMock('mongoose', () => {
      class MockSchema {
        constructor(_def?: unknown) {}
        static Types = { ObjectId: String };
        pre(_hook: string, _fn: unknown) {}
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

  it('defines the expected paths', () => {
    const paths = Object.keys(RealLore.schema.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        'title',
        'content',
        'gmContent',
        'isPublic',
        'images',
        'links',
        'tags',
        'campaignId',
        'createdBy',
        'createdAt',
        'updatedAt',
      ])
    );
  });

  it('links require a kind enum and an id', () => {
    const linkPath = RealLore.schema.path('links');
    // SchemaDocumentArray exposes the sub-schema directly on .schema (not .caster.schema)
     
    const sub = (linkPath as any).schema;
    expect(sub.path('kind').options.enum).toEqual(['race', 'character', 'player', 'location']);
    expect(sub.path('id').options.required).toBeTruthy();
  });
});
