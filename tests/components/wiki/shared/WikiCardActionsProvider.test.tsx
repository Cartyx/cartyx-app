import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  WikiCardActionsProvider,
  useWikiCardActionsContext,
} from '~/components/wiki/shared/WikiCardActionsProvider';

// Spy counts prove the provider subscribes to each source EXACTLY ONCE — the
// whole point of hoisting the fan-out out of the per-card hook.
const listSpy = vi.fn(() => ({ screens: [{ id: 'first' }, { id: 'active' }] }));
const gmListSpy = vi.fn(() => ({ screens: [{ id: 'gm-first' }, { id: 'gm1' }] }));
const mutationsSpy = vi.fn(() => ({ openWindow: { mutate: openWindowMutate, isPending: false } }));
const playerStateSpy = vi.fn(() => ({
  playerState: {
    activeScreenId: 'active',
    activeGMScreenId: 'gm1',
    privateWindows: [{ id: 'pw1', surface: 'tabletop', screenId: 'active' }],
  },
  addPrivateWindow: { mutate: addPrivateWindowMutate },
  removePrivateWindow: { mutate: vi.fn() },
}));
const tabletopDetailSpy = vi.fn(() => ({
  screen: { windows: [{ id: 'w1', collection: 'character', documentId: 'd1' }] },
}));
const gmDetailSpy = vi.fn(() => ({ screen: null }));
const openWindowMutate = vi.fn();
const addPrivateWindowMutate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'c1' }),
  useSearch: () => ({ tab: 'tabletop' }),
}));
vi.mock('~/hooks/useCampaigns', () => ({ useCampaign: () => ({ campaign: { isGM: true } }) }));
vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => playerStateSpy(),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => listSpy(),
  useTabletopScreenDetail: () => tabletopDetailSpy(),
  useTabletopMutations: () => mutationsSpy(),
}));
vi.mock('~/hooks/useGMScreens', () => ({
  useGMScreenList: () => gmListSpy(),
  useGMScreenDetail: () => gmDetailSpy(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WikiCardActionsProvider', () => {
  it('computes the shared value once and exposes the documented shape', () => {
    const { result } = renderHook(() => useWikiCardActionsContext(), {
      wrapper: WikiCardActionsProvider,
    });

    // Each underlying source is subscribed to exactly once for the whole subtree.
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(gmListSpy).toHaveBeenCalledTimes(1);
    expect(mutationsSpy).toHaveBeenCalledTimes(1);
    expect(playerStateSpy).toHaveBeenCalledTimes(1);

    const ctx = result.current;
    expect(ctx.campaignId).toBe('c1');
    expect(ctx.isGM).toBe(true);
    expect(ctx.surface).toBe('tabletop');
    // Existence-checked ids: the persisted active ids resolve since they exist.
    expect(ctx.tabletopScreenId).toBe('active');
    expect(ctx.gmScreenId).toBe('gm1');
    // Private windows come straight from player state.
    expect(ctx.privateWindows).toHaveLength(1);
    // Tabletop detail is fetched on the tabletop surface, so its shared windows
    // are exposed; the GM detail is not fetched here, so its list is empty.
    expect(ctx.tabletopSharedWindows).toEqual([
      { id: 'w1', collection: 'character', documentId: 'd1' },
    ]);
    expect(ctx.gmSharedWindows).toEqual([]);
    // Stable mutate references straight off the mutations.
    expect(ctx.openWindowMutate).toBe(openWindowMutate);
    expect(ctx.addPrivateWindowMutate).toBe(addPrivateWindowMutate);
    expect(typeof ctx.focusExistingWindow).toBe('function');
  });

  it('focusExistingWindow dispatches cartyx:focus-window tagged with the campaignId', () => {
    const { result } = renderHook(() => useWikiCardActionsContext(), {
      wrapper: WikiCardActionsProvider,
    });
    const focusSpy = vi.fn();
    window.addEventListener('cartyx:focus-window', focusSpy);
    try {
      result.current.focusExistingWindow('tabletop', 'character', 'd1');
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy.mock.calls[0][0].detail).toEqual({
        surface: 'tabletop',
        collection: 'character',
        documentId: 'd1',
        campaignId: 'c1',
      });
    } finally {
      window.removeEventListener('cartyx:focus-window', focusSpy);
    }
  });

  it('throws when the context hook is used without a provider', () => {
    // Silence React's expected error boundary logging for this throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useWikiCardActionsContext())).toThrow(
      /must be used within a WikiCardActionsProvider/
    );
    spy.mockRestore();
  });
});
