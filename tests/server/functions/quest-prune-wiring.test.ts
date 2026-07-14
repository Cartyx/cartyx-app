import { describe, it, expect, vi, beforeEach } from 'vitest';

// This file proves the WIRING only: that each of the five entity delete
// functions calls `pruneQuestRefs` with the right (kind, id, campaignId), and
// that a rejection from it is swallowed (captured, not propagated). The
// behavior of `pruneQuestRefs` itself is covered by quests.test.ts.

vi.mock('~/server/utils/requireCampaignMember', () => ({ requireCampaignMember: vi.fn() }));
vi.mock('~/server/functions/quests', () => ({ pruneQuestRefs: vi.fn() }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/functions/gmscreens-helpers', () => ({ removeDocumentRefsFromScreens: vi.fn() }));
vi.mock('~/server/functions/tags', () => ({ ensureTags: vi.fn() }));

vi.mock('~/server/db/models/Organization', () => {
  // deleteOrganization's earlier CRUD siblings `new Organization(doc).save()` —
  // model the mock as a constructor, matching organizations.test.ts.
  function OrganizationMock(this: Record<string, unknown>, doc: Record<string, unknown>) {
    Object.assign(this, doc);
    this.save = vi.fn().mockResolvedValue(this);
  }
  Object.assign(OrganizationMock, {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
  });
  return { Organization: OrganizationMock };
});
vi.mock('~/server/db/models/OrganizationMembership', () => ({
  OrganizationMembership: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Player', () => ({
  Player: {
    findById: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    exists: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Character', () => ({
  Character: {
    findById: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    exists: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Location', () => ({
  Location: { findById: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('~/server/db/models/Event', () => ({
  Event: { findById: vi.fn(), deleteOne: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('~/server/db/models/Lore', () => ({
  Lore: { updateMany: vi.fn(), create: vi.fn(), findById: vi.fn() },
}));
vi.mock('~/server/db/models/Calendar', () => ({ Calendar: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { findById: vi.fn() } }));

import { requireCampaignMember } from '~/server/utils/requireCampaignMember';
import { pruneQuestRefs } from '~/server/functions/quests';
import { serverCaptureException } from '~/server/utils/telemetry';
import { Organization } from '~/server/db/models/Organization';
import { OrganizationMembership } from '~/server/db/models/OrganizationMembership';
import { Player } from '~/server/db/models/Player';
import { Character } from '~/server/db/models/Character';
import { Location } from '~/server/db/models/Location';
import { Event } from '~/server/db/models/Event';

import { deleteOrganization } from '~/server/functions/organizations';
import { deletePlayer } from '~/server/functions/players';
import { deleteCharacter } from '~/server/functions/characters';
import { deleteLocation } from '~/server/functions/locations';
import { deleteEvent } from '~/server/functions/events';

type DeleteFn = (a: { data: Record<string, unknown> }) => Promise<{ success: boolean }>;
const call = (fn: unknown) => fn as DeleteFn;

const gmMember = { userId: 'user-1', sessionUserId: 'sess-1', isGM: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCampaignMember).mockResolvedValue(gmMember);
  vi.mocked(pruneQuestRefs).mockResolvedValue(undefined);
});

// Per-entity setup of the minimal model mocks each delete function needs to
// reach its post-delete cleanup section.
const scenarios: Array<{
  label: string;
  kind: 'organization' | 'player' | 'character' | 'location' | 'event';
  id: string;
  campaignId: string;
  fn: unknown;
  setup: () => void;
}> = [
  {
    label: 'deleteOrganization',
    kind: 'organization',
    id: 'o1',
    campaignId: 'camp-1',
    fn: deleteOrganization,
    setup: () => {
      vi.mocked(Organization.findOne).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'o1', campaignId: 'camp-1', createdBy: 'user-1' }),
      } as never);
      vi.mocked(Organization.deleteOne).mockResolvedValue({} as never);
      vi.mocked(OrganizationMembership.deleteMany).mockResolvedValue({} as never);
    },
  },
  {
    label: 'deletePlayer',
    kind: 'player',
    id: 'p1',
    campaignId: 'camp-1',
    fn: deletePlayer,
    setup: () => {
      vi.mocked(Player.findById).mockResolvedValue({
        _id: 'p1',
        campaignId: 'camp-1',
        deleteOne: vi.fn().mockResolvedValue({}),
      } as never);
    },
  },
  {
    label: 'deleteCharacter',
    kind: 'character',
    id: 'c1',
    campaignId: 'camp-1',
    fn: deleteCharacter,
    setup: () => {
      vi.mocked(Character.findById).mockResolvedValue({
        _id: 'c1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
        deleteOne: vi.fn().mockResolvedValue({}),
      } as never);
      vi.mocked(Character.updateMany).mockResolvedValue({} as never);
      vi.mocked(Player.updateMany).mockResolvedValue({} as never);
    },
  },
  {
    label: 'deleteLocation',
    kind: 'location',
    id: 'l1',
    campaignId: 'camp-1',
    fn: deleteLocation,
    setup: () => {
      vi.mocked(Location.findById).mockResolvedValue({
        _id: 'l1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
        parentLocations: [],
        childLocations: [],
        images: [],
        deleteOne: vi.fn().mockResolvedValue({}),
      } as never);
    },
  },
  {
    label: 'deleteEvent',
    kind: 'event',
    id: 'e1',
    campaignId: 'camp-1',
    fn: deleteEvent,
    setup: () => {
      vi.mocked(Event.findById).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'e1', campaignId: 'camp-1' }),
      } as never);
      vi.mocked(Event.deleteOne).mockResolvedValue({} as never);
    },
  },
];

describe('pruneQuestRefs wiring', () => {
  for (const s of scenarios) {
    it(`${s.label} calls pruneQuestRefs('${s.kind}', id, campaignId)`, async () => {
      s.setup();

      const result = await call(s.fn)({ data: { id: s.id, campaignId: s.campaignId } });

      expect(pruneQuestRefs).toHaveBeenCalledWith(s.kind, s.id, s.campaignId);
      expect(result.success).toBe(true);
    });

    it(`${s.label} still succeeds if pruneQuestRefs rejects (swallowed + captured)`, async () => {
      s.setup();
      vi.mocked(pruneQuestRefs).mockRejectedValueOnce(new Error('prune boom'));

      const result = await call(s.fn)({ data: { id: s.id, campaignId: s.campaignId } });

      expect(result.success).toBe(true);
      expect(serverCaptureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.anything(),
        expect.objectContaining({ action: expect.stringContaining('pruneQuests') })
      );
    });
  }
});
