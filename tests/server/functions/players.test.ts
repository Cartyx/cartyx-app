import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: unknown) => fn }),
    handler: (fn: unknown) => fn,
  }),
}));
vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/db/models/User', () => ({ User: { findOne: vi.fn(), updateOne: vi.fn() } }));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findOneAndUpdate: vi.fn() },
}));
vi.mock('~/server/db/models/Player', () => ({
  Player: {
    findOne: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
    findById: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Character', () => ({
  Character: { create: vi.fn() },
}));
vi.mock('~/server/db/models/Lore', () => ({
  Lore: { create: vi.fn() },
}));
vi.mock('~/server/functions/gmscreens-helpers', () => ({
  removeDocumentRefsFromScreens: vi.fn(),
}));
vi.mock('~/server/utils/pruneLoreLinks', () => ({
  pruneLoreLinks: vi.fn(),
}));
vi.mock('~/server/utils/requireCampaignMember', () => ({
  requireCampaignMember: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Player } from '~/server/db/models/Player';
import { Character } from '~/server/db/models/Character';
import { Lore } from '~/server/db/models/Lore';
import { completeJoinWizard } from '~/server/functions/players';

const _completeJoinWizard = completeJoinWizard as unknown as (a: {
  data: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

const mockSession = { id: 'sess-user-1' };
const mockDbUser = { _id: 'dbuser-1' };
const mockCampaign = { _id: 'camp-1', name: 'Test Campaign', maxPlayers: 4, members: [] };
const mockPlayerDoc = { _id: 'player-id-1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession as never);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(User.updateOne).mockResolvedValue({} as never);
  vi.mocked(Campaign.findOneAndUpdate).mockResolvedValue(mockCampaign as never);
  vi.mocked(Player.findOne).mockResolvedValue(null); // no existing player
  vi.mocked(Player.create).mockResolvedValue(mockPlayerDoc as never);
  vi.mocked(Player.updateOne).mockResolvedValue({} as never);
  vi.mocked(Character.create).mockResolvedValue({ _id: 'char-id-1' } as never);
  vi.mocked(Lore.create).mockResolvedValue({} as never);
});

const basePlayerInput = {
  firstName: 'Aria',
  lastName: 'Brightblade',
  race: 'Elf',
  characterClass: 'Ranger',
  age: 25,
  gender: 'Female',
  location: '',
  link: '',
  picture: '',
  pictureCrop: null,
  description: '',
  backstory: '',
  color: '#3498db',
  eyeColor: '',
  hairColor: '',
  weight: null,
  height: '',
  size: '',
  appearance: '',
};

describe('completeJoinWizard', () => {
  it('creates the player and returns success with playerId', async () => {
    const result = await _completeJoinWizard({
      data: { campaignId: 'camp-1', player: basePlayerInput, characters: [], lore: [] },
    });
    expect(result.success).toBe(true);
    expect(result.playerId).toBe('player-id-1');
    expect(Player.create).toHaveBeenCalledTimes(1);
  });

  it('creates Lore docs linked to the new player when lore entries are provided', async () => {
    const result = await _completeJoinWizard({
      data: {
        campaignId: 'camp-1',
        player: basePlayerInput,
        characters: [],
        lore: [
          { title: 'A', content: 'x', isPublic: true },
          { title: 'B', content: '', isPublic: false },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(Lore.create).toHaveBeenCalledTimes(2);

    const firstCall = vi.mocked(Lore.create).mock.calls[0][0] as Record<string, unknown>;
    expect(firstCall.title).toBe('A');
    expect(firstCall.content).toBe('x');
    expect(firstCall.isPublic).toBe(true);
    expect(firstCall.campaignId).toBe('camp-1');
    expect(firstCall.createdBy).toBe('dbuser-1');
    expect(firstCall.links).toEqual([{ kind: 'player', id: 'player-id-1' }]);

    const secondCall = vi.mocked(Lore.create).mock.calls[1][0] as Record<string, unknown>;
    expect(secondCall.title).toBe('B');
    expect(secondCall.content).toBe('');
    expect(secondCall.isPublic).toBe(false);
    expect(secondCall.links).toEqual([{ kind: 'player', id: 'player-id-1' }]);
  });

  it('does NOT call Lore.create when lore array is empty', async () => {
    await _completeJoinWizard({
      data: { campaignId: 'camp-1', player: basePlayerInput, characters: [], lore: [] },
    });
    expect(Lore.create).not.toHaveBeenCalled();
  });

  it('does NOT call Lore.create when lore is omitted', async () => {
    await _completeJoinWizard({
      data: { campaignId: 'camp-1', player: basePlayerInput, characters: [] },
    });
    expect(Lore.create).not.toHaveBeenCalled();
  });

  it('throws when campaign is full', async () => {
    vi.mocked(Campaign.findOneAndUpdate).mockResolvedValue(null);
    await expect(
      _completeJoinWizard({
        data: { campaignId: 'camp-1', player: basePlayerInput, characters: [] },
      })
    ).rejects.toThrow('Campaign is full');
  });

  it('throws when player already exists for this campaign', async () => {
    vi.mocked(Player.findOne).mockResolvedValue({ _id: 'existing' } as never);
    await expect(
      _completeJoinWizard({
        data: { campaignId: 'camp-1', player: basePlayerInput, characters: [] },
      })
    ).rejects.toThrow('Player already exists for this campaign');
  });
});
