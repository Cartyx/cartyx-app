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
vi.mock('~/server/db/models/Session', () => ({
  Session: { findById: vi.fn() },
}));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findById: vi.fn() },
}));
vi.mock('~/server/db/models/DiceRoll', () => ({
  DiceRoll: {
    find: vi.fn(),
    updateOne: vi.fn(),
  },
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Session as DbSession } from '~/server/db/models/Session';
import { Campaign } from '~/server/db/models/Campaign';
import { DiceRoll } from '~/server/db/models/DiceRoll';
import { listDiceRolls, saveDiceRoll } from '~/server/functions/diceRolls';

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
const mockDbSession = { campaignId: 'camp-1' };
const mockCampaign = {
  _id: 'camp-1',
  gameMasterId: 'dbuser-1',
  members: [{ userId: 'dbuser-1', role: 'gm' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser);
  vi.mocked(DbSession.findById).mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockDbSession),
    }),
  } as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign);
});

const _listDiceRolls = listDiceRolls as unknown as (args: {
  data: { sessionId: string; limit?: number; beforeSeq?: number };
}) => Promise<unknown[]>;

const _saveDiceRoll = saveDiceRoll as unknown as (args: {
  data: {
    id: string;
    seq: number;
    sessionId: string;
    campaignId: string;
    channel: string;
    character: string;
    title: string;
    rollType: string;
    attackRolls: Array<{ roll: number; type: string; total: number }>;
    damageRolls: Array<{ damageType: string; dice: number[]; total: number; flags: number }>;
    totalDamages: Record<string, number>;
    rollInfo: Array<[string, string]>;
    description: string;
    timestamp: number;
  };
}) => Promise<{ success: boolean }>;

describe('listDiceRolls', () => {
  it('returns dice rolls ordered by seq', async () => {
    const mockRolls = [
      {
        _id: 'r1',
        id: 'uuid-1',
        seq: 1,
        sessionId: 'sess-1',
        campaignId: 'camp-1',
        channel: 'general',
        character: 'Thorn',
        title: 'Longsword Attack',
        rollType: 'attack',
        attackRolls: [{ roll: 14, type: 'hit', total: 18 }],
        damageRolls: [{ damageType: 'slashing', dice: [4, 5], total: 11, flags: 1 }],
        totalDamages: { slashing: 11 },
        rollInfo: [],
        description: '',
        timestamp: 1000,
      },
    ];

    const mockSort = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockRolls),
      }),
    });
    vi.mocked(DiceRoll.find).mockReturnValue({ sort: mockSort } as never);

    const result = await _listDiceRolls({ data: { sessionId: 'sess-1' } });

    expect(DiceRoll.find).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    expect(mockSort).toHaveBeenCalledWith({ seq: 1 });
    expect(result).toHaveLength(1);
  });

  it('applies beforeSeq filter for pagination', async () => {
    const mockSort = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });
    vi.mocked(DiceRoll.find).mockReturnValue({ sort: mockSort } as never);

    await _listDiceRolls({ data: { sessionId: 'sess-1', beforeSeq: 50 } });

    expect(DiceRoll.find).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      seq: { $lt: 50 },
    });
  });
});

describe('listDiceRolls — GM channel filtering', () => {
  it('filters out gm channel rolls for non-GM users', async () => {
    const playerCampaign = {
      _id: 'camp-1',
      gameMasterId: 'other-user',
      members: [{ userId: 'dbuser-1', role: 'player' }],
    };
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign);

    const mockSort = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });
    vi.mocked(DiceRoll.find).mockReturnValue({ sort: mockSort } as never);

    await _listDiceRolls({ data: { sessionId: 'sess-1' } });

    expect(DiceRoll.find).toHaveBeenCalledWith(expect.objectContaining({ channel: 'general' }));
  });

  it('allows GM to see all channels', async () => {
    const mockSort = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });
    vi.mocked(DiceRoll.find).mockReturnValue({ sort: mockSort } as never);

    await _listDiceRolls({ data: { sessionId: 'sess-1' } });

    expect(DiceRoll.find).toHaveBeenCalledWith({ sessionId: 'sess-1' });
  });
});

describe('saveDiceRoll', () => {
  it('rejects non-GM writing to gm channel', async () => {
    const playerCampaign = {
      _id: 'camp-1',
      gameMasterId: 'other-user',
      members: [{ userId: 'dbuser-1', role: 'player' }],
    };
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign);

    await expect(
      _saveDiceRoll({
        data: {
          id: 'uuid-1',
          seq: 1,
          sessionId: 'sess-1',
          campaignId: 'camp-1',
          channel: 'gm',
          character: 'Thorn',
          title: 'Sneak Attack',
          rollType: 'attack',
          attackRolls: [{ roll: 14, type: 'hit', total: 18 }],
          damageRolls: [{ damageType: 'slashing', dice: [4, 5], total: 11, flags: 1 }],
          totalDamages: { slashing: 11 },
          rollInfo: [],
          description: '',
          timestamp: 1000,
        },
      })
    ).rejects.toThrow('Forbidden: GM channel requires GM role');
  });

  it('upserts dice roll by id', async () => {
    vi.mocked(DiceRoll.updateOne).mockResolvedValue({
      acknowledged: true,
      modifiedCount: 0,
      upsertedCount: 1,
      upsertedId: null,
      matchedCount: 0,
    });

    const result = await _saveDiceRoll({
      data: {
        id: 'uuid-1',
        seq: 1,
        sessionId: 'sess-1',
        campaignId: 'camp-1',
        channel: 'general',
        character: 'Thorn',
        title: 'Longsword Attack',
        rollType: 'attack',
        attackRolls: [{ roll: 14, type: 'hit', total: 18 }],
        damageRolls: [{ damageType: 'slashing', dice: [4, 5], total: 11, flags: 1 }],
        totalDamages: { slashing: 11 },
        rollInfo: [],
        description: '',
        timestamp: 1000,
      },
    });

    expect(DiceRoll.updateOne).toHaveBeenCalledWith(
      { id: 'uuid-1', sessionId: 'sess-1' },
      {
        $set: expect.objectContaining({
          id: 'uuid-1',
          character: 'Thorn',
          title: 'Longsword Attack',
        }),
        $setOnInsert: expect.objectContaining({
          createdAt: expect.any(Date),
        }),
      },
      { upsert: true }
    );
    expect(result).toEqual({ success: true });
  });
});
