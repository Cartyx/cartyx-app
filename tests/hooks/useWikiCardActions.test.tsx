import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWikiCardActions } from '~/hooks/useWikiCardActions';

const mockSearch = vi.fn();
const mockCampaign = vi.fn();
const mockPlayerState = vi.fn();
// The screen-detail hooks expose each surface's SHARED window list. Tests set
// these to seed shared windows and prove cross-list dedup.
const mockTabletopDetail = vi.fn();
const mockGMDetail = vi.fn();
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
  useTabletopScreenDetail: () => mockTabletopDetail(),
  useTabletopMutations: () => ({ openWindow: { mutate: openWindowMutate, isPending: false } }),
}));
vi.mock('~/hooks/useGMScreens', () => ({
  // gm-first is the fallback; gm1 is the "active" GM screen the beforeEach pins.
  useGMScreenList: () => ({ screens: [{ id: 'gm-first' }, { id: 'gm1' }] }),
  useGMScreenDetail: () => mockGMDetail(),
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
  // Default: no shared windows on either surface.
  mockTabletopDetail.mockReturnValue({ screen: null });
  mockGMDetail.mockReturnValue({ screen: null });
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

  it('canDelete overrides the GM-only default: a non-GM creator gets Delete', () => {
    // Notes are creator-only for delete; a non-GM who created the item passes
    // canDelete: true and must see Delete even though isGM is false.
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'note',
        documentId: 'd1',
        canEdit: true,
        canDelete: true,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).toContain('delete');
    expect(keys(result.current.menuItems)).toContain('edit');
    // Push stays GM-only regardless.
    expect(keys(result.current.menuItems)).not.toContain('push');
  });

  it('canDelete: false hides Delete even for a GM', () => {
    // A GM viewing someone else's note: canDelete is false, so no Delete.
    mockCampaign.mockReturnValue({ campaign: { isGM: true } });
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'note',
        documentId: 'd1',
        canEdit: false,
        canDelete: false,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      })
    );
    expect(keys(result.current.menuItems)).not.toContain('delete');
    // But a GM can still push and show it.
    expect(keys(result.current.menuItems)).toContain('push');
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

  it('still offers Push to Tabletop from the GM Screens tab, and it targets the tabletop, not the GM screen', () => {
    mockSearch.mockReturnValue({ tab: 'gmscreens' });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    expect(keys(result.current.menuItems)).toContain('push');
    result.current.menuItems.find((i) => i.key === 'push')!.onSelect();
    expect(openWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'active', collection: 'character', documentId: 'd1' })
    );
    expect(openWindowMutate).not.toHaveBeenCalledWith(expect.objectContaining({ screenId: 'gm1' }));
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

  it('does add a private window when the existing one is for a different document', () => {
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
            // Same surface/screen/collection as the card below, but a
            // different documentId — this must NOT count as a match.
            documentId: 'some-other-doc',
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
    expect(addPrivateWindowMutate).toHaveBeenCalledWith({
      surface: 'tabletop',
      screenId: 'active',
      collection: 'character',
      documentId: 'd1',
    });
  });

  it('dispatches cartyx:focus-window instead of re-adding when a duplicate is suppressed', () => {
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
    const focusSpy = vi.fn();
    window.addEventListener('cartyx:focus-window', focusSpy);
    try {
      const { result } = renderHook(() =>
        useWikiCardActions({ collection: 'character', documentId: 'd1' })
      );
      result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy.mock.calls[0][0].detail).toEqual({
        surface: 'tabletop',
        collection: 'character',
        documentId: 'd1',
      });
    } finally {
      window.removeEventListener('cartyx:focus-window', focusSpy);
    }
  });

  // --- Cross-list dedup (private <-> shared) ---

  it('Push does NOT open a second window when the item is already a private window (the reported bug)', () => {
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
    const focusSpy = vi.fn();
    window.addEventListener('cartyx:focus-window', focusSpy);
    try {
      const { result } = renderHook(() =>
        useWikiCardActions({ collection: 'character', documentId: 'd1' })
      );
      result.current.menuItems.find((i) => i.key === 'push')!.onSelect();
      expect(openWindowMutate).not.toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy.mock.calls[0][0].detail).toEqual({
        surface: 'tabletop',
        collection: 'character',
        documentId: 'd1',
      });
    } finally {
      window.removeEventListener('cartyx:focus-window', focusSpy);
    }
  });

  it('Push does NOT open a second window when the item is already a shared window', () => {
    mockTabletopDetail.mockReturnValue({
      screen: { windows: [{ id: 'w1', collection: 'character', documentId: 'd1' }] },
    });
    const focusSpy = vi.fn();
    window.addEventListener('cartyx:focus-window', focusSpy);
    try {
      const { result } = renderHook(() =>
        useWikiCardActions({ collection: 'character', documentId: 'd1' })
      );
      result.current.menuItems.find((i) => i.key === 'push')!.onSelect();
      expect(openWindowMutate).not.toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('cartyx:focus-window', focusSpy);
    }
  });

  it('Push DOES open a window when nothing is already open (regression)', () => {
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'push')!.onSelect();
    expect(openWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'active', collection: 'character', documentId: 'd1' })
    );
  });

  it('Show on Tab does NOT add a private window when the item is already a shared window', () => {
    mockTabletopDetail.mockReturnValue({
      screen: { windows: [{ id: 'w1', collection: 'character', documentId: 'd1' }] },
    });
    const focusSpy = vi.fn();
    window.addEventListener('cartyx:focus-window', focusSpy);
    try {
      const { result } = renderHook(() =>
        useWikiCardActions({ collection: 'character', documentId: 'd1' })
      );
      result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
      expect(addPrivateWindowMutate).not.toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy.mock.calls[0][0].detail).toEqual({
        surface: 'tabletop',
        collection: 'character',
        documentId: 'd1',
      });
    } finally {
      window.removeEventListener('cartyx:focus-window', focusSpy);
    }
  });

  it('Show on Tab on GM Screens dedups against the GM screen SHARED windows', () => {
    mockSearch.mockReturnValue({ tab: 'gmscreens' });
    mockGMDetail.mockReturnValue({
      screen: { windows: [{ id: 'w1', collection: 'character', documentId: 'd1' }] },
    });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    result.current.menuItems.find((i) => i.key === 'show-on-tab')!.onSelect();
    expect(addPrivateWindowMutate).not.toHaveBeenCalled();
  });

  it('offers Push to Tabletop from the Dashboard when allowPushFromDashboard is set, but still hides Show on Tab', () => {
    mockSearch.mockReturnValue({ tab: 'dashboard' });
    const { result } = renderHook(() =>
      useWikiCardActions({
        collection: 'character',
        documentId: 'd1',
        allowPushFromDashboard: true,
      })
    );
    expect(keys(result.current.menuItems)).toEqual(['push']);
    result.current.menuItems.find((i) => i.key === 'push')!.onSelect();
    expect(openWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'active', collection: 'character', documentId: 'd1' })
    );
  });

  it('does not offer Push to Tabletop from the Dashboard without allowPushFromDashboard (default false)', () => {
    mockSearch.mockReturnValue({ tab: 'dashboard' });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    expect(keys(result.current.menuItems)).toEqual([]);
  });

  it('returns no items when nothing qualifies', () => {
    mockSearch.mockReturnValue({ tab: 'dashboard' });
    mockCampaign.mockReturnValue({ campaign: { isGM: false } });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1', canEdit: false })
    );
    expect(result.current.menuItems).toEqual([]);
  });

  // Regression: on a fresh campaign the view auto-selects its only screen
  // without persisting, so activeGMScreenId/activeScreenId is null on first
  // visit. Show on Tab must still be enabled, falling back to the first screen.
  it('Show on Tab on GM Screens falls back to the first GM screen when none is persisted', () => {
    mockSearch.mockReturnValue({ tab: 'gmscreens' });
    mockPlayerState.mockReturnValue({
      playerState: { activeScreenId: null, activeGMScreenId: null, privateWindows: [] },
      addPrivateWindow: { mutate: addPrivateWindowMutate },
      removePrivateWindow: { mutate: vi.fn() },
    });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    const item = result.current.menuItems.find((i) => i.key === 'show-on-tab');
    expect(item?.disabled).toBeFalsy();
    item!.onSelect();
    expect(addPrivateWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'gmscreen', screenId: 'gm-first' })
    );
  });

  it('Show on Tab on the Tabletop falls back to the first screen when none is persisted', () => {
    mockSearch.mockReturnValue({ tab: 'tabletop' });
    mockPlayerState.mockReturnValue({
      playerState: { activeScreenId: null, activeGMScreenId: null, privateWindows: [] },
      addPrivateWindow: { mutate: addPrivateWindowMutate },
      removePrivateWindow: { mutate: vi.fn() },
    });
    const { result } = renderHook(() =>
      useWikiCardActions({ collection: 'character', documentId: 'd1' })
    );
    const item = result.current.menuItems.find((i) => i.key === 'show-on-tab');
    expect(item?.disabled).toBeFalsy();
    item!.onSelect();
    expect(addPrivateWindowMutate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'tabletop', screenId: 'first' })
    );
  });
});
