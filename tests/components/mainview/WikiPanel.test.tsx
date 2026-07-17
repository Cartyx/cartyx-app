import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WikiPanel } from '~/components/wiki/WikiPanel';

// Mock the router param hook + campaign hook because WikiPanel needs
// campaign.isGM to decide whether to render the GM-only Monsters entry.
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'c1' }),
}));
const { useCampaignMock } = vi.hoisted(() => ({
  useCampaignMock: vi.fn(),
}));
vi.mock('~/hooks/useCampaigns', () => ({
  useCampaign: useCampaignMock,
}));

// Mock panels since they require routing/campaign context
vi.mock('~/components/wiki/characters/CharactersPanel', () => ({
  CharactersPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="characters-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/races/RacesPanel', () => ({
  RacesPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="races-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/rules/RulesPanel', () => ({
  RulesPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="rules-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/spells/SpellsPanel', () => ({
  SpellsPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="spells-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/locations/LocationsPanel', () => ({
  LocationsPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="locations-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/lore/LorePanel', () => ({
  LorePanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="lore-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/organizations/OrganizationsPanel', () => ({
  OrganizationsPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="organizations-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/quests/QuestsPanel', () => ({
  QuestsPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="quests-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/maps/MapsPanel', () => ({
  MapsPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="maps-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/monsters/MonstersPanel', () => ({
  MonstersPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="monsters-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/calendar/CalendarPanel', () => ({
  CalendarPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="calendar-panel">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('~/components/wiki/calendar/EventsPanel', () => ({
  EventsPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="events-panel-stub">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

describe('WikiPanel', () => {
  it('renders the Characters category button (non-GM)', () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    render(<WikiPanel />);
    expect(screen.getByRole('button', { name: 'Characters' })).toBeInTheDocument();
  });

  it('shows only the ten player categories when not GM (no Maps, no Monsters, no Events)', () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    render(<WikiPanel />);

    expect(screen.getAllByRole('button')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Characters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Players' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Races' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rules' })).toBeInTheDocument();
    // Spells is visible to all members.
    expect(screen.getByRole('button', { name: 'Spells' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Locations' })).toBeInTheDocument();
    // Lore is visible to all members.
    expect(screen.getByRole('button', { name: 'Lore' })).toBeInTheDocument();
    // Organizations is visible to all members.
    expect(screen.getByRole('button', { name: 'Organizations' })).toBeInTheDocument();
    // Quests is visible to all members.
    expect(screen.getByRole('button', { name: 'Quests' })).toBeInTheDocument();
    // Calendar is visible to all members.
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    // Maps + Monsters + Events are GM-only.
    expect(screen.queryByRole('button', { name: 'Maps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Monsters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Events' })).not.toBeInTheDocument();
  });

  it('shows the GM-only Maps + Monsters + Events categories when viewer is GM', () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: true } });
    render(<WikiPanel />);

    expect(screen.getAllByRole('button')).toHaveLength(13);
    expect(screen.getByRole('button', { name: 'Maps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monsters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Events' })).toBeInTheDocument();
  });

  it('Calendar category is visible to non-GM members', () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    render(<WikiPanel />);
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
  });

  it('clicking Calendar shows CalendarPanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Calendar' }));

    expect(screen.getByTestId('calendar-panel')).toBeInTheDocument();
  });

  it('clicking Events shows EventsPanel for GM', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: true } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Events' }));

    expect(screen.getByTestId('events-panel-stub')).toBeInTheDocument();
  });

  it('clicking Lore shows LorePanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Lore' }));

    expect(screen.getByTestId('lore-panel')).toBeInTheDocument();
  });

  it('clicking Organizations shows OrganizationsPanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Organizations' }));

    expect(screen.getByTestId('organizations-panel')).toBeInTheDocument();
  });

  it('clicking Quests shows QuestsPanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Quests' }));

    expect(screen.getByTestId('quests-panel')).toBeInTheDocument();
  });

  it('clicking Characters shows CharactersPanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Characters' }));

    expect(screen.getByTestId('characters-panel')).toBeInTheDocument();
  });

  it('clicking Races shows RacesPanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Races' }));

    expect(screen.getByTestId('races-panel')).toBeInTheDocument();
  });

  it('clicking Rules shows RulesPanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Rules' }));

    expect(screen.getByTestId('rules-panel')).toBeInTheDocument();
  });

  it('clicking Spells shows SpellsPanel', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Spells' }));

    expect(screen.getByTestId('spells-panel')).toBeInTheDocument();
  });

  it('clicking Monsters shows MonstersPanel for GM', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: true } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Monsters' }));

    expect(screen.getByTestId('monsters-panel')).toBeInTheDocument();
  });

  it('CharactersPanel onBack returns to category list', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Characters' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByTestId('characters-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Characters' })).toBeInTheDocument();
  });

  it('RacesPanel onBack returns to category list', async () => {
    useCampaignMock.mockReturnValue({ campaign: { isGM: false } });
    const user = userEvent.setup();
    render(<WikiPanel />);

    await user.click(screen.getByRole('button', { name: 'Races' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByTestId('races-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Races' })).toBeInTheDocument();
  });
});
