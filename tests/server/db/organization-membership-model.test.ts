import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/*
 * setup.ts mocks mongoose with a MockSchema that does not track paths. Schema
 * tests need real mongoose, so unmock + resetModules and dynamically import.
 */
describe('OrganizationMembership model', () => {
  let RealMembership: any;

  beforeAll(async () => {
    vi.unmock('mongoose');
    vi.resetModules();
    const mod = await import('~/server/db/models/OrganizationMembership');
    RealMembership = mod.OrganizationMembership;
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
    const paths = Object.keys(RealMembership.schema.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        'organizationId',
        'memberKind',
        'memberId',
        'title',
        'publicNotes',
        'privateNotes',
        'campaignId',
        'createdBy',
        'createdAt',
        'updatedAt',
      ])
    );
  });

  it('memberKind is a player|character enum', () => {
    expect(RealMembership.schema.path('memberKind').options.enum).toEqual(['player', 'character']);
    expect(RealMembership.schema.path('memberKind').options.required).toBeTruthy();
  });
});
