import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoreCard } from '~/components/wiki/lore/LoreCard';
import { WikiCardActionsTestWrapper } from '../../../support/renderWithWikiCardActions';

// setTokenDragImage uses document.createElement / document.body.appendChild
// and e.dataTransfer.setDragImage — stub it to avoid happy-dom canvas issues.
vi.mock('~/utils/setTokenDragImage', () => ({
  setTokenDragImage: vi.fn(),
}));

// The card now renders WikiCardMenu, whose useWikiCardActions reads the router
// and campaign/tabletop state. Stub that context so the card still renders
// standalone here (the menu itself is covered by useWikiCardActions.test.tsx).
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'c1' }),
  useSearch: () => ({ tab: 'wiki' }),
}));
vi.mock('~/hooks/useCampaigns', () => ({
  useCampaign: () => ({ campaign: { isGM: false } }),
}));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => ({
    playerState: null,
    addPrivateWindow: { mutate: vi.fn() },
  }),
}));
vi.mock('~/hooks/useGMScreens', () => ({
  useGMScreenDetail: () => ({ screen: null }),
  useGMScreenList: () => ({ screens: [] }),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenDetail: () => ({ screen: null }),
  useTabletopScreenList: () => ({ screens: [] }),
  useTabletopMutations: () => ({ openWindow: { mutate: vi.fn(), isPending: false } }),
}));

const lore = {
  id: 'l1',
  title: 'The Fall of Phandalin',
  isPublic: true,
  tags: [],
  images: [],
  links: [],
  campaignId: 'c1',
  createdBy: 'u1',
  content: '',
  createdAt: '',
  updatedAt: '',
  canEdit: true,
};

describe('LoreCard', () => {
  it('sets the drag payload with collection lore', () => {
    render(<LoreCard lore={lore as never} onClick={vi.fn()} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    const card = screen.getByTestId('lore-card');
    const setData = vi.fn();
    fireEvent.dragStart(card, {
      dataTransfer: { setData, setDragImage: vi.fn() } as never,
    });
    const payload = JSON.parse(
      setData.mock.calls.find((c) => c[0] === 'application/x-cartyx-document')![1]
    );
    expect(payload).toMatchObject({
      collection: 'lore',
      documentId: 'l1',
      title: 'The Fall of Phandalin',
    });
  });

  it('renders the title', () => {
    render(<LoreCard lore={lore as never} onClick={vi.fn()} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    expect(screen.getByText('The Fall of Phandalin')).toBeInTheDocument();
  });

  it('shows public icon when isPublic=true', () => {
    render(<LoreCard lore={lore as never} onClick={vi.fn()} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    expect(screen.getByLabelText('Public')).toBeInTheDocument();
  });

  it('shows private icon when isPublic=false', () => {
    render(<LoreCard lore={{ ...lore, isPublic: false } as never} onClick={vi.fn()} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    expect(screen.getByLabelText('Private')).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<LoreCard lore={lore as never} onClick={onClick} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    fireEvent.click(screen.getByTestId('lore-card'));
    expect(onClick).toHaveBeenCalledWith(lore);
  });

  it('fires onClick on Enter key', () => {
    const onClick = vi.fn();
    render(<LoreCard lore={lore as never} onClick={onClick} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    fireEvent.keyDown(screen.getByTestId('lore-card'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith(lore);
  });

  it('fires onClick on Space key', () => {
    const onClick = vi.fn();
    render(<LoreCard lore={lore as never} onClick={onClick} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    fireEvent.keyDown(screen.getByTestId('lore-card'), { key: ' ' });
    expect(onClick).toHaveBeenCalledWith(lore);
  });

  it('renders tags', () => {
    const loreWithTags = { ...lore, tags: ['history', 'magic'] };
    render(<LoreCard lore={loreWithTags as never} onClick={vi.fn()} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    expect(screen.getByText('#history')).toBeInTheDocument();
    expect(screen.getByText('#magic')).toBeInTheDocument();
  });

  // Regression: the overflow menu must close on Escape. When the menu was nested
  // inside the card's role="button" (wrapped in a div that stopPropagation'd
  // keydown), the wrapper stopped the native event at React's root container
  // before OverflowMenu's document-level Escape listener could see it, so Escape
  // was dead on every card menu. With the menu now a DOM sibling of the clickable
  // body (no stopPropagation wrapper), Escape reaches the document listener and
  // closes the menu.
  it('closes the overflow menu on Escape', () => {
    render(<LoreCard lore={lore as never} onClick={vi.fn()} onEdit={vi.fn()} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lore actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders link count when links are present', () => {
    const loreWithLinks = {
      ...lore,
      links: [
        { kind: 'character', id: 'c1', label: 'Hero' },
        { kind: 'location', id: 'loc1', label: 'Town' },
      ],
    };
    render(<LoreCard lore={loreWithLinks as never} onClick={vi.fn()} />, {
      wrapper: WikiCardActionsTestWrapper,
    });
    expect(screen.getByText('2 links')).toBeInTheDocument();
  });
});
