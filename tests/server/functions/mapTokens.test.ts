import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

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
vi.mock('~/server/db/models/Map', () => ({
  Map: { findOne: vi.fn() },
}));
vi.mock('~/server/db/models/MapToken', () => ({
  MapToken: { find: vi.fn() },
}));
vi.mock('~/server/db/models/Player', () => ({ Player: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Character', () => ({ Character: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Monster', () => ({ Monster: { findOne: vi.fn() } }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Map as MapModel } from '~/server/db/models/Map';
import { MapToken } from '~/server/db/models/MapToken';
import { listMapTokens } from '~/server/functions/mapTokens';

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'Test User',
  email: 'test@example.com',
  avatar: null,
  role: 'gm',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};
const mockDbUser = { _id: 'dbuser-1', firstName: 'Test', lastName: 'User' };
// User is a member (GM) of campaign A only.
const campaignA = {
  _id: 'camp-A',
  gameMasterId: 'dbuser-1',
  members: [{ userId: 'dbuser-1', role: 'gm' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(campaignA);
});

const _listMapTokens = listMapTokens as unknown as (args: {
  data: { campaignId: string; mapId: string };
}) => Promise<{ tokens: unknown[] }>;

function mockMapTokenFind(docs: unknown[]) {
  vi.mocked(MapToken.find).mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(docs),
      }),
    }),
  } as never);
}

describe('listMapTokens — IDOR / campaign scoping', () => {
  it('rejects reading tokens of a map that does not belong to the campaign', async () => {
    // Map belongs to campaign B, so a scoped lookup within campaign A finds nothing.
    vi.mocked(MapModel.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    mockMapTokenFind([]);

    await expect(
      _listMapTokens({ data: { campaignId: 'camp-A', mapId: 'map-from-camp-B' } })
    ).rejects.toThrow('Map not found');

    // Critically, tokens must never be queried for a foreign map.
    expect(MapToken.find).not.toHaveBeenCalled();
    // The scoping lookup must constrain by both _id and campaignId.
    expect(MapModel.findOne).toHaveBeenCalledWith({
      _id: 'map-from-camp-B',
      campaignId: 'camp-A',
    });
  });

  it('returns tokens for a legitimate same-campaign read', async () => {
    const tokenDoc = {
      _id: 't1',
      mapId: 'map-A',
      campaignId: 'camp-A',
      sourceCollection: 'monster',
      sourceDocumentId: 'mon-1',
      ownerUserId: null,
      x: 10,
      y: 20,
      sizeSquares: 1,
      instanceNumber: 1,
      color: '#fff',
      label: 'Goblin A',
      imageUrl: '',
      hiddenFromPlayers: false,
      zIndex: 0,
      createdAt: new Date(0),
    };
    // Map belongs to campaign A.
    vi.mocked(MapModel.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'map-A', campaignId: 'camp-A' }),
    } as never);
    mockMapTokenFind([tokenDoc]);

    const result = await _listMapTokens({
      data: { campaignId: 'camp-A', mapId: 'map-A' },
    });

    expect(MapToken.find).toHaveBeenCalledWith(expect.objectContaining({ mapId: 'map-A' }));
    expect(result.tokens).toHaveLength(1);
  });
});
