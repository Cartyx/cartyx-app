import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeModel, createNotFoundModel } from './questTestDb';

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
 * faithfully without inventing new test infrastructure, `Quest` and
 * `Character` are backed by the shared in-memory model fake in
 * `./questTestDb` (see that file's header for why it exists and what
 * Mongoose query shapes it supports). Player/Location/Organization/Event are
 * only ever read via a single `findOne`, so they get a simpler not-found stub.
 */

vi.mock('~/server/db/models/Quest', () => ({ Quest: createFakeModel('q') }));
vi.mock('~/server/db/models/Character', () => ({ Character: createFakeModel('ch') }));
vi.mock('~/server/db/models/Player', () => ({ Player: createNotFoundModel() }));
vi.mock('~/server/db/models/Location', () => ({ Location: createNotFoundModel() }));
vi.mock('~/server/db/models/Organization', () => ({ Organization: createNotFoundModel() }));
vi.mock('~/server/db/models/Event', () => ({ Event: createNotFoundModel() }));

import { Quest } from '~/server/db/models/Quest';
import { Character } from '~/server/db/models/Character';
import {
  createQuest,
  getQuest,
  listQuests,
  updateQuest,
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

  it('updateQuest (as GM) round-trips privateInfo on the quest, a link, and an event', async () => {
    const ch = await Character.create({ firstName: 'A', lastName: 'B', campaignId: CAMPAIGN });
    const q = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Q',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: 'quest-secret-1',
        isPublic: true,
        giver: null,
        parentQuestId: null,
        links: [
          {
            kind: 'character',
            id: String(ch._id),
            role: 'r1',
            publicInfo: 'pub1',
            privateInfo: 'link-secret-1',
          },
        ],
        events: [
          { eventId: 'evt-1', role: 'er1', publicInfo: 'epub1', privateInfo: 'event-secret-1' },
        ],
        images: [],
        tags: [],
      },
    });

    const updated = await updateQuest({
      data: {
        id: q.id,
        campaignId: CAMPAIGN,
        name: 'Q',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: 'quest-secret-2',
        isPublic: true,
        giver: null,
        parentQuestId: null,
        links: [
          {
            kind: 'character',
            id: String(ch._id),
            role: 'r1',
            publicInfo: 'pub1',
            privateInfo: 'link-secret-2',
          },
        ],
        events: [
          { eventId: 'evt-1', role: 'er1', publicInfo: 'epub1', privateInfo: 'event-secret-2' },
        ],
        images: [],
        tags: [],
      },
    });

    expect(updated.privateInfo).toBe('quest-secret-2');
    expect(updated.links[0].privateInfo).toBe('link-secret-2');
    expect(updated.events[0].privateInfo).toBe('event-secret-2');
  });

  it('updateQuest (as non-GM) preserves existing GM-only privateInfo for matched links/events, blanks new ones, and leaves quest-level privateInfo untouched', async () => {
    const ch = await Character.create({ firstName: 'A', lastName: 'B', campaignId: CAMPAIGN });
    const q = await createQuest({
      data: {
        campaignId: CAMPAIGN,
        name: 'Q',
        type: '',
        status: 'active',
        publicInfo: '',
        privateInfo: 'quest-secret',
        isPublic: true,
        giver: null,
        parentQuestId: null,
        links: [
          {
            kind: 'character',
            id: String(ch._id),
            role: 'r1',
            publicInfo: 'pub1',
            privateInfo: 'link-secret',
          },
        ],
        events: [
          { eventId: 'evt-1', role: 'er1', publicInfo: 'epub1', privateInfo: 'event-secret' },
        ],
        images: [],
        tags: [],
      },
    });

    // Non-GM creator updates the quest: submits an attempted privateInfo change
    // on the existing (matched) link/event, plus a brand-new link/event.
    member.isGM = false;
    member.userId = 'u-gm'; // still the creator, so the update is allowed (not Forbidden)

    await updateQuest({
      data: {
        id: q.id,
        campaignId: CAMPAIGN,
        name: 'Q renamed',
        type: '',
        status: 'active',
        publicInfo: 'pub-updated',
        privateInfo: 'attempted-wipe',
        isPublic: true,
        giver: null,
        parentQuestId: null,
        links: [
          {
            kind: 'character',
            id: String(ch._id),
            role: 'r1-updated',
            publicInfo: 'pub1-updated',
            privateInfo: 'non-gm-attempt-existing',
          },
          {
            kind: 'character',
            id: 'brand-new-id',
            role: 'r2',
            publicInfo: 'pub2',
            privateInfo: 'non-gm-attempt-new',
          },
        ],
        events: [
          {
            eventId: 'evt-1',
            role: 'er1-updated',
            publicInfo: 'epub1-updated',
            privateInfo: 'non-gm-attempt-existing-event',
          },
          {
            eventId: 'evt-2',
            role: 'er2',
            publicInfo: 'epub2',
            privateInfo: 'non-gm-attempt-new-event',
          },
        ],
        images: [],
        tags: [],
      },
    });

    // Read back as GM to see the true stored privateInfo values.
    member.isGM = true;
    member.userId = 'u-gm';
    const reloaded = await getQuest({ data: { id: q.id, campaignId: CAMPAIGN } });
    expect(reloaded?.name).toBe('Q renamed');
    expect(reloaded?.publicInfo).toBe('pub-updated');
    // Quest-level privateInfo is a non-GM writer's blind spot: left untouched, not wiped.
    expect(reloaded?.privateInfo).toBe('quest-secret');

    const existingLink = reloaded?.links.find((l) => l.id === String(ch._id));
    expect(existingLink?.privateInfo).toBe('link-secret');
    expect(existingLink?.role).toBe('r1-updated'); // non-private fields still apply

    const newLink = reloaded?.links.find((l) => l.id === 'brand-new-id');
    expect(newLink?.privateInfo).toBe('');

    const existingEvent = reloaded?.events.find((e) => e.eventId === 'evt-1');
    expect(existingEvent?.privateInfo).toBe('event-secret');

    const newEvent = reloaded?.events.find((e) => e.eventId === 'evt-2');
    expect(newEvent?.privateInfo).toBe('');
  });
});
