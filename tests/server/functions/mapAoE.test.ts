import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));
vi.mock('~/server/db/models/User', () => ({
  User: { findOne: vi.fn(), findById: vi.fn() },
}));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findById: vi.fn() },
}));
vi.mock('~/server/db/models/MapAoE', () => ({
  MapAoE: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    countDocuments: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Map', () => ({
  Map: { findOne: vi.fn() },
}));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { MapAoE } from '~/server/db/models/MapAoE';
import { Map as MapModel } from '~/server/db/models/Map';
import {
  createMapAoE,
  listMapAoE,
  removeMapAoE,
  clearMapAoE,
  moveMapAoE,
} from '~/server/functions/mapAoE';

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
    save: vi.fn(),
    toObject: function (this: Record<string, unknown>) {
      return this;
    },
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
const _moveMapAoE = moveMapAoE as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ aoe: Record<string, unknown> }>;

function mockUserFindById(user: Record<string, unknown> | null) {
  vi.mocked(User.findById).mockReturnValue({
    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(user) }),
  } as never);
}

function mockMapBounds(imageWidth = 1000, imageHeight = 1000) {
  vi.mocked(MapModel.findOne).mockReturnValue({
    lean: vi.fn().mockResolvedValue({ imageWidth, imageHeight }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser);
  vi.mocked(Campaign.findById).mockResolvedValue(mockGMCampaign);
  mockUserFindById({ firstName: 'Ada', lastName: 'Lovelace' });
  mockMapBounds();
  vi.mocked(MapAoE.countDocuments).mockResolvedValue(0 as never);
});

// ---------------------------------------------------------------------------
// createMapAoE
// ---------------------------------------------------------------------------

describe('createMapAoE', () => {
  it('sets createdBy and createdByName (resolved from the placer) and returns the doc', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    mockUserFindById({ firstName: 'Ada', lastName: 'Lovelace' });
    const created = makeAoE({ createdByName: 'Ada Lovelace' });
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
    expect(result.aoe.createdByName).toBe('Ada Lovelace');
    expect(vi.mocked(MapAoE.create).mock.calls[0][0]).toMatchObject({
      createdBy: 'dbuser-1',
      createdByName: 'Ada Lovelace',
      campaignId: 'camp-1',
      mapId: 'map-1',
    });
  });

  it('clamps an out-of-bounds origin into the map image bounds', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    mockMapBounds(1000, 800);
    const created = makeAoE();
    vi.mocked(MapAoE.create).mockResolvedValue({ ...created, toObject: () => created } as never);

    await _createMapAoE({
      data: {
        campaignId: 'camp-1',
        mapId: 'map-1',
        shape: 'sphere',
        originX: 5000, // beyond width 1000
        originY: -50, // below 0
        sizePx: 50,
        rotation: 0,
        color: '#ff0000',
      },
    });

    expect(vi.mocked(MapAoE.create).mock.calls[0][0]).toMatchObject({
      originX: 1000,
      originY: 0,
    });
  });

  it('rejects creation when the map is already at the template cap', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    vi.mocked(MapAoE.countDocuments).mockResolvedValue(200 as never);

    await expect(
      _createMapAoE({
        data: {
          campaignId: 'camp-1',
          mapId: 'map-1',
          shape: 'sphere',
          originX: 100,
          originY: 100,
          sizePx: 50,
          rotation: 0,
          color: '#ff0000',
        },
      })
    ).rejects.toThrow(/maximum/i);
    expect(MapAoE.create).not.toHaveBeenCalled();
  });

  it('persists an optional label when provided', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    mockUserFindById({ firstName: 'Ada', lastName: 'Lovelace' });
    const created = makeAoE({ createdByName: 'Ada Lovelace', label: 'Fireball' });
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
        label: 'Fireball',
      },
    });

    expect(result.aoe.label).toBe('Fireball');
    expect(vi.mocked(MapAoE.create).mock.calls[0][0]).toMatchObject({
      label: 'Fireball',
    });
  });

  it('falls back to email, then Unknown, when the placer has no name', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    mockUserFindById({ email: 'ada@example.com' });
    const created = makeAoE({ createdByName: 'ada@example.com' });
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

    expect(result.aoe.createdByName).toBe('ada@example.com');
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
// moveMapAoE
// ---------------------------------------------------------------------------

describe('moveMapAoE', () => {
  it('allows a player to move their own AoE', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const doc = makeAoE({ createdBy: 'dbuser-1' });
    vi.mocked(MapAoE.findOne).mockResolvedValue(doc as never);

    const result = await _moveMapAoE({
      data: { campaignId: 'camp-1', mapId: 'map-1', id: 'aoe-1', originX: 300, originY: 400 },
    });

    expect(doc.originX).toBe(300);
    expect(doc.originY).toBe(400);
    expect(doc.save).toHaveBeenCalled();
    expect(result.aoe.originX).toBe(300);
    expect(result.aoe.originY).toBe(400);
  });

  it("throws Forbidden when a player moves another member's AoE, and does not save", async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const doc = makeAoE({ createdBy: 'other' });
    vi.mocked(MapAoE.findOne).mockResolvedValue(doc as never);

    await expect(
      _moveMapAoE({
        data: { campaignId: 'camp-1', mapId: 'map-1', id: 'aoe-1', originX: 1, originY: 1 },
      })
    ).rejects.toThrow('Forbidden');

    expect(doc.save).not.toHaveBeenCalled();
  });

  it("allows a GM to move anyone's AoE", async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockGMCampaign);
    const doc = makeAoE({ createdBy: 'other' });
    vi.mocked(MapAoE.findOne).mockResolvedValue(doc as never);

    const result = await _moveMapAoE({
      data: { campaignId: 'camp-1', mapId: 'map-1', id: 'aoe-1', originX: 50, originY: 60 },
    });

    expect(doc.save).toHaveBeenCalled();
    expect(result.aoe.originX).toBe(50);
    expect(result.aoe.originY).toBe(60);
  });

  it('throws when the AoE is not found', async () => {
    vi.mocked(MapAoE.findOne).mockResolvedValue(null);

    await expect(
      _moveMapAoE({
        data: { campaignId: 'camp-1', mapId: 'map-1', id: 'nonexistent', originX: 1, originY: 1 },
      })
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
