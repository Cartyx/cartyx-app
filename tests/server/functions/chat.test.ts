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
vi.mock('~/server/db/models/Message', () => ({
  Message: {
    find: vi.fn(),
    updateOne: vi.fn(),
  },
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Session as DbSession } from '~/server/db/models/Session';
import { Campaign } from '~/server/db/models/Campaign';
import { Message } from '~/server/db/models/Message';
import { listMessages, saveMessage } from '~/server/functions/chat';

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
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(DbSession.findById).mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockDbSession),
    }),
  } as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign);
});

const _listMessages = listMessages as unknown as (args: {
  data: { sessionId: string; limit?: number; beforeSeq?: number };
}) => Promise<unknown[]>;

const _saveMessage = saveMessage as unknown as (args: {
  data: {
    id: string;
    seq: number;
    sessionId: string;
    campaignId: string;
    channel: string;
    type: string;
    authorId: string;
    authorName: string;
    text: string;
    timestamp: number;
  };
}) => Promise<{ success: boolean }>;

describe('listMessages', () => {
  const baseMsgs = [
    {
      _id: 'm1',
      id: 'uuid-1',
      seq: 1,
      sessionId: 'sess-1',
      campaignId: 'camp-1',
      channel: 'general',
      type: 'chat',
      authorId: 'user-1',
      authorName: 'Test User',
      text: 'Hello',
      beyond20Data: undefined,
      timestamp: 1000,
    },
  ];

  it('returns messages ordered by seq', async () => {
    const mockSort = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(baseMsgs),
      }),
    });
    vi.mocked(Message.find).mockReturnValue({ sort: mockSort } as never);

    const result = await _listMessages({ data: { sessionId: 'sess-1' } });

    expect(Message.find).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    expect(mockSort).toHaveBeenCalledWith({ seq: 1 });
    expect(result).toHaveLength(1);
  });

  it('applies beforeSeq filter for pagination', async () => {
    const mockSort = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });
    vi.mocked(Message.find).mockReturnValue({ sort: mockSort } as never);

    await _listMessages({ data: { sessionId: 'sess-1', beforeSeq: 50 } });

    expect(Message.find).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      seq: { $lt: 50 },
    });
  });
});

describe('listMessages — GM channel filtering', () => {
  it('filters out gm channel messages for non-GM users', async () => {
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
    vi.mocked(Message.find).mockReturnValue({ sort: mockSort } as never);

    await _listMessages({ data: { sessionId: 'sess-1' } });

    // Non-GM should have channel:'general' filter applied
    expect(Message.find).toHaveBeenCalledWith(expect.objectContaining({ channel: 'general' }));
  });

  it('allows GM to see all channels', async () => {
    const mockSort = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });
    vi.mocked(Message.find).mockReturnValue({ sort: mockSort } as never);

    await _listMessages({ data: { sessionId: 'sess-1' } });

    // GM should NOT have channel filter
    expect(Message.find).toHaveBeenCalledWith({ sessionId: 'sess-1' });
  });
});

describe('saveMessage', () => {
  it('rejects non-GM writing to gm channel', async () => {
    const playerCampaign = {
      _id: 'camp-1',
      gameMasterId: 'other-user',
      members: [{ userId: 'dbuser-1', role: 'player' }],
    };
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign);

    await expect(
      _saveMessage({
        data: {
          id: 'uuid-1',
          seq: 1,
          sessionId: 'sess-1',
          campaignId: 'camp-1',
          channel: 'gm',
          type: 'chat',
          authorId: 'session-user-1',
          authorName: 'Test User',
          text: 'secret',
          timestamp: 1000,
        },
      })
    ).rejects.toThrow('Forbidden: GM channel requires GM role');
  });

  it('overrides client-provided authorId with authenticated user id', async () => {
    vi.mocked(Message.updateOne).mockResolvedValue({
      acknowledged: true,
      modifiedCount: 0,
      upsertedCount: 1,
      upsertedId: null,
      matchedCount: 0,
    });

    await _saveMessage({
      data: {
        id: 'uuid-1',
        seq: 1,
        sessionId: 'sess-1',
        campaignId: 'camp-1',
        channel: 'general',
        type: 'chat',
        authorId: 'spoofed-user',
        authorName: 'Test User',
        text: 'Hello',
        timestamp: 1000,
      },
    });

    expect(Message.updateOne).toHaveBeenCalledWith(
      { id: 'uuid-1', sessionId: 'sess-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          authorId: 'session-user-1', // should be the authenticated user's id, not the spoofed one
        }),
      }),
      { upsert: true }
    );
  });

  it('upserts message by id', async () => {
    vi.mocked(Message.updateOne).mockResolvedValue({
      acknowledged: true,
      modifiedCount: 0,
      upsertedCount: 1,
      upsertedId: null,
      matchedCount: 0,
    });

    const result = await _saveMessage({
      data: {
        id: 'uuid-1',
        seq: 1,
        sessionId: 'sess-1',
        campaignId: 'camp-1',
        channel: 'general',
        type: 'chat',
        authorId: 'user-1',
        authorName: 'Test User',
        text: 'Hello',
        timestamp: 1000,
      },
    });

    expect(Message.updateOne).toHaveBeenCalledWith(
      { id: 'uuid-1', sessionId: 'sess-1' },
      {
        $set: expect.objectContaining({
          id: 'uuid-1',
          seq: 1,
          text: 'Hello',
          authorId: 'session-user-1',
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
