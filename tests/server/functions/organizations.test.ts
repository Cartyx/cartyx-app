import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: unknown) => fn }),
    handler: (fn: unknown) => fn,
  }),
}));
vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/db/models/User', () => ({ User: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Campaign', () => ({ Campaign: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Organization', () => ({
  Organization: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('~/server/db/models/OrganizationMembership', () => ({
  OrganizationMembership: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Location', () => ({ Location: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Character', () => ({ Character: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Player', () => ({ Player: { findById: vi.fn() } }));
vi.mock('~/server/functions/gmscreens-helpers', () => ({ removeDocumentRefsFromScreens: vi.fn() }));
vi.mock('~/server/functions/tags', () => ({ ensureTags: vi.fn() }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Organization } from '~/server/db/models/Organization';
import { OrganizationMembership } from '~/server/db/models/OrganizationMembership';
import {
  listOrganizations,
  getOrganization,
  deleteOrganization,
  listMembershipsForMember,
} from '~/server/functions/organizations';

const session = { id: 'sess-1' } as never;
const dbUser = { _id: 'user-1' };
const gmCampaign = {
  _id: 'camp-1',
  gameMasterId: 'user-1',
  members: [{ userId: 'user-1', role: 'gm' }],
};
const playerCampaign = {
  _id: 'camp-1',
  gameMasterId: 'gm-x',
  members: [{ userId: 'user-1', role: 'player' }],
};

const call = (fn: any) => fn as (a: { data: Record<string, unknown> }) => Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(User.findOne).mockResolvedValue(dbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
});

describe('listOrganizations', () => {
  it('restricts non-GM to public or own orgs', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Organization.find).mockReturnValue({
      select: vi
        .fn()
        .mockReturnValue({
          sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
        }),
    } as never);
    await call(listOrganizations)({ data: { campaignId: 'camp-1' } });
    const filter = vi.mocked(Organization.find).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(filter)).toContain('$or');
  });

  it('filters by locationIds via locations.locationId $in', async () => {
    vi.mocked(Organization.find).mockReturnValue({
      select: vi
        .fn()
        .mockReturnValue({
          sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
        }),
    } as never);
    await call(listOrganizations)({ data: { campaignId: 'camp-1', locationIds: ['loc-1'] } });
    const filter = vi.mocked(Organization.find).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(filter['locations.locationId']).toEqual({ $in: ['loc-1'] });
  });
});

describe('getOrganization', () => {
  it('strips privateInfo for non-GM viewers', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Organization.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        campaignId: 'camp-1',
        createdBy: 'someone',
        name: 'Guild',
        publicInfo: 'pub',
        privateInfo: 'secret',
        isPublic: true,
        tags: [],
        locations: [],
      }),
    } as never);
    const result = await call(getOrganization)({ data: { id: 'o1', campaignId: 'camp-1' } });
    expect(result.privateInfo).toBe('');
    expect(result.publicInfo).toBe('pub');
  });

  it('returns null for non-GM on a private org they did not create', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Organization.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        campaignId: 'camp-1',
        createdBy: 'someone',
        name: 'Secret',
        isPublic: false,
        locations: [],
      }),
    } as never);
    const result = await call(getOrganization)({ data: { id: 'o1', campaignId: 'camp-1' } });
    expect(result).toBeNull();
  });
});

describe('deleteOrganization', () => {
  it('cascade-deletes memberships', async () => {
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'o1', campaignId: 'camp-1', createdBy: 'user-1' }),
    } as never);
    vi.mocked(Organization.deleteOne).mockResolvedValue({} as never);
    vi.mocked(OrganizationMembership.deleteMany).mockResolvedValue({} as never);
    await call(deleteOrganization)({ data: { id: 'o1', campaignId: 'camp-1' } });
    expect(OrganizationMembership.deleteMany).toHaveBeenCalledWith({ organizationId: 'o1' });
  });
});

describe('listMembershipsForMember', () => {
  it('excludes memberships to private orgs for non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(OrganizationMembership.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'm1',
          organizationId: 'pub',
          memberKind: 'character',
          memberId: 'c1',
          campaignId: 'camp-1',
          createdBy: 'x',
          privateNotes: 'p',
        },
        {
          _id: 'm2',
          organizationId: 'priv',
          memberKind: 'character',
          memberId: 'c1',
          campaignId: 'camp-1',
          createdBy: 'x',
          privateNotes: 'p',
        },
      ]),
    } as never);
    // Org lookups: pub is public, priv is private
    vi.mocked(Organization.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: 'pub', name: 'Public Guild', isPublic: true },
        { _id: 'priv', name: 'Secret', isPublic: false },
      ]),
    } as never);
    const result = await call(listMembershipsForMember)({
      data: { campaignId: 'camp-1', memberKind: 'character', memberId: 'c1' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe('pub');
    expect(result[0].privateNotes).toBe(''); // stripped for non-GM
  });
});
