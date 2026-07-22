import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PartyMembersWidget } from '~/components/mainview/widgets/PartyMembersWidget';
import { WikiCardActionsTestWrapper } from '../../../support/renderWithWikiCardActions';
import type { PlayerListItem } from '~/types/player';

/**
 * Regression guard for the b1cfd32 crash: PartyMembersWidget opens PlayerViewModal
 * on the Dashboard, and that modal renders <ShowOnTabletopButton> — a
 * useWikiCardActions (→ useWikiCardActionsContext) consumer that THROWS when no
 * WikiCardActionsProvider is an ancestor. b1cfd32 mounted the provider only
 * inside InspectorSidebar (a sibling subtree), so clicking a Dashboard party
 * member crashed. The fix hoists the provider above BOTH the center column and
 * the inspector.
 *
 * Unlike PartyMembersWidget.test.tsx, this file DELIBERATELY does NOT mock
 * PlayerViewModal — the real modal + real ShowOnTabletopButton must mount so the
 * missing-provider crash is actually exercised. The widget is rendered under the
 * SAME provider the app now mounts (WikiCardActionsTestWrapper wraps the real
 * WikiCardActionsProvider), reproducing the Dashboard tab (surface === null).
 */

// Widget → usePlayers (list); modal → usePlayer (detail). Return the detail as
// still-loading so PlayerWindow never mounts — the modal header (which holds the
// ShowOnTabletopButton) renders regardless of load state, which is all we assert.
const mockUsePlayers = vi.fn();
const mockUsePlayer = vi.fn();
vi.mock('~/hooks/usePlayers', () => ({
  usePlayers: (...args: unknown[]) => mockUsePlayers(...args),
  usePlayer: (...args: unknown[]) => mockUsePlayer(...args),
}));

// useCampaign is read by BOTH the provider (isGM) and the modal (gates the
// GM-only ShowOnTabletopButton). GM = true so the button actually renders.
vi.mock('~/hooks/useCampaigns', () => ({
  useCampaign: () => ({ campaign: { isGM: true } }),
}));

// Router + tabletop/gm query hooks the provider subscribes to. tab: 'dashboard'
// reproduces the exact crash surface — the Dashboard, where surface is null.
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'c1' }),
  useSearch: () => ({ tab: 'dashboard' }),
}));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => ({
    playerState: { activeScreenId: null, activeGMScreenId: null, privateWindows: [] },
    addPrivateWindow: { mutate: vi.fn() },
    removePrivateWindow: { mutate: vi.fn() },
  }),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => ({ screens: [{ id: 'screen-1' }] }),
  useTabletopScreenDetail: () => ({ screen: null }),
  useTabletopMutations: () => ({ openWindow: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock('~/hooks/useGMScreens', () => ({
  useGMScreenList: () => ({ screens: [] }),
  useGMScreenDetail: () => ({ screen: null }),
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
  mockUsePlayer.mockReset();
  mockUsePlayers.mockReturnValue({
    players: [makePlayer({ id: 'p1', firstName: 'Yara', lastName: 'Cinderfell' })],
    isLoading: false,
    error: null,
  });
  mockUsePlayer.mockReturnValue({ player: null, isLoading: true });
});

describe('PartyMembersWidget → PlayerViewModal → ShowOnTabletopButton (Dashboard)', () => {
  it('opens the real player modal and renders ShowOnTabletopButton without throwing under the app provider', () => {
    render(<PartyMembersWidget campaignId="c1" />, { wrapper: WikiCardActionsTestWrapper });

    // Modal is closed initially.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Clicking a Dashboard party member mounts the un-mocked PlayerViewModal,
    // which renders ShowOnTabletopButton. Before the fix this threw
    // "must be used within a WikiCardActionsProvider".
    fireEvent.click(screen.getByRole('button', { name: 'View Yara Cinderfell' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The GM-only button is present and reachable — proving the consumer read the
    // hoisted context instead of crashing.
    expect(screen.getByRole('button', { name: 'Show on Tabletop' })).toBeInTheDocument();
  });

  it('throws the missing-provider error when the same modal mounts WITHOUT the provider (guard is real)', () => {
    // Proves the button is a genuine provider consumer: without the ancestor the
    // Dashboard click regresses to the b1cfd32 crash. Silence React's expected
    // error-boundary logging for the intentional throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<PartyMembersWidget campaignId="c1" />);
      expect(() =>
        fireEvent.click(screen.getByRole('button', { name: 'View Yara Cinderfell' }))
      ).toThrow(/must be used within a WikiCardActionsProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});
