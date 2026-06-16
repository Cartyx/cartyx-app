import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PartyMembersWidget } from '~/components/mainview/widgets/PartyMembersWidget';
import { getPartyMembers } from '~/services/mocks/partyMembersService';
import type { PlayerListItem } from '~/types/player';

// The widget calls usePlayers (React Query) unconditionally, so mock it to
// avoid needing a QueryClientProvider and to control the fetched data.
const mockUsePlayers = vi.fn();
vi.mock('~/hooks/usePlayers', () => ({
  usePlayers: (...args: unknown[]) => mockUsePlayers(...args),
}));

// Stub the detail popup so these tests don't need a QueryClientProvider; we
// only assert that clicking a card opens it with the right player/campaign.
vi.mock('~/components/wiki/players/PlayerViewModal', () => ({
  PlayerViewModal: ({ playerId, campaignId }: { playerId: string; campaignId: string }) => (
    <div data-testid="player-view-modal">{`${campaignId}:${playerId}`}</div>
  ),
}));

function makePlayer(overrides: Partial<PlayerListItem>): PlayerListItem {
  return {
    id: 'p1',
    campaignId: 'c1',
    createdBy: 'u1',
    firstName: 'Yara',
    lastName: 'Cinderfell',
    race: 'Half-Orc',
    characterClass: 'Rogue',
    color: '#aa3333',
    picture: '',
    pictureCrop: null,
    status: { value: 'alive', changedAt: null, changedBy: null },
    canEdit: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockUsePlayers.mockReset();
  mockUsePlayers.mockReturnValue({ players: [], isLoading: false, error: null });
});

describe('PartyMembersWidget', () => {
  it('renders the widget title', () => {
    render(<PartyMembersWidget members={[]} />);

    expect(screen.getByText('Party Members')).toBeInTheDocument();
  });

  it('renders all party member names from the members prop', async () => {
    const members = await getPartyMembers();

    render(<PartyMembersWidget members={members} />);

    for (const member of members) {
      expect(screen.getByText(member.name)).toBeInTheDocument();
    }
  });

  it('shows class and race for each member', async () => {
    const members = await getPartyMembers();

    render(<PartyMembersWidget members={members} />);

    for (const member of members) {
      expect(screen.getByText(member.characterClass)).toBeInTheDocument();
      expect(screen.getByText(member.race)).toBeInTheDocument();
    }
  });

  it('shows the empty state when members is empty', () => {
    render(<PartyMembersWidget members={[]} />);

    expect(screen.getByText('No party members found')).toBeInTheDocument();
  });

  it('renders real campaign players from usePlayers when no members prop is given', () => {
    mockUsePlayers.mockReturnValue({
      players: [
        makePlayer({
          id: 'p1',
          firstName: 'Yara',
          lastName: 'Cinderfell',
          race: 'Half-Orc',
          characterClass: 'Rogue',
        }),
        makePlayer({
          id: 'p2',
          firstName: 'Oryn',
          lastName: 'Brightblade',
          race: 'Half-Elf',
          characterClass: 'Barbarian',
        }),
      ],
      isLoading: false,
      error: null,
    });

    render(<PartyMembersWidget campaignId="c1" />);

    expect(mockUsePlayers).toHaveBeenCalledWith('c1');
    expect(screen.getByText('Yara Cinderfell')).toBeInTheDocument();
    expect(screen.getByText('Oryn Brightblade')).toBeInTheDocument();
    expect(screen.getByText('Rogue')).toBeInTheDocument();
    expect(screen.getByText('Half-Elf')).toBeInTheDocument();
  });

  it('renders a player avatar when the player has a picture', () => {
    mockUsePlayers.mockReturnValue({
      players: [
        makePlayer({
          firstName: 'Yara',
          lastName: 'Cinderfell',
          picture: '/uploads/seed-players/yara.png',
        }),
      ],
      isLoading: false,
      error: null,
    });

    render(<PartyMembersWidget campaignId="c1" />);

    const avatar = screen.getByAltText('Yara Cinderfell avatar') as HTMLImageElement;
    expect(avatar).toBeInTheDocument();
    expect(avatar.src).toContain('/uploads/seed-players/yara.png');
  });

  it('shows the loading state while players are being fetched', () => {
    mockUsePlayers.mockReturnValue({ players: [], isLoading: true, error: null });

    render(<PartyMembersWidget campaignId="c1" />);

    expect(screen.getByText('Loading party members...')).toBeInTheDocument();
  });

  it('shows an error state when the players query fails', () => {
    mockUsePlayers.mockReturnValue({ players: [], isLoading: false, error: 'boom' });

    render(<PartyMembersWidget campaignId="c1" />);

    expect(screen.getByText('Unable to load party members.')).toBeInTheDocument();
  });

  it('shows the empty state when the campaign has no players', () => {
    mockUsePlayers.mockReturnValue({ players: [], isLoading: false, error: null });

    render(<PartyMembersWidget campaignId="c1" />);

    expect(screen.getByText('No party members found')).toBeInTheDocument();
  });

  it('opens the player detail popup when a member card is clicked', () => {
    mockUsePlayers.mockReturnValue({
      players: [makePlayer({ id: 'p1', firstName: 'Yara', lastName: 'Cinderfell' })],
      isLoading: false,
      error: null,
    });

    render(<PartyMembersWidget campaignId="c1" />);

    expect(screen.queryByTestId('player-view-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Yara Cinderfell' }));

    expect(screen.getByTestId('player-view-modal')).toHaveTextContent('c1:p1');
  });

  it('renders cards as non-interactive rows without a campaignId', () => {
    render(
      <PartyMembersWidget
        members={[{ id: 'p1', name: 'Yara Cinderfell', characterClass: 'Rogue', race: 'Half-Orc' }]}
      />
    );

    // No focusable, do-nothing button is presented when no detail view is reachable.
    expect(screen.queryByRole('button', { name: 'View Yara Cinderfell' })).not.toBeInTheDocument();
    // The member is still shown, just not clickable.
    expect(screen.getByText('Yara Cinderfell')).toBeInTheDocument();
    expect(screen.queryByTestId('player-view-modal')).not.toBeInTheDocument();
  });
});
