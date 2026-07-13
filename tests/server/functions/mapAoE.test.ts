import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));
vi.mock('~/server/db/models/User', () => ({
  User: { findOne: vi.fn() },
}));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findById: vi.fn() },
}));
vi.mock('~/server/db/models/MapAoE', () => ({
  MapAoE: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { MapAoE } from '~/server/db/models/MapAoE';
import { createMapAoE, listMapAoE, removeMapAoE, clearMapAoE } from '~/server/functions/mapAoE';

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'Test User',
  email: 'test@example.com',
  avatar: null,
  role: 'player',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};
const mockDbUser = { _id: 'dbuser-1', firstName: 'Test', lastName: 'User' };
const mockGMCampaign = {
  _id: 'camp-1',
  gameMasterId: 'dbuser-1',
  members: [{ userId: 'dbuser-1', role: 'gm' }],
};
const mockPlayerCampaign = {
  _id: 'camp-1',
  gameMasterId: 'someone-else',
  members: [
    { userId: 'someone-else', role: 'gm' },
    { userId: 'dbuser-1', role: 'player' },
  ],
};
const mockNonMemberCampaign = {
  _id: 'camp-1',
  gameMasterId: 'someone-else',
  members: [{ userId: 'someone-else', role: 'gm' }],
};

function makeAoE(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'aoe-1',
    campaignId: 'camp-1',
    mapId: 'map-1',
    shape: 'sphere',
    originX: 100,
    originY: 200,
    sizePx: 50,
    widthPx: undefined,
    rotation: 0,
    color: '#ff0000',
    createdBy: 'dbuser-1',
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    deleteOne: vi.fn(),
    ...overrides,
  };
}

const _createMapAoE = createMapAoE as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ aoe: Record<string, unknown> }>;
const _listMapAoE = listMapAoE as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ aoes: Record<string, unknown>[] }>;
const _removeMapAoE = removeMapAoE as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;
const _clearMapAoE = clearMapAoE as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser);
  vi.mocked(Campaign.findById).mockResolvedValue(mockGMCampaign);
});

// ---------------------------------------------------------------------------
// createMapAoE
// ---------------------------------------------------------------------------

describe('createMapAoE', () => {
  it('sets createdBy to the member and returns the doc', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const created = makeAoE();
    vi.mocked(MapAoE.create).mockResolvedValue({
      ...created,
      toObject: () => created,
    } as never);

    const result = await _createMapAoE({
      data: {
        campaignId: 'camp-1',
        mapId: 'map-1',
        shape: 'sphere',
        originX: 100,
        originY: 200,
        sizePx: 50,
        rotation: 0,
        color: '#ff0000',
      },
    });

    expect(result.aoe.id).toBe('aoe-1');
    expect(vi.mocked(MapAoE.create).mock.calls[0][0]).toMatchObject({
      createdBy: 'dbuser-1',
      campaignId: 'camp-1',
      mapId: 'map-1',
    });
  });

  it('rejects a non-member (via requireCampaignMember)', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockNonMemberCampaign);

    await expect(
      _createMapAoE({
        data: {
          campaignId: 'camp-1',
          mapId: 'map-1',
          shape: 'sphere',
          originX: 0,
          originY: 0,
          sizePx: 10,
          rotation: 0,
          color: '#ff0000',
        },
      })
    ).rejects.toThrow('Forbidden');

    expect(MapAoE.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listMapAoE
// ---------------------------------------------------------------------------

describe('listMapAoE', () => {
  function mockFind(docs: unknown[] = []) {
    vi.mocked(MapAoE.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(docs) }),
      }),
    } as never);
  }

  it('returns docs to a player (non-GM) — not GM-gated', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const docs = [makeAoE(), makeAoE({ _id: 'aoe-2', createdBy: 'someone-else' })];
    mockFind(docs);

    const result = await _listMapAoE({ data: { campaignId: 'camp-1', mapId: 'map-1' } });

    expect(result.aoes).toHaveLength(2);
    expect(result.aoes[0].id).toBe('aoe-1');
    expect(result.aoes[1].id).toBe('aoe-2');
  });

  it('returns docs to a GM as well', async () => {
    mockFind([makeAoE()]);

    const result = await _listMapAoE({ data: { campaignId: 'camp-1', mapId: 'map-1' } });

    expect(result.aoes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeMapAoE
// ---------------------------------------------------------------------------

describe('removeMapAoE', () => {
  it('allows a player to remove their own AoE', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const doc = makeAoE({ createdBy: 'dbuser-1' });
    vi.mocked(MapAoE.findOne).mockResolvedValue(doc as never);

    const result = await _removeMapAoE({
      data: { campaignId: 'camp-1', mapId: 'map-1', id: 'aoe-1' },
    });

    expect(result.success).toBe(true);
    expect(doc.deleteOne).toHaveBeenCalled();
  });

  it("throws Forbidden when a player removes another member's AoE", async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const doc = makeAoE({ createdBy: 'other' });
    vi.mocked(MapAoE.findOne).mockResolvedValue(doc as never);

    await expect(
      _removeMapAoE({ data: { campaignId: 'camp-1', mapId: 'map-1', id: 'aoe-1' } })
    ).rejects.toThrow('Forbidden');

    expect(doc.deleteOne).not.toHaveBeenCalled();
  });

  it("allows a GM to remove anyone's AoE", async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockGMCampaign);
    const doc = makeAoE({ createdBy: 'other' });
    vi.mocked(MapAoE.findOne).mockResolvedValue(doc as never);

    const result = await _removeMapAoE({
      data: { campaignId: 'camp-1', mapId: 'map-1', id: 'aoe-1' },
    });

    expect(result.success).toBe(true);
    expect(doc.deleteOne).toHaveBeenCalled();
  });

  it('throws when the AoE is not found', async () => {
    vi.mocked(MapAoE.findOne).mockResolvedValue(null);

    await expect(
      _removeMapAoE({ data: { campaignId: 'camp-1', mapId: 'map-1', id: 'nonexistent' } })
    ).rejects.toThrow('AoE not found');
  });
});

// ---------------------------------------------------------------------------
// clearMapAoE
// ---------------------------------------------------------------------------

describe('clearMapAoE', () => {
  it('GM clears all AoEs on the map', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockGMCampaign);
    vi.mocked(MapAoE.deleteMany).mockResolvedValue({ deletedCount: 3 } as never);

    const result = await _clearMapAoE({ data: { campaignId: 'camp-1', mapId: 'map-1' } });

    expect(result.success).toBe(true);
    expect(MapAoE.deleteMany).toHaveBeenCalledWith({ campaignId: 'camp-1', mapId: 'map-1' });
  });

  it('throws Forbidden for a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);

    await expect(_clearMapAoE({ data: { campaignId: 'camp-1', mapId: 'map-1' } })).rejects.toThrow(
      'Forbidden'
    );

    expect(MapAoE.deleteMany).not.toHaveBeenCalled();
  });
});
