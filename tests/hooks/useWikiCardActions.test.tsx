import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWikiCardActions } from '~/hooks/useWikiCardActions';

const mockSearch = vi.fn();
const mockCampaign = vi.fn();
const mockPlayerState = vi.fn();
// Hoisted so individual tests can assert on what the push action dispatched.
const openWindowMutate = vi.fn();
const addPrivateWindowMutate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'c1' }),
  useSearch: () => mockSearch(),
}));
vi.mock('~/hooks/useCampaigns', () => ({ useCampaign: () => mockCampaign() }));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => mockPlayerState(),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  // screens[0] is deliberately NOT the active screen, so a test that expects
  // 'active' fails loudly if the old screens[0] targeting ever comes back.
  useTabletopScreenList: () => ({ screens: [{ id: 'first' }, { id: 'active' }] }),
  useTabletopMutations: () => ({ openWindow: { mutate: openWindowMutate, isPending: false } }),
}));

const keys = (items: { key: string }[]) => items.map((i) => i.key);

beforeEach(() => {
  vi.clearAllMocks();
  mockSearch.mockReturnValue({ tab: 'tabletop' });
  mockCampaign.mockReturnValue({ campaign: { isGM: true } });
  mockPlayerState.mockReturnValue({
    playerState: { activeScreenId: 'active', activeGMScreenId: 'gm1', privateWindows: [] },
    addPrivateWindow: { mutate: addPrivateWindowMutate },
    removePrivateWindow: { mutate: vi.fn() },
  });
});

describe('useWikiCardActions', () => {
  it('gives a GM on the Tabletop all four actions', () => {
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'character',
        documentId: 'd1',
        canEdit: true,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).toEqual(['edit', 'show-on-tab', 'push', 'delete']);
  });

  it('gives a player Show on Tab and Edit only when canEdit', () => {
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'character',
        documentId: 'd1',
        canEdit: true,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).toEqual(['edit', 'show-on-tab']);
  });

  it('never gives a player push or delete, even without canEdit', () => {
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1', canEdit: false })
    );
    expect(keys(result.current.menuItems)).toEqual(['show-on-tab']);
  });

  it('hides both display actions on the Dashboard', () => {
    mockSearch.mockReturnValue({ tab: 'dashboard' });
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'character',
        documentId: 'd1',
        canEdit: true,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).toEqual(['edit', 'delete']);
  });

  it('still offers Push to Tabletop from the GM Screens tab', () => {
    mockSearch.mockReturnValue({ tab: 'gmscreens' });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    expect(keys(result.current.menuItems)).toContain('push');
  });

  it('targets the ACTIVE screen, not screens[0]', () => {
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'push')!.onSelect();
    expect(openWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'active', collection: 'character', documentId: 'd1' })
    );
  });

  it('Show on Tab writes a private window for the current surface', () => {
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
    expect(addPrivateWindowMutate).toHaveBeenCalledWith({
      surface: 'tabletop',
      screenId: 'active',
      collection: 'character',
      documentId: 'd1',
    });
  });

  it('Show on Tab targets the GM screen when on the GM Screens tab', () => {
    mockSearch.mockReturnValue({ tab: 'gmscreens' });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
    expect(addPrivateWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'gmscreen', screenId: 'gm1' })
    );
  });

  it('does not add a duplicate private window when one already exists', () => {
    mockPlayerState.mockReturnValue({
      playerState: {
        activeScreenId: 'active',
        activeGMScreenId: 'gm1',
        privateWindows: [
          {
            id: 'pw1',
            surface: 'tabletop',
            screenId: 'active',
            collection: 'character',
            documentId: 'd1',
          },
        ],
      },
      addPrivateWindow: { mutate: addPrivateWindowMutate },
      removePrivateWindow: { mutate: vi.fn() },
    });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
    expect(addPrivateWindowMutate).not.toHaveBeenCalled();
  });

  it('returns no items when nothing qualifies', () => {
    mockSearch.mockReturnValue({ tab: 'dashboard' });
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1', canEdit: false })
    );
    expect(result.current.menuItems).toEqual([]);
  });
});
