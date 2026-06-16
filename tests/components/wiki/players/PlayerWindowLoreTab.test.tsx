import React, { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlayerLoreTab } from '~/components/wiki/players/PlayerLoreTab';
import type { LoreListItem } from '~/types/lore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRemove = vi.fn();

vi.mock('~/hooks/useLore', () => ({
  useLinkedLore: () => ({
    lore: [
      {
        id: 'l1',
        title: 'Oath of the Dawn',
        isPublic: true,
        tags: [],
        images: [],
        links: [],
        campaignId: 'c1',
        createdBy: 'u1',
        content: '',
        createdAt: '',
        updatedAt: '',
        canEdit: false,
      } satisfies LoreListItem,
    ],
    isLoading: false,
    error: null,
  }),
  useDeleteLore: () => ({ remove: mockRemove, isLoading: false, error: null }),
}));

// Stub heavy modals to avoid query-client / portal complexity
vi.mock('~/components/wiki/lore/LoreModal', () => ({
  LoreModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="lore-modal-stub" /> : null,
}));

vi.mock('~/components/wiki/lore/LoreViewModal', () => ({
  LoreViewModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="lore-view-modal-stub" /> : null,
}));

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

function Wrapper({ children }: { children: ReactNode }) {
  const [queryClient] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function customRender(ui: React.ReactNode) {
  return render(ui, { wrapper: Wrapper });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlayerLoreTab', () => {
  const baseProps = {
    campaignId: 'c1',
    playerId: 'p1',
    canManage: false,
  };

  it('renders the linked lore title', () => {
    customRender(<PlayerLoreTab {...baseProps} />);
    expect(screen.getByText('Oath of the Dawn')).toBeInTheDocument();
  });

  it('does not show Add lore button when canManage is false', () => {
    customRender(<PlayerLoreTab {...baseProps} />);
    expect(screen.queryByText(/add lore/i)).not.toBeInTheDocument();
  });

  it('shows Add lore button when canManage is true', () => {
    customRender(<PlayerLoreTab {...baseProps} canManage />);
    expect(screen.getByText(/add lore/i)).toBeInTheDocument();
  });

  it('opens LoreModal stub when Add lore is clicked', async () => {
    const user = userEvent.setup();
    customRender(<PlayerLoreTab {...baseProps} canManage />);
    await user.click(screen.getByText(/add lore/i));
    expect(screen.getByTestId('lore-modal-stub')).toBeInTheDocument();
  });

  it('opens LoreViewModal stub when a lore entry is clicked', async () => {
    const user = userEvent.setup();
    customRender(<PlayerLoreTab {...baseProps} />);
    await user.click(screen.getByText('Oath of the Dawn'));
    expect(screen.getByTestId('lore-view-modal-stub')).toBeInTheDocument();
  });
});
