import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GMScreenData, GMScreenDetailData } from '~/types/gmscreen';
import type { HydratedDocument, PrivateWindowData } from '~/types/tabletop';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockScreens: GMScreenData[] = [
  {
    id: 'scr-a',
    campaignId: 'c1',
    name: 'Alpha',
    tabOrder: 0,
    createdBy: 'u1',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'scr-b',
    campaignId: 'c1',
    name: 'Bravo',
    tabOrder: 1,
    createdBy: 'u1',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'scr-c',
    campaignId: 'c1',
    name: 'Charlie',
    tabOrder: 2,
    createdBy: 'u1',
    createdAt: '',
    updatedAt: '',
  },
];

const mockScreensCampaign2: GMScreenData[] = [
  {
    id: 'scr-x',
    campaignId: 'c2',
    name: 'Xray',
    tabOrder: 0,
    createdBy: 'u2',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'scr-y',
    campaignId: 'c2',
    name: 'Yankee',
    tabOrder: 1,
    createdBy: 'u2',
    createdAt: '',
    updatedAt: '',
  },
];

const mockDetail: GMScreenDetailData = {
  ...mockScreens[0]!,
  windows: [],
  stacks: [],
  hydrated: {},
};

const mockInvalidateList = vi.fn();
const mockInvalidateDetail = vi.fn();
const noopMutation = {
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
  error: null as Error | null,
};

let listResult: { screens: GMScreenData[]; isLoading: boolean; error: string | null } = {
  screens: mockScreens,
  isLoading: false,
  error: null,
};
let detailResult: { screen: GMScreenDetailData | null; isLoading: boolean; error: string | null } =
  { screen: mockDetail, isLoading: false, error: null };

vi.mock('~/hooks/useGMScreens', () => ({
  useGMScreenList: () => listResult,
  useGMScreenDetail: (_cid: string, _sid: string | null) => detailResult,
  useGMScreenMutations: () => ({
    createScreen: { ...noopMutation },
    renameScreen: { ...noopMutation },
    deleteScreen: { ...noopMutation },
    reorderScreens: { ...noopMutation },
    openWindow: { ...noopMutation },
    updateWindow: { ...noopMutation },
    closeWindow: { ...noopMutation },
    createStack: { ...noopMutation },
    renameStack: { ...noopMutation },
    moveStack: { ...noopMutation },
    deleteStack: { ...noopMutation },
    addStackItem: { ...noopMutation },
    removeStackItem: { ...noopMutation },
    invalidateList: mockInvalidateList,
    invalidateDetail: mockInvalidateDetail,
  }),
}));

// Mock useTabletopPlayerState so tests control playerState/updateState
// directly instead of exercising the real hook's RPC against a live
// QueryClient (which fails in jsdom and only "works" because retry:false
// settles the query to an error quickly — an incidental pass, not a real one).
const mockUpdateStateMutate = vi.fn();
const mockRemovePrivateWindowMutate = vi.fn();
const mockUpdatePrivateWindowMutate = vi.fn();

type MockPlayerState = {
  activeGMScreenId: string | null;
  privateWindows?: PrivateWindowData[];
  hydrated?: Record<string, HydratedDocument>;
};

let playerStateResult: {
  playerState: MockPlayerState | null;
  isLoading: boolean;
  updateState: { mutate: typeof mockUpdateStateMutate };
  removePrivateWindow: { mutate: typeof mockRemovePrivateWindowMutate };
  updatePrivateWindow: { mutate: typeof mockUpdatePrivateWindowMutate };
} = {
  playerState: null,
  isLoading: false,
  updateState: { mutate: mockUpdateStateMutate },
  removePrivateWindow: { mutate: mockRemovePrivateWindowMutate },
  updatePrivateWindow: { mutate: mockUpdatePrivateWindowMutate },
};

function makePlayerState(overrides: Partial<MockPlayerState> = {}): typeof playerStateResult {
  return {
    playerState: { activeGMScreenId: null, ...overrides },
    isLoading: false,
    updateState: { mutate: mockUpdateStateMutate },
    removePrivateWindow: { mutate: mockRemovePrivateWindowMutate },
    updatePrivateWindow: { mutate: mockUpdatePrivateWindowMutate },
  };
}

vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: (_campaignId: string) => playerStateResult,
}));

// Stands in for the real manager: renders each window and exposes a close
// button that calls onWindowsChange with the window removed — exactly what the
// real FloatingWindowManager.handleClose does.
type MockWindow = { id: string; title: string; className?: string };
vi.mock('~/components/mainview/FloatingWindowManager', () => ({
  FloatingWindowManager: ({
    windows,
    onWindowsChange,
  }: {
    windows: MockWindow[];
    onWindowsChange: (next: MockWindow[]) => void;
  }) => (
    <div data-testid="floating-window-manager">
      {windows.map((w) => (
        <div key={w.id} data-testid={`fwm-window-${w.id}`} className={w.className}>
          {w.title}
          <button
            data-testid={`fwm-close-${w.id}`}
            onClick={() => onWindowsChange(windows.filter((x) => x.id !== w.id))}
          >
            close
          </button>
        </div>
      ))}
    </div>
  ),
}));

// Lazy import after mocks are set up
import { GMScreensView } from '~/components/mainview/gmscreens/GMScreensView';

function Wrapper({ children }: { children: React.ReactNode }) {
  const [testQueryClient] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GMScreensView — screen selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listResult = { screens: mockScreens, isLoading: false, error: null };
    detailResult = { screen: mockDetail, isLoading: false, error: null };
    playerStateResult = { ...makePlayerState(), playerState: null };
  });

  it('auto-selects the first screen by tab order on mount', async () => {
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      const tab = screen.getByTestId('screen-tab-scr-a');
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('does NOT re-run selection when screen order changes but set stays the same', async () => {
    const { rerender } = render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    // First render — selects scr-a
    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });

    // Simulate clicking scr-b
    act(() => {
      screen.getByTestId('screen-tab-scr-b').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-b')).toHaveAttribute('aria-selected', 'true');
    });

    // Screens re-arrive in a different order but same set — selection should stay on scr-b
    listResult = {
      screens: [mockScreens[2]!, mockScreens[0]!, mockScreens[1]!],
      isLoading: false,
      error: null,
    };
    rerender(<GMScreensView campaignId="c1" />);

    // scr-b should remain active (sorted key unchanged → effect doesn't fire)
    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-b')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('falls back to first screen when active screen is removed from the set', async () => {
    const { rerender } = render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    // Select scr-b
    act(() => {
      screen.getByTestId('screen-tab-scr-b').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-b')).toHaveAttribute('aria-selected', 'true');
    });

    // Remove scr-b from the list
    listResult = {
      screens: [mockScreens[0]!, mockScreens[2]!],
      isLoading: false,
      error: null,
    };
    rerender(<GMScreensView campaignId="c1" />);

    // Should fall back to the first screen (scr-a)
    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('clears selection when all screens are removed', async () => {
    const { rerender } = render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });

    listResult = { screens: [], isLoading: false, error: null };
    rerender(<GMScreensView campaignId="c1" />);

    await waitFor(() => {
      expect(screen.queryByTestId('screen-tab-scr-a')).not.toBeInTheDocument();
    });
  });

  it('shows loading state while list is loading', () => {
    listResult = { screens: [], isLoading: true, error: null };
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    expect(screen.getByTestId('gmscreens-loading')).toBeInTheDocument();
  });

  it('shows error state on list error', () => {
    listResult = { screens: [], isLoading: false, error: 'Failed to load' };
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    expect(screen.getByTestId('gmscreens-error')).toBeInTheDocument();
  });
});

describe('GMScreensView — active screen persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listResult = { screens: mockScreens, isLoading: false, error: null };
    detailResult = { screen: mockDetail, isLoading: false, error: null };
    playerStateResult = { ...makePlayerState(), playerState: null };
  });

  it('falls back to the first screen on first visit (activeGMScreenId is null)', async () => {
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('restores the persisted screen from player state', async () => {
    playerStateResult = makePlayerState({ activeGMScreenId: 'scr-c' });

    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-c')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('restores the persisted screen even when player state arrives after screens resolve (race)', async () => {
    // Screens are already resolved (listLoading: false) but player state is
    // still loading — the seeding effect must wait rather than flashing
    // screens[0] before the persisted value is known.
    playerStateResult = { ...makePlayerState(), playerState: null, isLoading: true };

    const { rerender } = render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'false');
    });
    expect(screen.getByTestId('screen-tab-scr-c')).toHaveAttribute('aria-selected', 'false');

    // Player state now resolves with a persisted screen, after the screen list settled.
    playerStateResult = makePlayerState({ activeGMScreenId: 'scr-c' });
    rerender(<GMScreensView campaignId="c1" />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-c')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('falls back to the first screen when the persisted screen was deleted', async () => {
    playerStateResult = makePlayerState({ activeGMScreenId: 'scr-deleted' });

    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('clicking a tab flips local selection instantly and persists fire-and-forget', async () => {
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });

    act(() => {
      screen.getByTestId('screen-tab-scr-b').click();
    });

    // Local state flips synchronously — the click handler never awaits a round-trip.
    expect(screen.getByTestId('screen-tab-scr-b')).toHaveAttribute('aria-selected', 'true');

    // The persist call is fire-and-forget: mutate (not mutateAsync) is invoked
    // with the new screen id.
    expect(mockUpdateStateMutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateStateMutate).toHaveBeenCalledWith({ activeGMScreenId: 'scr-b' });
  });

  it('does not re-seed or loop when the persist round-trip resolves', async () => {
    const { rerender } = render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });

    act(() => {
      screen.getByTestId('screen-tab-scr-b').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-b')).toHaveAttribute('aria-selected', 'true');
    });
    expect(mockUpdateStateMutate).toHaveBeenCalledTimes(1);

    // Simulate the persisted value round-tripping back from the server after
    // the mutation's onSuccess invalidation. The screen set hasn't changed,
    // so the seeding effect must not re-fire, re-select, or re-persist.
    playerStateResult = makePlayerState({ activeGMScreenId: 'scr-b' });
    rerender(<GMScreensView campaignId="c1" />);

    expect(screen.getByTestId('screen-tab-scr-b')).toHaveAttribute('aria-selected', 'true');
    expect(mockUpdateStateMutate).toHaveBeenCalledTimes(1);
  });
});

describe('GMScreensView — campaign switching without remount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listResult = { screens: mockScreens, isLoading: false, error: null };
    detailResult = { screen: mockDetail, isLoading: false, error: null };
    playerStateResult = { ...makePlayerState(), playerState: null };
  });

  it("restores campaign B's own persisted screen after switching from campaign A in place", async () => {
    // GMScreensView is not keyed at play.tsx:216 and TanStack Router v1
    // doesn't remount on a path-param change, so the component instance
    // (and its refs, including hasSeededRef) survives a campaign switch.
    const { rerender } = render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });

    // Switch to campaign B in place — new screens, new persisted selection.
    listResult = { screens: mockScreensCampaign2, isLoading: false, error: null };
    playerStateResult = makePlayerState({ activeGMScreenId: 'scr-y' });
    rerender(<GMScreensView campaignId="c2" />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-y')).toHaveAttribute('aria-selected', 'true');
    });
  });
});

// ---------------------------------------------------------------------------
// Private windows — owner-only, invisible to co-GMs
// ---------------------------------------------------------------------------

describe('GMScreensView — private windows', () => {
  function makePrivateWindow(overrides: Partial<PrivateWindowData> = {}): PrivateWindowData {
    return {
      id: 'pw-1',
      surface: 'gmscreen',
      screenId: 'scr-a',
      collection: 'lore',
      documentId: 'doc-1',
      x: 10,
      y: 20,
      width: null,
      height: null,
      zIndex: 1,
      state: 'open',
      ...overrides,
    };
  }

  const privateHydration: Record<string, HydratedDocument> = {
    'lore:doc-1': {
      id: 'doc-1',
      collection: 'lore',
      title: 'The Sunken Crown',
      content: 'secret lore',
    },
  };

  function withPrivateWindows(windows: PrivateWindowData[]) {
    playerStateResult = makePlayerState({
      activeGMScreenId: 'scr-a',
      privateWindows: windows,
      hydrated: privateHydration,
    });
  }

  const sharedWindow = {
    id: 'w-shared',
    collection: 'lore' as const,
    documentId: 'doc-shared',
    state: 'open' as const,
    x: 0,
    y: 0,
    width: null,
    height: null,
    zIndex: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listResult = { screens: mockScreens, isLoading: false, error: null };
    detailResult = { screen: mockDetail, isLoading: false, error: null };
    playerStateResult = { ...makePlayerState(), playerState: null };
  });

  it("renders the caller's private window, titled from player-state hydration", async () => {
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());
    // A missing hydration source would fall back to the literal key "lore:doc-1".
    expect(screen.getByTestId('fwm-window-pw-1')).toHaveTextContent('The Sunken Crown');
  });

  it('does not render private windows for another screen or the tabletop surface', async () => {
    withPrivateWindows([
      makePrivateWindow({ id: 'pw-other-screen', screenId: 'scr-b' }),
      makePrivateWindow({ id: 'pw-tabletop', surface: 'tabletop' }),
    ]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByTestId('floating-window-manager')).toBeInTheDocument());
    expect(screen.queryByTestId('fwm-window-pw-other-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fwm-window-pw-tabletop')).not.toBeInTheDocument();
  });

  it('closing a private window calls removePrivateWindow and never closeWindow', async () => {
    // closeWindow removes the SHARED window from GMScreen.windows — routing a
    // private close there would delete another GM's window for everyone.
    const user = userEvent.setup();
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByTestId('fwm-close-pw-1')).toBeInTheDocument());
    await user.click(screen.getByTestId('fwm-close-pw-1'));

    expect(mockRemovePrivateWindowMutate).toHaveBeenCalledWith({ privateWindowId: 'pw-1' });
    expect(noopMutation.mutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 'pw-1' })
    );
  });

  it('closing a shared window still calls closeWindow and not removePrivateWindow', async () => {
    const user = userEvent.setup();
    detailResult = {
      screen: {
        ...mockDetail,
        windows: [sharedWindow],
        hydrated: {
          'lore:doc-shared': {
            id: 'doc-shared',
            collection: 'lore',
            title: 'Shared Lore',
            content: '',
          },
        },
      },
      isLoading: false,
      error: null,
    };
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByTestId('fwm-close-w-shared')).toBeInTheDocument());
    await user.click(screen.getByTestId('fwm-close-w-shared'));

    expect(noopMutation.mutate).toHaveBeenCalledWith({ screenId: 'scr-a', windowId: 'w-shared' });
    expect(mockRemovePrivateWindowMutate).not.toHaveBeenCalled();
  });

  it('suppresses a private window duplicated by a shared one, without deleting it', async () => {
    // A co-GM can open an item this viewer already showed themselves — the
    // client's isAlreadyOpen check only prevents the reverse order — and both
    // would otherwise render as two identical windows.
    //
    // The dangerous part is the close path: a suppressed window is never
    // rendered, so it is never in `nextWindows`. Close-detection reading the
    // UNFILTERED private list would treat it as closed and destroy it the
    // moment the shared window is closed. The row must survive so the private
    // window reappears afterwards.
    const user = userEvent.setup();
    detailResult = {
      screen: {
        ...mockDetail,
        // Same collection+documentId as makePrivateWindow().
        windows: [{ ...sharedWindow, documentId: 'doc-1' }],
        hydrated: {
          'lore:doc-1': { id: 'doc-1', collection: 'lore', title: 'Shared Lore', content: '' },
        },
      },
      isLoading: false,
      error: null,
    };
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByTestId('fwm-close-w-shared')).toBeInTheDocument());
    expect(screen.queryByTestId('fwm-window-pw-1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('fwm-close-w-shared'));

    expect(mockRemovePrivateWindowMutate).not.toHaveBeenCalled();
  });

  it('flashes a matching private window on a cartyx:focus-window event', async () => {
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

    await waitFor(() => {
      window.dispatchEvent(
        new CustomEvent('cartyx:focus-window', {
          detail: {
            campaignId: 'c1',
            surface: 'gmscreen',
            collection: 'lore',
            documentId: 'doc-1',
          },
        })
      );
      expect(screen.getByTestId('fwm-window-pw-1')).toHaveClass('animate-flash-border');
    });
  });

  it('ignores focus events aimed at the tabletop surface', async () => {
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

    // Asserted SYNCHRONOUSLY after the dispatch, not inside waitFor: the flash
    // self-clears after 700ms, so a retrying waitFor would go green even if the
    // guard were removed and the window really did flash.
    act(() => {
      window.dispatchEvent(
        new CustomEvent('cartyx:focus-window', {
          detail: { surface: 'tabletop', collection: 'lore', documentId: 'doc-1' },
        })
      );
    });

    expect(screen.getByTestId('fwm-window-pw-1')).not.toHaveClass('animate-flash-border');
  });

  it('ignores focus events whose campaignId does not match this view', async () => {
    // Defense against a stale/cross-campaign event: surface matches but the
    // campaignId does not, so the window must NOT flash. Asserted synchronously
    // (the flash self-clears after 700ms — a retrying waitFor would go green
    // even with the guard removed).
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('cartyx:focus-window', {
          detail: {
            campaignId: 'other-campaign',
            surface: 'gmscreen',
            collection: 'lore',
            documentId: 'doc-1',
          },
        })
      );
    });

    expect(screen.getByTestId('fwm-window-pw-1')).not.toHaveClass('animate-flash-border');
  });

  it('focusing a private window never persists it through the GM-screens updateWindow', async () => {
    // updateWindow addresses GMScreen.windows by id; a private window is not in
    // that array, so the mutation would be a no-op at best.
    withPrivateWindows([makePrivateWindow()]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

    window.dispatchEvent(
      new CustomEvent('cartyx:focus-window', {
        detail: { campaignId: 'c1', surface: 'gmscreen', collection: 'lore', documentId: 'doc-1' },
      })
    );

    await waitFor(() =>
      expect(screen.getByTestId('fwm-window-pw-1')).toHaveClass('animate-flash-border')
    );
    expect(noopMutation.mutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 'pw-1' })
    );
  });

  it('focusing a SHARED window still persists its z-index through updateWindow', async () => {
    detailResult = {
      screen: {
        ...mockDetail,
        windows: [sharedWindow],
        hydrated: {
          'lore:doc-shared': {
            id: 'doc-shared',
            collection: 'lore',
            title: 'Shared Lore',
            content: '',
          },
        },
      },
      isLoading: false,
      error: null,
    };
    withPrivateWindows([makePrivateWindow({ zIndex: 7 })]);
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('fwm-window-w-shared')).toBeInTheDocument());

    window.dispatchEvent(
      new CustomEvent('cartyx:focus-window', {
        detail: {
          campaignId: 'c1',
          surface: 'gmscreen',
          collection: 'lore',
          documentId: 'doc-shared',
        },
      })
    );

    // Raised above the private window at z=7, not just above the shared set.
    await waitFor(() =>
      expect(noopMutation.mutate).toHaveBeenCalledWith({
        screenId: 'scr-a',
        windowId: 'w-shared',
        zIndex: 8,
        state: 'open',
      })
    );
  });
});

describe('GMScreensView — flash lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listResult = { screens: mockScreens, isLoading: false, error: null };
    detailResult = { screen: mockDetail, isLoading: false, error: null };
    playerStateResult = { ...makePlayerState(), playerState: null };
  });

  // Regression: the 700ms flash timer used to be cleared inside the
  // flush-on-unmount effect, whose deps are [mutations] — a fresh object every
  // render. That cleanup ran on EVERY render, so the timer set by
  // setFlashWindowId was killed by the very re-render it caused and the flash
  // class stuck forever. Covers the drop-handler flash too, not just this path.
  it('clears the flash class after 700ms instead of leaving it stuck on', async () => {
    playerStateResult = makePlayerState({
      activeGMScreenId: 'scr-a',
      privateWindows: [
        {
          id: 'pw-1',
          surface: 'gmscreen',
          screenId: 'scr-a',
          collection: 'lore',
          documentId: 'doc-1',
          x: 1,
          y: 1,
          width: null,
          height: null,
          zIndex: 1,
          state: 'open',
        },
      ],
      hydrated: { 'lore:doc-1': { id: 'doc-1', collection: 'lore', title: 'T', content: '' } },
    });
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

    await waitFor(() => {
      window.dispatchEvent(
        new CustomEvent('cartyx:focus-window', {
          detail: {
            campaignId: 'c1',
            surface: 'gmscreen',
            collection: 'lore',
            documentId: 'doc-1',
          },
        })
      );
      expect(screen.getByTestId('fwm-window-pw-1')).toHaveClass('animate-flash-border');
    });

    await waitFor(
      () => expect(screen.getByTestId('fwm-window-pw-1')).not.toHaveClass('animate-flash-border'),
      { timeout: 2000 }
    );
  });
});
