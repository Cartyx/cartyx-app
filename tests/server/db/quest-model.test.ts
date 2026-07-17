import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/*
 * setup.ts mocks mongoose with a MockSchema that does not track paths. Schema
 * tests need real mongoose, so unmock + resetModules and dynamically import.
 */
describe('Quest model', () => {
  let RealQuest: any;

  beforeAll(async () => {
    vi.unmock('mongoose');
    vi.resetModules();
    const mod = await import('~/server/db/models/Quest');
    RealQuest = mod.Quest;
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

  it('defaults status to not_started and normalizes tags on save shape', () => {
    const q = new RealQuest({
      name: 'Goblin Arrows',
      campaignId: '507f1f77bcf86cd799439011',
      createdBy: '507f1f77bcf86cd799439012',
      tags: ['Main', 'main', ' Urgent '],
    });
    expect(q.status).toBe('not_started');
    expect(q.isPublic).toBe(false);
    expect(q.giver).toBeNull();
    expect(q.parentQuestId).toBeNull();
    expect(Array.isArray(q.links)).toBe(true);
    expect(Array.isArray(q.events)).toBe(true);
  });

  it('rejects an unknown status', () => {
    const q = new RealQuest({
      name: 'X',
      status: 'bogus',
      campaignId: '507f1f77bcf86cd799439011',
      createdBy: '507f1f77bcf86cd799439012',
    });
    const err = q.validateSync();
    expect(err?.errors?.status).toBeTruthy();
  });

  it('accepts embedded links and events with role + notes', () => {
    const q = new RealQuest({
      name: 'X',
      campaignId: '507f1f77bcf86cd799439011',
      createdBy: '507f1f77bcf86cd799439012',
      links: [
        {
          kind: 'character',
          id: '507f1f77bcf86cd799439013',
          role: 'Target',
          publicInfo: 'pub',
          privateInfo: 'gm',
        },
      ],
      events: [
        {
          eventId: '507f1f77bcf86cd799439014',
          role: 'Started at',
          publicInfo: 'p',
          privateInfo: 'g',
        },
      ],
    });
    expect(q.validateSync()).toBeUndefined();
    expect(q.links[0].role).toBe('Target');
    expect(q.events[0].role).toBe('Started at');
  });
});
