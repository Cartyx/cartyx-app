import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KeyAlliesWidget } from '~/components/mainview/widgets/KeyAlliesWidget';
import type { CharacterListItem } from '~/types/character';

function makeAllies(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `ally-${i + 1}`,
    name: `Ally ${i + 1}`,
    town: `Town ${i + 1}`,
  }));
}

// The widget calls useCharacters (React Query) unconditionally, so mock it to
// avoid needing a QueryClientProvider and to control the fetched data.
const mockUseCharacters = vi.fn();
vi.mock('~/hooks/useCharacters', () => ({
  useCharacters: (...args: unknown[]) => mockUseCharacters(...args),
}));

// Stub the detail popup so these tests don't need a QueryClientProvider; we
// only assert that clicking a card opens it with the right character/campaign.
vi.mock('~/components/wiki/characters/CharacterViewModal', () => ({
  CharacterViewModal: ({
    characterId,
    campaignId,
  }: {
    characterId: string;
    campaignId: string;
  }) => <div data-testid="character-view-modal">{`${campaignId}:${characterId}`}</div>,
}));

function makeCharacter(overrides: Partial<CharacterListItem>): CharacterListItem {
  return {
    id: 'c1',
    campaignId: 'camp1',
    createdBy: 'u1',
    firstName: 'Elder',
    lastName: 'Morvain',
    race: 'Human',
    characterClass: 'Sage',
    age: null,
    location: 'Thornhollow',
    link: '',
    picture: '',
    pictureCrop: null,
    tags: ['ally'],
    isPublic: true,
    sessions: [],
    createdAt: '',
    updatedAt: '',
    status: { value: 'alive', changedAt: null, changedBy: null },
    canEdit: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockUseCharacters.mockReset();
  mockUseCharacters.mockReturnValue({ characters: [], isLoading: false, error: null });
});

describe('KeyAlliesWidget', () => {
  it('renders the widget title', () => {
    render(<KeyAlliesWidget allies={[]} />);

    expect(screen.getByText('Key Allies')).toBeInTheDocument();
  });

  it('renders all ally names and locations from the allies prop', () => {
    const allies = [
      { id: 'ally-1', name: 'Elder Morvain', town: 'Thornhollow' },
      { id: 'ally-2', name: 'Mira Quickstep', town: 'Goldmeadow' },
    ];

    render(<KeyAlliesWidget allies={allies} />);

    for (const ally of allies) {
      expect(screen.getByText(ally.name)).toBeInTheDocument();
      expect(screen.getByText(ally.town)).toBeInTheDocument();
    }
  });

  it('renders the empty state when allies is empty', () => {
    render(<KeyAlliesWidget allies={[]} />);

    expect(screen.getByText('No allies found')).toBeInTheDocument();
  });

  it('renders initials fallback when no avatarUrl', () => {
    render(<KeyAlliesWidget allies={[{ id: 'a1', name: 'Elder Morvain', town: 'Thornhollow' }]} />);
    // "Elder Morvain" → initials "EM"
    expect(screen.getByText('EM')).toBeInTheDocument();
  });

  it('renders img when avatarUrl is provided', () => {
    render(
      <KeyAlliesWidget
        allies={[
          {
            id: 'a1',
            name: 'Elder Morvain',
            town: 'Thornhollow',
            avatarUrl: 'https://example.com/avatar.jpg',
          },
        ]}
      />
    );
    const img = screen.getByRole('img', { name: 'Elder Morvain' });
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('fetches characters tagged "ally" for the campaign', () => {
    render(<KeyAlliesWidget campaignId="camp1" />);

    expect(mockUseCharacters).toHaveBeenCalledWith('camp1', { tags: ['ally'] });
  });

  it('renders ally-tagged characters from useCharacters when no allies prop is given', () => {
    mockUseCharacters.mockReturnValue({
      characters: [
        makeCharacter({
          id: 'c1',
          firstName: 'Elder',
          lastName: 'Morvain',
          location: 'Thornhollow',
        }),
        makeCharacter({
          id: 'c2',
          firstName: 'Captain Elira',
          lastName: 'Voss',
          location: 'Ravenwatch',
        }),
      ],
      isLoading: false,
      error: null,
    });

    render(<KeyAlliesWidget campaignId="camp1" />);

    expect(screen.getByText('Elder Morvain')).toBeInTheDocument();
    expect(screen.getByText('Thornhollow')).toBeInTheDocument();
    expect(screen.getByText('Captain Elira Voss')).toBeInTheDocument();
    expect(screen.getByText('Ravenwatch')).toBeInTheDocument();
  });

  it('renders a character avatar when the character has a picture', () => {
    mockUseCharacters.mockReturnValue({
      characters: [
        makeCharacter({
          firstName: 'Elder',
          lastName: 'Morvain',
          picture: '/uploads/seed-characters/morvain.png',
        }),
      ],
      isLoading: false,
      error: null,
    });

    render(<KeyAlliesWidget campaignId="camp1" />);

    const avatar = screen.getByRole('img', { name: 'Elder Morvain' }) as HTMLImageElement;
    expect(avatar.src).toContain('/uploads/seed-characters/morvain.png');
  });

  it('shows the loading state while allies are being fetched', () => {
    mockUseCharacters.mockReturnValue({ characters: [], isLoading: true, error: null });

    render(<KeyAlliesWidget campaignId="camp1" />);

    expect(screen.getByText('Loading allies...')).toBeInTheDocument();
  });

  it('shows an error state when the characters query fails', () => {
    mockUseCharacters.mockReturnValue({ characters: [], isLoading: false, error: 'boom' });

    render(<KeyAlliesWidget campaignId="camp1" />);

    expect(screen.getByText('Unable to load allies.')).toBeInTheDocument();
  });

  it('shows the empty state when the campaign has no ally-tagged characters', () => {
    mockUseCharacters.mockReturnValue({ characters: [], isLoading: false, error: null });

    render(<KeyAlliesWidget campaignId="camp1" />);

    expect(screen.getByText('No allies found')).toBeInTheDocument();
  });

  it('does not show the pager when there are 10 or fewer allies', () => {
    render(<KeyAlliesWidget allies={makeAllies(10)} />);

    expect(screen.queryByLabelText('Next allies')).not.toBeInTheDocument();
    expect(screen.getByText('Ally 10')).toBeInTheDocument();
  });

  it('shows only the first 10 allies and a pager when there are more than 10', () => {
    render(<KeyAlliesWidget allies={makeAllies(15)} />);

    expect(screen.getByText('Ally 1')).toBeInTheDocument();
    expect(screen.getByText('Ally 10')).toBeInTheDocument();
    expect(screen.queryByText('Ally 11')).not.toBeInTheDocument();
    expect(screen.getByText('1–10 of 15')).toBeInTheDocument();
  });

  it('paginates to the remaining allies on next, and disables prev on the first page', () => {
    render(<KeyAlliesWidget allies={makeAllies(15)} />);

    expect(screen.getByLabelText('Previous allies')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Next allies'));

    expect(screen.getByText('Ally 11')).toBeInTheDocument();
    expect(screen.getByText('Ally 15')).toBeInTheDocument();
    expect(screen.queryByText('Ally 10')).not.toBeInTheDocument();
    expect(screen.getByText('11–15 of 15')).toBeInTheDocument();
    expect(screen.getByLabelText('Next allies')).toBeDisabled();
  });

  it('opens the character detail popup when an ally card is clicked', () => {
    mockUseCharacters.mockReturnValue({
      characters: [makeCharacter({ id: 'c1', firstName: 'Elder', lastName: 'Morvain' })],
      isLoading: false,
      error: null,
    });

    render(<KeyAlliesWidget campaignId="camp1" />);

    expect(screen.queryByTestId('character-view-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Elder Morvain' }));

    expect(screen.getByTestId('character-view-modal')).toHaveTextContent('camp1:c1');
  });

  it('does not make cards interactive without a campaignId', () => {
    render(<KeyAlliesWidget allies={[{ id: 'a1', name: 'Elder Morvain', town: 'Thornhollow' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'View Elder Morvain' }));

    expect(screen.queryByTestId('character-view-modal')).not.toBeInTheDocument();
  });
});
