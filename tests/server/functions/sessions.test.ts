import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

const mockMongoSessionObj = {
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  endSession: vi.fn(),
};
vi.mock('mongoose', () => ({
  default: {
    startSession: vi.fn(() => mockMongoSessionObj),
  },
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
vi.mock('~/server/db/models/Session', () => ({
  Session: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
  },
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Session } from '~/server/db/models/Session';
import {
  listSessions,
  getSessionCatchUp,
  createSession,
  updateSession,
} from '~/server/functions/sessions';

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
const mockCampaign = {
  _id: 'camp-1',
  gameMasterId: 'dbuser-1',
  members: [{ userId: 'dbuser-1', role: 'gm' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign);
});

// Cast server functions to callable handler signatures
const _listSessions = listSessions as unknown as (args: {
  data: { campaignId: string; includeCompleted?: boolean };
}) => Promise<unknown>;
const _getSessionCatchUp = getSessionCatchUp as unknown as (args: {
  data: { campaignId: string; sessionId: string };
}) => Promise<{ catchUp: string | null }>;
const _createSession = createSession as unknown as (args: {
  data: { campaignId: string; name: string; startDate: string };
}) => Promise<unknown>;
const _updateSession = updateSession as unknown as (args: {
  data: {
    sessionId: string;
    campaignId: string;
    name?: string;
    startDate?: string;
    endDate?: string;
  };
}) => Promise<unknown>;

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------
describe('listSessions', () => {
  const baseSessions = [
    {
      _id: 's1',
      name: 'Session 1',
      number: 1,
      startDate: new Date('2025-01-01'),
      endDate: null,
      status: 'active',
    },
    {
      _id: 's2',
      name: 'Session 0',
      number: 0,
      startDate: new Date('2024-12-01'),
      endDate: new Date('2024-12-02'),
      status: 'not_started',
    },
  ];

  it('returns incomplete sessions by default (no endDate)', async () => {
    const incompleteSessions = [baseSessions[0]];
    const mockSort = vi
      .fn()
      .mockReturnValue({ lean: vi.fn().mockResolvedValue(incompleteSessions) });
    vi.mocked(Session.find).mockReturnValue({ sort: mockSort } as never);

    const result = await _listSessions({ data: { campaignId: 'camp-1' } });

    expect(Session.find).toHaveBeenCalledWith(
      { campaignId: 'camp-1', status: { $ne: 'completed' } },
      '_id name number startDate endDate status summary createdAt updatedAt'
    );
    expect(mockSort).toHaveBeenCalledWith({ startDate: -1 });
    expect(result).toEqual([
      {
        id: 's1',
        name: 'Session 1',
        number: 1,
        startDate: baseSessions[0].startDate.toISOString(),
        endDate: null,
        status: 'active',
        catchUp: null,
      },
    ]);
  });

  it('returns all sessions when includeCompleted is true', async () => {
    const mockSort = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(baseSessions) });
    vi.mocked(Session.find).mockReturnValue({ sort: mockSort } as never);

    const result = await _listSessions({ data: { campaignId: 'camp-1', includeCompleted: true } });

    expect(Session.find).toHaveBeenCalledWith(
      { campaignId: 'camp-1' },
      '_id name number startDate endDate status summary createdAt updatedAt'
    );
    expect(result).toHaveLength(2);
  });

  it('maps summary field to catchUp when present', async () => {
    const sessionsWithSummary = [
      {
        ...baseSessions[0],
        summary: 'The party defeated the dragon and claimed the treasure.',
      },
    ];
    const mockSort = vi
      .fn()
      .mockReturnValue({ lean: vi.fn().mockResolvedValue(sessionsWithSummary) });
    vi.mocked(Session.find).mockReturnValue({ sort: mockSort } as never);

    const result = await _listSessions({ data: { campaignId: 'camp-1' } });

    expect(result).toEqual([
      expect.objectContaining({
        id: 's1',
        catchUp: 'The party defeated the dragon and claimed the treasure.',
      }),
    ]);
  });

  it('throws when user is not the GM of the campaign', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      ...mockCampaign,
      gameMasterId: 'other-user-id',
    });

    await expect(_listSessions({ data: { campaignId: 'camp-1' } })).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// getSessionCatchUp
// ---------------------------------------------------------------------------
describe('getSessionCatchUp', () => {
  it("returns a session's summary as catchUp for a campaign member", async () => {
    vi.mocked(Session.findOne).mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue({ _id: 's1', summary: 'Recap of the **fall** of Emberfall.' }),
    } as never);

    const result = await _getSessionCatchUp({ data: { campaignId: 'camp-1', sessionId: 's1' } });

    expect(Session.findOne).toHaveBeenCalledWith(
      { _id: 's1', campaignId: 'camp-1' },
      '_id summary'
    );
    expect(result).toEqual({ catchUp: 'Recap of the **fall** of Emberfall.' });
  });

  it('is readable by a non-GM player member', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: 'other-gm',
      members: [{ userId: 'dbuser-1', role: 'player' }],
    });
    vi.mocked(Session.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 's1', summary: 'Player-visible recap.' }),
    } as never);

    const result = await _getSessionCatchUp({ data: { campaignId: 'camp-1', sessionId: 's1' } });

    expect(result).toEqual({ catchUp: 'Player-visible recap.' });
  });

  it('returns null catchUp when the session has no summary', async () => {
    vi.mocked(Session.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 's1' }),
    } as never);

    const result = await _getSessionCatchUp({ data: { campaignId: 'camp-1', sessionId: 's1' } });

    expect(result).toEqual({ catchUp: null });
  });

  it('returns null catchUp when the session is not found in the campaign', async () => {
    vi.mocked(Session.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const result = await _getSessionCatchUp({ data: { campaignId: 'camp-1', sessionId: 'nope' } });

    expect(result).toEqual({ catchUp: null });
  });

  it('throws when the user is not a member of the campaign', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: 'other-gm',
      members: [{ userId: 'someone-else', role: 'player' }],
    });

    await expect(
      _getSessionCatchUp({ data: { campaignId: 'camp-1', sessionId: 's1' } })
    ).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
describe('createSession', () => {
  it('creates an inactive session with auto-assigned number in a transaction', async () => {
    vi.mocked(Session.findOne).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue({ number: 2 }),
          }),
        }),
      }),
    } as never);
    vi.mocked(Session.create).mockResolvedValue([
      {
        _id: 'new-session-1',
        name: 'The Dragon Quest',
        number: 3,
        startDate: new Date('2025-06-01'),
        endDate: null,
        status: 'not_started',
      },
    ] as never);

    const result = await _createSession({
      data: {
        campaignId: 'camp-1',
        name: 'The Dragon Quest',
        startDate: '2025-06-01T00:00:00.000Z',
      },
    });

    expect(Session.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          campaignId: 'camp-1',
          name: 'The Dragon Quest',
          gm: 'dbuser-1',
          number: 3,
          startDate: expect.any(Date),
          status: 'not_started',
        }),
      ],
      expect.objectContaining({ session: mockMongoSessionObj })
    );
    expect(mockMongoSessionObj.endSession).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sessionId: 'new-session-1',
      })
    );
  });

  it('throws when user is not the GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      ...mockCampaign,
      gameMasterId: 'other-user-id',
    });

    await expect(
      _createSession({
        data: { campaignId: 'camp-1', name: 'Test', startDate: '2025-06-01T00:00:00.000Z' },
      })
    ).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// updateSession
// ---------------------------------------------------------------------------
describe('updateSession', () => {
  it('updates session fields', async () => {
    vi.mocked(Session.findOne).mockResolvedValue({
      _id: 's1',
      campaignId: 'camp-1',
      name: 'Old Name',
    } as never);
    vi.mocked(Session.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);

    const result = await _updateSession({
      data: {
        sessionId: 's1',
        campaignId: 'camp-1',
        name: 'New Name',
        startDate: '2025-07-01T00:00:00.000Z',
        endDate: '2025-07-02T00:00:00.000Z',
      },
    });

    expect(Session.findOne).toHaveBeenCalledWith({ _id: 's1', campaignId: 'camp-1' });
    expect(Session.updateOne).toHaveBeenCalledWith(
      { _id: 's1', campaignId: 'camp-1' },
      {
        $set: expect.objectContaining({
          name: 'New Name',
          startDate: expect.any(Date),
          endDate: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      }
    );
    expect(result).toEqual({ success: true });
  });

  it('throws when session does not belong to campaign', async () => {
    vi.mocked(Session.findOne).mockResolvedValue(null);

    await expect(
      _updateSession({
        data: {
          sessionId: 's1',
          campaignId: 'camp-1',
          name: 'Test',
          startDate: '2025-07-01T00:00:00.000Z',
        },
      })
    ).rejects.toThrow('Session not found');
  });

  it('updates without endDate when not provided', async () => {
    vi.mocked(Session.findOne).mockResolvedValue({
      _id: 's1',
      campaignId: 'camp-1',
    } as never);
    vi.mocked(Session.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);

    await _updateSession({
      data: {
        sessionId: 's1',
        campaignId: 'camp-1',
        name: 'Updated',
        startDate: '2025-07-01T00:00:00.000Z',
      },
    });

    expect(Session.updateOne).toHaveBeenCalledWith(
      { _id: 's1', campaignId: 'camp-1' },
      {
        $set: expect.objectContaining({
          name: 'Updated',
          startDate: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      }
    );

    // Verify endDate is NOT in the $set when not provided
    const updateCall = vi.mocked(Session.updateOne).mock.calls[0];
    const setFields = (updateCall[1] as { $set: Record<string, unknown> }).$set;
    expect(setFields).not.toHaveProperty('endDate');
  });
});
