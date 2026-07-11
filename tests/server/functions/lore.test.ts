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
vi.mock('~/server/db/models/Lore', () => ({
  Lore: {
    find: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
  },
}));
// The real removeDocumentRefsFromScreens lives in gmscreens-helpers, not a separate utils file
vi.mock('~/server/functions/gmscreens-helpers', () => ({
  removeDocumentRefsFromScreens: vi.fn(),
}));
// Mock the entity models used for link-label resolution
vi.mock('~/server/db/models/Character', () => ({ Character: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Player', () => ({ Player: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Location', () => ({ Location: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Event', () => ({ Event: { updateMany: vi.fn() } }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Lore } from '~/server/db/models/Lore';
import { removeDocumentRefsFromScreens } from '~/server/functions/gmscreens-helpers';
import { listLore, getLore, createLore, updateLore, deleteLore } from '~/server/functions/lore';

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

const _list = listLore as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown[]>;
const _get = getLore as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<Record<string, unknown> | null>;
const _create = createLore as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown>;
const _update = updateLore as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown>;
const _delete = deleteLore as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown>;

function mockFindReturning(docs: unknown[]) {
  vi.mocked(Lore.find).mockReturnValue({
    sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(docs) }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(User.findOne).mockResolvedValue(dbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
});

describe('listLore', () => {
  it('restricts non-GM members to public or own lore', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    mockFindReturning([]);
    await _list({ data: { campaignId: 'camp-1' } });
    const filter = vi.mocked(Lore.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter).toMatchObject({ campaignId: 'camp-1' });
    expect(JSON.stringify(filter)).toContain('$or'); // isPublic OR createdBy === user
  });

  it('adds a links filter when linkedKind/linkedId provided', async () => {
    mockFindReturning([]);
    await _list({ data: { campaignId: 'camp-1', linkedKind: 'player', linkedId: 'p-1' } });
    const filter = vi.mocked(Lore.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.links).toEqual({ $elemMatch: { kind: 'player', id: 'p-1' } });
  });

  it('never returns gmContent', async () => {
    mockFindReturning([
      {
        _id: 'l1',
        title: 'T',
        content: 'c',
        gmContent: 'secret',
        isPublic: true,
        images: [],
        links: [],
        tags: [],
        campaignId: 'camp-1',
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = (await _list({ data: { campaignId: 'camp-1' } })) as Record<string, unknown>[];
    expect(res[0]).not.toHaveProperty('gmContent');
  });
});

describe('getLore', () => {
  it('strips gmContent for non-GM viewers', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Lore.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'l1',
        title: 'T',
        content: 'c',
        gmContent: 'secret',
        isPublic: true,
        images: [],
        links: [],
        tags: [],
        campaignId: 'camp-1',
        createdBy: 'someone',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as never);
    const res = await _get({ data: { id: 'l1', campaignId: 'camp-1' } });
    expect(res?.gmContent).toBe('');
    expect(res?.canEdit).toBe(false);
  });

  it('returns null for a private lore a non-owner non-GM requests', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Lore.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'l1',
        isPublic: false,
        createdBy: 'someone-else',
        campaignId: 'camp-1',
        title: 'T',
        content: '',
        gmContent: '',
        images: [],
        links: [],
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as never);
    const res = await _get({ data: { id: 'l1', campaignId: 'camp-1' } });
    expect(res).toBeNull();
  });
});

describe('updateLore / deleteLore permissions', () => {
  it('forbids a non-creator non-GM from updating', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Lore.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'l1',
        campaignId: 'camp-1',
        createdBy: 'someone-else',
      }),
    } as never);
    await expect(_update({ data: { id: 'l1', campaignId: 'camp-1', title: 'X' } })).rejects.toThrow(
      'Forbidden'
    );
  });

  it('lets the creator delete and clears screen refs', async () => {
    vi.mocked(Lore.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'l1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
      }),
    } as never);
    vi.mocked(Lore.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);
    const res = await _delete({ data: { id: 'l1', campaignId: 'camp-1' } });
    expect(res).toEqual({ success: true });
    // Real signature: removeDocumentRefsFromScreens(campaignId, collection, documentId)
    expect(removeDocumentRefsFromScreens).toHaveBeenCalledWith('camp-1', 'lore', 'l1');
  });
});

describe('createLore', () => {
  it('allows any member to create', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Lore.create).mockResolvedValue({
      _id: 'new',
      title: 'T',
      content: '',
      gmContent: '',
      isPublic: false,
      images: [],
      links: [],
      tags: [],
      campaignId: 'camp-1',
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const res = (await _create({ data: { campaignId: 'camp-1', title: 'T' } })) as Record<
      string,
      unknown
    >;
    expect(res.success).toBe(true);
  });

  it('does NOT persist gmContent when a non-GM creates lore', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    vi.mocked(Lore.create).mockResolvedValue({
      _id: 'new',
      title: 'T',
      content: '',
      gmContent: '',
      isPublic: false,
      images: [],
      links: [],
      tags: [],
      campaignId: 'camp-1',
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await _create({ data: { campaignId: 'camp-1', title: 'T', gmContent: 'secret' } });
    const createArg = vi.mocked(Lore.create).mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.gmContent).toBe('');
  });
});

describe('listLore GM visibility filter', () => {
  it('adds isPublic:true filter when GM requests visibility=public', async () => {
    mockFindReturning([]);
    await _list({ data: { campaignId: 'camp-1', visibility: 'public' } });
    const filter = vi.mocked(Lore.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.isPublic).toBe(true);
  });

  it('adds isPublic:false filter when GM requests visibility=private', async () => {
    mockFindReturning([]);
    await _list({ data: { campaignId: 'camp-1', visibility: 'private' } });
    const filter = vi.mocked(Lore.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.isPublic).toBe(false);
  });
});

describe('updateLore GM gmContent', () => {
  it('returns gmContent populated when a GM updates lore', async () => {
    vi.mocked(Lore.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'l1',
        campaignId: 'camp-1',
        createdBy: 'someone-else',
      }),
    } as never);
    vi.mocked(Lore.findOneAndUpdate).mockResolvedValue({
      _id: 'l1',
      title: 'Updated',
      content: 'body',
      gmContent: 'gm notes',
      isPublic: true,
      images: [],
      links: [],
      tags: [],
      campaignId: 'camp-1',
      createdBy: 'someone-else',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const res = (await _update({
      data: { id: 'l1', campaignId: 'camp-1', title: 'Updated', gmContent: 'gm notes' },
    })) as Record<string, Record<string, unknown>>;
    expect(res.success).toBe(true);
    expect(res.lore.gmContent).toBe('gm notes');
  });

  it('does NOT write gmContent when a non-GM creator updates lore (preserves stored GM notes)', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    // non-GM must be the creator to pass the permission check
    vi.mocked(Lore.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'l1',
        campaignId: 'camp-1',
        createdBy: 'user-1',
        // A GM previously attached private notes to this doc.
        gmContent: 'gm-only secret',
      }),
    } as never);
    vi.mocked(Lore.findOneAndUpdate).mockResolvedValue({
      _id: 'l1',
      title: 'Updated',
      content: 'body',
      // Stored value is untouched because the update omitted the field.
      gmContent: 'gm-only secret',
      isPublic: false,
      images: [],
      links: [],
      tags: [],
      campaignId: 'camp-1',
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const res = (await _update({
      data: { id: 'l1', campaignId: 'camp-1', title: 'Updated', gmContent: 'injected' },
    })) as Record<string, Record<string, unknown>>;
    const updateArg = vi.mocked(Lore.findOneAndUpdate).mock.calls[0][1] as Record<
      string,
      Record<string, unknown>
    >;
    // The non-GM's gmContent input is neither trusted nor persisted: the field
    // must be absent from $set so the GM's stored notes survive the edit...
    expect(updateArg.$set).not.toHaveProperty('gmContent');
    // ...and a non-GM never receives gmContent back in the response.
    expect(res.lore.gmContent).toBe('');
  });
});
