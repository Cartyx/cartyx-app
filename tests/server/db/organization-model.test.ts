import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/*
 * setup.ts mocks mongoose with a MockSchema that does not track paths. Schema
 * tests need real mongoose, so unmock + resetModules and dynamically import.
 */
describe('Organization model', () => {
  let RealOrganization: any;

  beforeAll(async () => {
    vi.unmock('mongoose');
    vi.resetModules();
    const mod = await import('~/server/db/models/Organization');
    RealOrganization = mod.Organization;
  });

  afterAll(() => {
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

  it('defines the expected paths', () => {
    const paths = Object.keys(RealOrganization.schema.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        'name',
        'publicInfo',
        'privateInfo',
        'isPublic',
        'images',
        'locations',
        'tags',
        'campaignId',
        'createdBy',
        'createdAt',
        'updatedAt',
      ])
    );
  });

  it('location links require a locationId', () => {
    const locPath = RealOrganization.schema.path('locations');
    const sub = (locPath as any).schema;
    expect(sub.path('locationId').options.required).toBeTruthy();
    expect(sub.path('publicInfo')).toBeTruthy();
    expect(sub.path('privateInfo')).toBeTruthy();
  });
});
