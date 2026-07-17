import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LorePanel } from '~/components/wiki/lore/LorePanel';
import { useLore } from '~/hooks/useLore';
import { useCampaign } from '~/hooks/useCampaigns';

// Stub the modal components to avoid portal / query-client complexity.
vi.mock('~/components/wiki/lore/LoreModal', () => ({
  LoreModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="lore-modal" /> : null,
}));
vi.mock('~/components/wiki/lore/LoreViewModal', () => ({
  LoreViewModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="lore-view-modal" /> : null,
}));

vi.mock('~/hooks/useLore');
vi.mock('~/hooks/useCampaigns');
vi.mock('~/hooks/useTags', () => ({
  useTags: () => ({ tags: [], isLoading: false, error: null }),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => ({ screens: [], isLoading: false, error: null }),
  useTabletopMutations: () => ({
    openWindow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'campaign-123' }),
  // LoreCard's WikiCardMenu reads the main-view tab via useSearch.
  useSearch: () => ({ tab: 'wiki' }),
}));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => ({
    playerState: null,
    addPrivateWindow: { mutate: vi.fn() },
  }),
}));
// Stub setTokenDragImage used by LoreCard
vi.mock('~/utils/setTokenDragImage', () => ({
  setTokenDragImage: vi.fn(),
}));

const mockLore = [
  {
    id: 'lore-1',
    campaignId: 'campaign-123',
    title: 'The Ancient Prophecy',
    tags: ['prophecy', 'magic'],
    isPublic: true,
    images: [],
    links: [],
    createdBy: 'user-1',
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canEdit: true,
  },
];

function setupMocks(overrides: { isGM?: boolean; lore?: typeof mockLore } = {}) {
  const { isGM = true, lore = mockLore } = overrides;
  (useCampaign as ReturnType<typeof vi.fn>).mockReturnValue({
    campaign: { isGM, sessions: [] },
    isLoading: false,
    error: null,
  });
  (useLore as ReturnType<typeof vi.fn>).mockReturnValue({
    lore,
    isLoading: false,
    error: null,
  });
}

describe('LorePanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the "Lore" header', () => {
    setupMocks();
    render(<LorePanel onBack={vi.fn()} />);
    expect(screen.getByText('Lore')).toBeInTheDocument();
  });

  it('shows the create button for GM', () => {
    setupMocks({ isGM: true });
    render(<LorePanel onBack={vi.fn()} />);
    expect(screen.getByTestId('lore-create-button')).toBeInTheDocument();
  });

  it('shows the create button for non-GM members', () => {
    setupMocks({ isGM: false });
    render(<LorePanel onBack={vi.fn()} />);
    expect(screen.getByTestId('lore-create-button')).toBeInTheDocument();
  });

  it('renders a lore card for each item', async () => {
    setupMocks();
    render(<LorePanel onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('The Ancient Prophecy')).toBeInTheDocument();
    });
  });

  it('GM clicking create button opens LoreModal', async () => {
    setupMocks({ isGM: true });
    const user = userEvent.setup();
    render(<LorePanel onBack={vi.fn()} />);
    await user.click(screen.getByTestId('lore-create-button'));
    expect(screen.getByRole('dialog', { name: 'lore-modal' })).toBeInTheDocument();
  });

  it('clicking a canEdit lore card opens LoreModal (edit)', async () => {
    setupMocks({ isGM: true });
    const user = userEvent.setup();
    render(<LorePanel onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('The Ancient Prophecy')).toBeInTheDocument();
    });
    await user.click(screen.getByText('The Ancient Prophecy'));
    expect(screen.getByRole('dialog', { name: 'lore-modal' })).toBeInTheDocument();
  });

  it('non-GM clicking a canEdit lore card opens LoreModal (edit)', async () => {
    setupMocks({ isGM: false, lore: [{ ...mockLore[0]!, canEdit: true }] });
    const user = userEvent.setup();
    render(<LorePanel onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('The Ancient Prophecy')).toBeInTheDocument();
    });
    await user.click(screen.getByText('The Ancient Prophecy'));
    expect(screen.getByRole('dialog', { name: 'lore-modal' })).toBeInTheDocument();
  });

  it('clicking a non-editable lore card opens LoreViewModal', async () => {
    setupMocks({
      isGM: false,
      lore: [{ ...mockLore[0]!, canEdit: false }],
    });
    const user = userEvent.setup();
    render(<LorePanel onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('The Ancient Prophecy')).toBeInTheDocument();
    });
    await user.click(screen.getByText('The Ancient Prophecy'));
    expect(screen.getByRole('dialog', { name: 'lore-view-modal' })).toBeInTheDocument();
  });

  it('shows loading state', () => {
    setupMocks();
    (useLore as ReturnType<typeof vi.fn>).mockReturnValue({
      lore: [],
      isLoading: true,
      error: null,
    });
    render(<LorePanel onBack={vi.fn()} />);
    expect(screen.getByText('Loading lore...')).toBeInTheDocument();
  });

  it('shows empty state when no lore found', () => {
    setupMocks({ lore: [] });
    render(<LorePanel onBack={vi.fn()} />);
    expect(screen.getByText('No lore found matching your filters.')).toBeInTheDocument();
  });

  it('shows error state', () => {
    setupMocks();
    (useLore as ReturnType<typeof vi.fn>).mockReturnValue({
      lore: [],
      isLoading: false,
      error: 'Failed to fetch lore',
    });
    render(<LorePanel onBack={vi.fn()} />);
    expect(screen.getByText('Failed to fetch lore')).toBeInTheDocument();
  });

  it('calls onBack when header back button is clicked', async () => {
    setupMocks();
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<LorePanel onBack={onBack} />);
    await user.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });
});
