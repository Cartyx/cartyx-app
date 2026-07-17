import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonstersPanel } from '~/components/wiki/monsters/MonstersPanel';
import { useMonsters, useMonsterMutations } from '~/hooks/useMonsters';
import { useCampaign } from '~/hooks/useCampaigns';

// Stub the modal to avoid portal / query-client complexity.
vi.mock('~/components/wiki/monsters/MonsterModal', () => ({
  MonsterModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="monster-modal" /> : null,
}));

vi.mock('~/hooks/useMonsters');
vi.mock('~/hooks/useCampaigns');
vi.mock('~/hooks/useTags', () => ({
  useTags: () => ({ tags: [], isLoading: false, error: null }),
}));
vi.mock('~/hooks/useGMScreens', () => ({
  useGMScreenDetail: () => ({ screen: null }),
  useGMScreenList: () => ({ screens: [] }),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenDetail: () => ({ screen: null }),
  useTabletopScreenList: () => ({ screens: [], isLoading: false, error: null }),
  useTabletopMutations: () => ({
    openWindow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'campaign-123' }),
  // MonsterCard's WikiCardMenu reads the main-view tab via useSearch.
  useSearch: () => ({ tab: 'wiki' }),
}));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => ({
    playerState: null,
    addPrivateWindow: { mutate: vi.fn() },
  }),
}));
vi.mock('~/utils/setTokenDragImage', () => ({
  setTokenDragImage: vi.fn(),
}));

const mockMonsters = [
  {
    id: 'monster-1',
    campaignId: 'campaign-123',
    createdBy: 'user-1',
    name: 'Ancient Red Dragon',
    size: 'Gargantuan',
    type: 'dragon',
    subtype: '',
    alignment: 'chaotic evil',
    cr: '24',
    picture: '',
    tags: [],
    sessionId: null,
    color: '#ff0000',
    source: 'custom',
    isHomebrew: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockRemoveAsync = vi.fn();

function setupMocks() {
  (useCampaign as ReturnType<typeof vi.fn>).mockReturnValue({
    campaign: { isGM: true, sessions: [] },
    isLoading: false,
    error: null,
  });
  (useMonsters as ReturnType<typeof vi.fn>).mockReturnValue({
    data: mockMonsters,
    isLoading: false,
    error: null,
  });
  mockRemoveAsync.mockResolvedValue({ success: true });
  (useMonsterMutations as ReturnType<typeof vi.fn>).mockReturnValue({
    remove: { mutateAsync: mockRemoveAsync, isPending: false },
  });
}

describe('MonstersPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GM sees a failure message and the confirm dialog stays open when the delete rejects', async () => {
    setupMocks();
    // useMonsterMutations exposes the raw mutation: unlike the createMutationHook
    // wiki hooks (which resolve to null), this mutateAsync REJECTS on failure.
    mockRemoveAsync.mockRejectedValue(new Error('server said no'));
    const user = userEvent.setup();
    render(<MonstersPanel onBack={vi.fn()} />);

    await user.click(await screen.findByLabelText('Monster actions'));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockRemoveAsync).toHaveBeenCalledWith('monster-1');
    });

    // The user is told it failed...
    expect(await screen.findByText(/failed to delete monster/i)).toBeInTheDocument();
    // ...and the dialog does NOT close as though the delete worked.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('GM confirming a successful delete removes the monster and closes the dialog', async () => {
    setupMocks();
    const user = userEvent.setup();
    render(<MonstersPanel onBack={vi.fn()} />);

    await user.click(await screen.findByLabelText('Monster actions'));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockRemoveAsync).toHaveBeenCalledWith('monster-1');
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });
});
