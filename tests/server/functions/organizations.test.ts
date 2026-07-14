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
  Organization: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
  },
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
vi.mock('~/server/db/models/Character', () => ({
  Character: { findById: vi.fn(), findOne: vi.fn(), find: vi.fn(), exists: vi.fn() },
}));
vi.mock('~/server/db/models/Player', () => ({
  Player: { findById: vi.fn(), findOne: vi.fn(), find: vi.fn(), exists: vi.fn() },
}));
vi.mock('~/server/functions/gmscreens-helpers', () => ({ removeDocumentRefsFromScreens: vi.fn() }));
vi.mock('~/server/functions/tags', () => ({ ensureTags: vi.fn() }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Organization } from '~/server/db/models/Organization';
import { OrganizationMembership } from '~/server/db/models/OrganizationMembership';
import { Character } from '~/server/db/models/Character';
import { Player } from '~/server/db/models/Player';
import {
  listOrganizations,
  getOrganization,
  updateOrganization,
  deleteOrganization,
  addMembership,
  listMembershipsForOrg,
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
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
        }),
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
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
        }),
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
      limit: vi.fn().mockReturnValue({
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
      }),
    } as never);
    vi.mocked(Character.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'c1', firstName: 'Bob', lastName: 'Stone' }),
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

describe('updateOrganization', () => {
  it('preserves GM private data on a non-GM (creator) update', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
        name: 'Guild',
        publicInfo: 'p',
        privateInfo: 'GM secret',
        isPublic: false,
        tags: [],
        locations: [{ locationId: 'loc-1', publicInfo: 'p', privateInfo: 'loc secret' }],
      }),
    } as never);
    vi.mocked(Organization.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
        name: 'Guild',
        publicInfo: 'p2',
        isPublic: false,
        tags: [],
        locations: [{ locationId: 'loc-1', publicInfo: 'p2', privateInfo: 'loc secret' }],
      }),
    } as never);

    await call(updateOrganization)({
      data: {
        id: 'o1',
        campaignId: 'camp-1',
        name: 'Guild',
        publicInfo: 'p2',
        privateInfo: '',
        isPublic: false,
        tags: [],
        locations: [{ locationId: 'loc-1', publicInfo: 'p2', privateInfo: '' }],
      },
    });

    const set = vi.mocked(Organization.findOneAndUpdate).mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(set.$set).not.toHaveProperty('privateInfo');
    const locations = set.$set.locations as Array<Record<string, unknown>>;
    expect(locations[0].privateInfo).toBe('loc secret');
  });

  it('writes privateInfo when the caller is a GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
        name: 'Guild',
        publicInfo: 'p',
        privateInfo: 'old secret',
        isPublic: false,
        tags: [],
        locations: [],
      }),
    } as never);
    vi.mocked(Organization.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
        name: 'Guild',
        publicInfo: 'p',
        privateInfo: 'new secret',
        isPublic: false,
        tags: [],
        locations: [],
      }),
    } as never);

    await call(updateOrganization)({
      data: {
        id: 'o1',
        campaignId: 'camp-1',
        name: 'Guild',
        publicInfo: 'p',
        privateInfo: 'new secret',
        isPublic: false,
        tags: [],
        locations: [],
      },
    });

    const set = vi.mocked(Organization.findOneAndUpdate).mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(set.$set.privateInfo).toBe('new secret');
  });
});

describe('addMembership', () => {
  it('stores privateNotes for a GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        createdBy: 'someone-else',
        name: 'Guild',
        isPublic: true,
      }),
    } as never);
    vi.mocked(OrganizationMembership.create).mockResolvedValue({
      _id: 'm1',
      campaignId: 'camp-1',
      organizationId: 'o1',
      memberKind: 'character',
      memberId: 'c1',
      title: '',
      publicNotes: '',
      privateNotes: 'secret',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(Character.exists).mockResolvedValue({ _id: 'c1' } as never);
    vi.mocked(Character.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    await call(addMembership)({
      data: {
        campaignId: 'camp-1',
        organizationId: 'o1',
        memberKind: 'character',
        memberId: 'c1',
        title: '',
        publicNotes: '',
        privateNotes: 'secret',
      },
    });

    expect(OrganizationMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({ privateNotes: 'secret' })
    );
  });

  it('stores empty privateNotes for a non-GM creator', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'o1',
        createdBy: 'user-1',
        name: 'Guild',
        isPublic: true,
      }),
    } as never);
    vi.mocked(OrganizationMembership.create).mockResolvedValue({
      _id: 'm2',
      campaignId: 'camp-1',
      organizationId: 'o1',
      memberKind: 'character',
      memberId: 'c1',
      title: '',
      publicNotes: '',
      privateNotes: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(Character.exists).mockResolvedValue({ _id: 'c1' } as never);
    vi.mocked(Character.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    await call(addMembership)({
      data: {
        campaignId: 'camp-1',
        organizationId: 'o1',
        memberKind: 'character',
        memberId: 'c1',
        title: '',
        publicNotes: '',
        privateNotes: 'attempted secret',
      },
    });

    expect(OrganizationMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({ privateNotes: '' })
    );
  });

  it('rejects a member that does not belong to the campaign', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'o1', createdBy: 'x', name: 'Guild', isPublic: true }),
    } as never);
    // Character does not exist in this campaign.
    vi.mocked(Character.exists).mockResolvedValue(null as never);

    await expect(
      call(addMembership)({
        data: {
          campaignId: 'camp-1',
          organizationId: 'o1',
          memberKind: 'character',
          memberId: 'foreign-char',
          title: '',
          publicNotes: '',
          privateNotes: '',
        },
      })
    ).rejects.toThrow();
    expect(OrganizationMembership.create).not.toHaveBeenCalled();
  });
});

describe('listMembershipsForOrg', () => {
  it('batch-resolves member labels without a per-member findById', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue({ _id: 'o1', createdBy: 'user-1', name: 'Guild', isPublic: true }),
    } as never);
    vi.mocked(OrganizationMembership.find).mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: 'm1',
            organizationId: 'o1',
            memberKind: 'character',
            memberId: 'c1',
            campaignId: 'camp-1',
            createdBy: 'x',
          },
          {
            _id: 'm2',
            organizationId: 'o1',
            memberKind: 'player',
            memberId: 'p1',
            campaignId: 'camp-1',
            createdBy: 'x',
          },
        ]),
      }),
    } as never);
    vi.mocked(Character.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'c1', firstName: 'Bob', lastName: 'Stone' }]),
    } as never);
    vi.mocked(Player.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'p1', firstName: 'Ann', lastName: 'Vale' }]),
    } as never);

    const result = await call(listMembershipsForOrg)({
      data: { campaignId: 'camp-1', organizationId: 'o1' },
    });

    expect(result).toHaveLength(2);
    expect(result.find((m: any) => m.memberId === 'c1').memberLabel).toBe('Bob Stone');
    expect(result.find((m: any) => m.memberId === 'p1').memberLabel).toBe('Ann Vale');
    // Batched: one find() per kind, and no N+1 findById.
    expect(Character.find).toHaveBeenCalledTimes(1);
    expect(Player.find).toHaveBeenCalledTimes(1);
    expect(Character.findById).not.toHaveBeenCalled();
    expect(Player.findById).not.toHaveBeenCalled();
  });

  it('returns [] for a non-GM non-creator on a private org', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Organization.findOne).mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue({ _id: 'o1', createdBy: 'someone', name: 'Secret', isPublic: false }),
    } as never);

    const result = await call(listMembershipsForOrg)({
      data: { campaignId: 'camp-1', organizationId: 'o1' },
    });
    expect(result).toEqual([]);
    expect(OrganizationMembership.find).not.toHaveBeenCalled();
  });
});
