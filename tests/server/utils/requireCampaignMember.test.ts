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

import { getSession } from '~/server/session';
import { connectDB, isDBConnected } from '~/server/db/connection';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { requireCampaignMember } from '~/server/utils/requireCampaignMember';

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(isDBConnected).mockReturnValue(true);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
});

describe('requireCampaignMember', () => {
  it('allows the GM (gameMasterId match) and reports isGM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-A',
      gameMasterId: 'dbuser-1',
      members: [{ userId: 'dbuser-1', role: 'gm' }],
    } as never);

    const result = await requireCampaignMember('camp-A');

    expect(result).toEqual({
      userId: 'dbuser-1',
      sessionUserId: 'session-user-1',
      isGM: true,
    });
  });

  it('allows a non-GM member and reports isGM false', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-A',
      gameMasterId: 'someone-else',
      members: [{ userId: 'dbuser-1', role: 'player' }],
    } as never);

    const result = await requireCampaignMember('camp-A');

    expect(result).toEqual({
      userId: 'dbuser-1',
      sessionUserId: 'session-user-1',
      isGM: false,
    });
  });

  it('rejects a user who is not a member of the campaign', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-A',
      gameMasterId: 'someone-else',
      members: [{ userId: 'another-member', role: 'player' }],
    } as never);

    await expect(requireCampaignMember('camp-A')).rejects.toThrow('Forbidden');
  });

  it('rejects when not authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);

    await expect(requireCampaignMember('camp-A')).rejects.toThrow('Not authenticated');
    expect(connectDB).not.toHaveBeenCalled();
  });

  it('throws when the database is unavailable', async () => {
    vi.mocked(isDBConnected).mockReturnValue(false);

    await expect(requireCampaignMember('camp-A')).rejects.toThrow('Database not available');
  });

  it('throws when the DB user is not found', async () => {
    vi.mocked(User.findOne).mockResolvedValue(null);

    await expect(requireCampaignMember('camp-A')).rejects.toThrow('User not found');
  });

  it('throws when the campaign is not found', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(null as never);

    await expect(requireCampaignMember('camp-A')).rejects.toThrow('Campaign not found');
  });
});
