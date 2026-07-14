import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mirror the requireCampaignMember mock pattern from organizations.test.ts.
const member = { sessionUserId: 'sess', userId: 'u-gm', isGM: true };
vi.mock('~/server/utils/requireCampaignMember', () => ({
  requireCampaignMember: vi.fn(async () => member),
}));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/functions/tags', () => ({ ensureTags: vi.fn(async () => {}) }));
vi.mock('~/server/functions/gmscreens-helpers', () => ({
  removeDocumentRefsFromScreens: vi.fn(async () => {}),
}));

/*
 * This repo's vitest unit project never talks to a real (or in-memory) Mongo —
 * tests/setup.ts globally mocks `mongoose` itself, and every sibling
 * server-function test (organizations.test.ts, events.test.ts, ...) mocks the
 * model imports directly with fixed return values. There is no
 * mongodb-memory-server / real-Mongo harness anywhere in this codebase (see
 * memory `reference_seed_ephemeral_mongo`: "the vitest unit suite does not
 * use a real Mongo").
 *
 * The task brief's test body assumes real persistence (create → read,
 * create → delete → re-parent, prune-then-reload). To preserve that behavior
 * faithfully without inventing new test infrastructure, this file backs the
 * `Quest` and `Character` model mocks with tiny in-memory, array-backed fakes
 * that support exactly the Mongoose query shapes `app/server/functions/quests.ts`
 * uses (plain equality, dotted paths into embedded docs/arrays, $or/$and,
 * $elemMatch, $all, $in, $set, $pull). Player/Location/Organization/Event are
 * only ever read via a single `findOne`, so they get a simpler fake.
 */

function get(obj: unknown, key: string): unknown {
  return (obj as Record<string, unknown> | null | undefined)?.[key];
}

function matchDoc(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, val]) => {
    if (key === '$or') return (val as Record<string, unknown>[]).some((f) => matchDoc(doc, f));
    if (key === '$and') return (val as Record<string, unknown>[]).every((f) => matchDoc(doc, f));
    if (key === '$text') return true;

    if (key.includes('.')) {
      const [head, ...rest] = key.split('.');
      const restKey = rest.join('.');
      const headVal = get(doc, head);
      if (Array.isArray(headVal)) {
        return headVal.some((el) => matchDoc(el as Record<string, unknown>, { [restKey]: val }));
      }
      return matchDoc((headVal as Record<string, unknown>) ?? {}, { [restKey]: val });
    }

    const actual = get(doc, key);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const ops = val as Record<string, unknown>;
      if ('$elemMatch' in ops) {
        const arr = (actual as unknown[]) ?? [];
        return arr.some((item) =>
          matchDoc(item as Record<string, unknown>, ops.$elemMatch as Record<string, unknown>)
        );
      }
      if ('$in' in ops) return (ops.$in as unknown[]).includes(actual);
      if ('$all' in ops) {
        const arr = (actual as unknown[]) ?? [];
        return (ops.$all as unknown[]).every((v) => arr.includes(v));
      }
    }
    return actual === val;
  });
}

function chain<T>(result: T) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.sort = () => q;
  q.limit = () => q;
  q.lean = async () => result;
  return q;
}

function clone<T>(d: T): T {
  return JSON.parse(JSON.stringify(d));
}

// --- Fake Quest collection (supports the exact query shapes quests.ts uses) ---
const questHoisted = vi.hoisted(() => {
  const docs: Record<string, unknown>[] = [];
  let seq = 1;
  return { docs, nextId: () => `q${seq++}` };
});

function FakeQuest(this: Record<string, unknown>, doc: Record<string, unknown>) {
  Object.assign(this, { _id: questHoisted.nextId(), ...doc });
  this.save = vi.fn(async () => {
    questHoisted.docs.push(clone(this));
    return this;
  });
  this.toObject = () => clone(this);
}
Object.assign(FakeQuest, {
  deleteMany: async (filter: Record<string, unknown> = {}) => {
    for (let i = questHoisted.docs.length - 1; i >= 0; i--) {
      if (matchDoc(questHoisted.docs[i], filter)) questHoisted.docs.splice(i, 1);
    }
    return {};
  },
  find: (filter: Record<string, unknown> = {}) =>
    chain(questHoisted.docs.filter((d) => matchDoc(d, filter)).map(clone)),
  findOne: (filter: Record<string, unknown>) => {
    const found = questHoisted.docs.find((d) => matchDoc(d, filter));
    return chain(found ? clone(found) : null);
  },
  findById: (id: string) => {
    const found = questHoisted.docs.find((d) => d._id === id);
    return chain(found ? clone(found) : null);
  },
  findOneAndUpdate: (
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown> }
  ) => {
    const idx = questHoisted.docs.findIndex((d) => matchDoc(d, filter));
    if (idx === -1) return chain(null);
    Object.assign(questHoisted.docs[idx], update.$set ?? {});
    return chain(clone(questHoisted.docs[idx]));
  },
  deleteOne: async (filter: Record<string, unknown>) => {
    const idx = questHoisted.docs.findIndex((d) => matchDoc(d, filter));
    if (idx >= 0) questHoisted.docs.splice(idx, 1);
    return { deletedCount: idx >= 0 ? 1 : 0 };
  },
  updateMany: async (
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown>; $pull?: Record<string, unknown> }
  ) => {
    for (const d of questHoisted.docs) {
      if (!matchDoc(d, filter)) continue;
      if (update.$set) Object.assign(d, update.$set);
      if (update.$pull) {
        for (const [field, cond] of Object.entries(update.$pull)) {
          const arr = (d[field] as unknown[]) ?? [];
          d[field] = arr.filter(
            (item) => !matchDoc(item as Record<string, unknown>, cond as Record<string, unknown>)
          );
        }
      }
    }
    return {};
  },
});

vi.mock('~/server/db/models/Quest', () => ({ Quest: FakeQuest }));

// --- Fake Character collection (create/deleteMany used directly by the test; findOne used by quests.ts label resolution) ---
const characterHoisted = vi.hoisted(() => {
  const docs: Record<string, unknown>[] = [];
  let seq = 1;
  return { docs, nextId: () => `ch${seq++}` };
});

vi.mock('~/server/db/models/Character', () => ({
  Character: {
    create: async (doc: Record<string, unknown>) => {
      const rec = { _id: characterHoisted.nextId(), ...doc };
      characterHoisted.docs.push(rec);
      return rec;
    },
    deleteMany: async () => {
      characterHoisted.docs.length = 0;
      return {};
    },
    findOne: (filter: Record<string, unknown>) => {
      const found = characterHoisted.docs.find((d) => matchDoc(d, filter));
      return chain(found ? clone(found) : null);
    },
  },
}));

// Player/Location/Organization/Event are only ever read via a single findOne
// in quests.ts and are never referenced by id in this test suite, so a
// not-found stub is sufficient.
vi.mock('~/server/db/models/Player', () => ({
  Player: { findOne: () => chain(null) },
}));
vi.mock('~/server/db/models/Location', () => ({
  Location: { findOne: () => chain(null) },
}));
vi.mock('~/server/db/models/Organization', () => ({
  Organization: { findOne: () => chain(null) },
}));
vi.mock('~/server/db/models/Event', () => ({
  Event: { findOne: () => chain(null) },
}));

import { Quest } from '~/server/db/models/Quest';
import { Character } from '~/server/db/models/Character';
import {
  createQuest,
  getQuest,
  listQuests,
  deleteQuest,
  listQuestsForEntity,
  pruneQuestRefs,
} from '~/server/functions/quests';

const CAMPAIGN = '507f1f77bcf86cd799439011';

beforeEach(async () => {
  await Quest.deleteMany({});
  await Character.deleteMany({});
  member.isGM = true;
  member.userId = 'u-gm';
});

describe('quests server functions', () => {
  it('creates a quest and resolves its giver + link labels', async () => {
    const ch = await Character.create({
      firstName: 'Sildar',
      lastName: 'Hallwinter',
      campaignId: CAMPAIGN,
    });
    const q = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Goblin Arrows',
        type: 'Main',
        status: 'active',
        publicInfo: 'Escort the wagon',
        privateInfo: 'Ambush at the bend',
        isPublic: true,
        giver: { kind: 'character', id: String(ch._id) },
        parentQuestId: null,
        links: [
          {
            kind: 'character',
            id: String(ch._id),
            role: 'Escort',
            publicInfo: 'p',
            privateInfo: 'g',
          },
        ],
        events: [],
        images: [],
        tags: ['main'],
      },
    });
    expect(q.status).toBe('active');
    expect(q.giver?.label).toBe('Sildar Hallwinter');
    expect(q.links[0].label).toBe('Sildar Hallwinter');
    expect(q.links[0].privateInfo).toBe('g');
  });

  it('strips GM-only fields for a non-GM reader', async () => {
    const q = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Secret',
        type: '',
        status: 'active',
        publicInfo: 'pub',
        privateInfo: 'gm-secret',
        isPublic: true,
        giver: null,
        parentQuestId: null,
        links: [
          {
            kind: 'player',
            id: '507f1f77bcf86cd799439099',
            role: '',
            publicInfo: 'p',
            privateInfo: 'gm-link',
          },
        ],
        events: [],
        images: [],
        tags: [],
      },
    });
    member.isGM = false;
    member.userId = 'someone-else';
    const read = await getQuest({ data: { id: q.id, campaignId: CAMPAIGN } });
    expect(read?.privateInfo).toBe('');
    expect(read?.links[0].privateInfo).toBe('');
    expect(read?.publicInfo).toBe('pub');
  });

  it('hides a private quest from a non-GM non-creator', async () => {
    const q = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Hidden',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: '',
        isPublic: false,
        giver: null,
        parentQuestId: null,
        links: [],
        events: [],
        images: [],
        tags: [],
      },
    });
    member.isGM = false;
    member.userId = 'not-creator';
    expect(await getQuest({ data: { id: q.id, campaignId: CAMPAIGN } })).toBeNull();
    const list = await listQuests({ data: { campaignId: CAMPAIGN } });
    expect(list.find((x) => x.id === q.id)).toBeUndefined();
  });

  it('filters the list by status', async () => {
    for (const s of ['active', 'completed'] as const) {
      await createQuest({
        data: {
          campaignId: CAMPAIGN,
          name: s,
          type: '',
          status: s,
          publicInfo: '',
          privateInfo: '',
          isPublic: true,
          giver: null,
          parentQuestId: null,
          links: [],
          events: [],
          images: [],
          tags: [],
        },
      });
    }
    const active = await listQuests({ data: { campaignId: CAMPAIGN, status: 'active' } });
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe('active');
  });

  it('re-parents child quests on parent delete', async () => {
    const parent = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Parent',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: '',
        isPublic: true,
        giver: null,
        parentQuestId: null,
        links: [],
        events: [],
        images: [],
        tags: [],
      },
    });
    const child = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Child',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: '',
        isPublic: true,
        giver: null,
        parentQuestId: parent.id,
        links: [],
        events: [],
        images: [],
        tags: [],
      },
    });
    await deleteQuest({ data: { id: parent.id, campaignId: CAMPAIGN } });
    const reloaded = await getQuest({ data: { id: child.id, campaignId: CAMPAIGN } });
    expect(reloaded?.parentQuestId).toBeNull();
  });

  it('listQuestsForEntity returns quests linking or given by an entity', async () => {
    const ch = await Character.create({ firstName: 'A', lastName: 'B', campaignId: CAMPAIGN });
    await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Linked',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: '',
        isPublic: true,
        giver: { kind: 'character', id: String(ch._id) },
        parentQuestId: null,
        links: [],
        events: [],
        images: [],
        tags: [],
      },
    });
    const found = await listQuestsForEntity({
      data: { campaignId: CAMPAIGN, kind: 'character', id: String(ch._id) },
    });
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Linked');
  });

  it('pruneQuestRefs clears giver, links, and events for a deleted entity', async () => {
    const ch = await Character.create({ firstName: 'A', lastName: 'B', campaignId: CAMPAIGN });
    const q = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Q',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: '',
        isPublic: true,
        giver: { kind: 'character', id: String(ch._id) },
        parentQuestId: null,
        links: [
          { kind: 'character', id: String(ch._id), role: '', publicInfo: '', privateInfo: '' },
        ],
        events: [],
        images: [],
        tags: [],
      },
    });
    await pruneQuestRefs('character', String(ch._id), CAMPAIGN);
    const reloaded = await getQuest({ data: { id: q.id, campaignId: CAMPAIGN } });
    expect(reloaded?.giver).toBeNull();
    expect(reloaded?.links).toHaveLength(0);
  });
});
