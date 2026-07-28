import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  PrivateWindowData,
  TabletopPlayerStateData,
  TabletopScreenData,
  TabletopScreenDetailData,
} from '~/types/tabletop';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockScreens: TabletopScreenData[] = [
  {
    id: 'ts-1',
    campaignId: 'c1',
    name: 'Main',
    tabOrder: 0,
    mode: 'grid',
    gridStyle: 'dark',
    gridSize: 50,
    gridVisible: true,
    gridScale: 1,
    createdBy: 'u1',
    createdAt: '',
    updatedAt: '',
  },
];

const mockDetail: TabletopScreenDetailData = {
  ...mockScreens[0]!,
  windows: [],
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

// Dedicated mocks so createScreen and updateState can be asserted independently
// (the shared noopMutation reuses the same vi.fn across mutations).
const mockCreateScreenAsync = vi.fn().mockResolvedValue({});
const mockUpdateStateMutate = vi.fn();
const mockCloseWindowMutate = vi.fn();
const mockRemovePrivateWindowMutate = vi.fn();
const mockUpdatePrivateWindowMutate = vi.fn();

let playerStateResult: TabletopPlayerStateData | null = null;

let listResult: { screens: TabletopScreenData[]; isLoading: boolean; error: string | null } = {
  screens: mockScreens,
  isLoading: false,
  error: null,
};

let detailResult: {
  screen: TabletopScreenDetailData | null;
  isLoading: boolean;
  error: string | null;
} = { screen: mockDetail, isLoading: false, error: null };

vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => listResult,
  useTabletopScreenDetail: () => detailResult,
  useTabletopMutations: () => ({
    createScreen: { ...noopMutation, mutateAsync: mockCreateScreenAsync },
    renameScreen: { ...noopMutation },
    deleteScreen: { ...noopMutation },
    updateSettings: { ...noopMutation },
    openWindow: { ...noopMutation },
    closeWindow: { ...noopMutation, mutate: mockCloseWindowMutate },
    invalidateList: mockInvalidateList,
    invalidateDetail: mockInvalidateDetail,
  }),
}));

vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => ({
    playerState: playerStateResult,
    isLoading: false,
    updateState: { ...noopMutation, mutate: mockUpdateStateMutate },
    addPrivateWindow: { ...noopMutation },
    removePrivateWindow: { ...noopMutation, mutate: mockRemovePrivateWindowMutate },
    updatePrivateWindow: { ...noopMutation, mutate: mockUpdatePrivateWindowMutate },
  }),
}));

const mockSend = vi.fn();
vi.mock('~/hooks/useTabletopParty', () => ({
  useTabletopParty: () => ({ socket: null, send: mockSend }),
}));

// Stub canvas-dependent components to avoid Konva/canvas issues in jsdom
vi.mock('~/components/mainview/tabletop/TabletopCanvas', () => ({
  TabletopCanvas: () => <div data-testid="tabletop-canvas" />,
}));

// Stands in for the real manager: renders each window and exposes a close
// button that calls onWindowsChange with the window removed — exactly what the
// real FloatingWindowManager.handleClose does.
type MockWindow = {
  id: string;
  title: string;
  className?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  state?: string;
  zIndex?: number;
};
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
          {/* Mirrors handleLayoutChange: the real manager re-emits the WHOLE
              list on any drag/resize, including windows that did not move. */}
          <button
            data-testid={`fwm-move-${w.id}`}
            onClick={() =>
              onWindowsChange(
                windows.map((x) => (x.id === w.id ? { ...x, position: { x: 999, y: 888 } } : x))
              )
            }
          >
            move
          </button>
        </div>
      ))}
    </div>
  ),
}));

// Lazy import after mocks are set up
import { TabletopView } from '~/components/mainview/tabletop/TabletopView';

const mockGetToken = vi.fn().mockResolvedValue('test-token');

function Wrapper({ children }: { children: React.ReactNode }) {
  const [testQueryClient] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TabletopView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listResult = { screens: mockScreens, isLoading: false, error: null };
    detailResult = { screen: mockDetail, isLoading: false, error: null };
    playerStateResult = null;
    mockCreateScreenAsync.mockResolvedValue({});
  });

  it('persists the newly auto-created default tab as the active screen', async () => {
    // Fresh GM with no tabs: the auto-create effect creates a "Default" tab.
    // The new tab must be persisted to player-state (activeScreenId), not just
    // held in local state — otherwise the Maps panel targets the wrong/no tab
    // and activating a map appears to do nothing until the tab is clicked.
    listResult = { screens: [], isLoading: false, error: null };
    detailResult = { screen: null, isLoading: false, error: null };
    mockCreateScreenAsync.mockResolvedValue({
      success: true,
      screen: { ...mockScreens[0]!, id: 'ts-new' },
    });

    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() =>
      expect(mockUpdateStateMutate).toHaveBeenCalledWith({ activeScreenId: 'ts-new' })
    );
  });

  it('persists the new selection when the active tab is deleted', async () => {
    // Deleting the active tab must PERSIST the fallback selection, not just set
    // local state: useWikiCardActions and the Maps panel read the SAVED
    // activeScreenId, so a missing persist leaves them pointed at a dead tab.
    const user = userEvent.setup();
    const twoScreens: TabletopScreenData[] = [
      mockScreens[0]!,
      { ...mockScreens[0]!, id: 'ts-2', name: 'Second', tabOrder: 1 },
    ];
    listResult = { screens: twoScreens, isLoading: false, error: null };

    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    // Active seeds to the first tab.
    await waitFor(() =>
      expect(screen.getByTestId('tabletop-tab-ts-1')).toHaveAttribute('aria-selected', 'true')
    );

    await user.click(screen.getByTestId('tabletop-settings-trigger'));
    await user.click(screen.getByRole('menuitem', { name: /delete tab/i }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockUpdateStateMutate).toHaveBeenCalledWith({ activeScreenId: 'ts-2' })
    );
  });

  it('falls back to the first tab when the persisted activeScreenId is not in the list', async () => {
    // A persisted-but-deleted id must not strand the view: the seeding effect's
    // existence check falls back to screens[0] instead of locking onto a dead id.
    playerStateResult = {
      id: 'ps-1',
      campaignId: 'c1',
      userId: 'u1',
      activeScreenId: 'ts-deleted',
      activeGMScreenId: null,
      viewports: [],
      windowOverrides: [],
      privateWindows: [],
      hydrated: {},
    };

    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() =>
      expect(screen.getByTestId('tabletop-tab-ts-1')).toHaveAttribute('aria-selected', 'true')
    );
  });

  it('re-seeds the active tab when the campaignId changes without a remount', async () => {
    // TanStack Router v1 doesn't remount on a path-param change, so the seed
    // guard must reset on a campaign switch and restore campaign B's own tab.
    playerStateResult = {
      id: 'ps-1',
      campaignId: 'c1',
      userId: 'u1',
      activeScreenId: 'ts-1',
      activeGMScreenId: null,
      viewports: [],
      windowOverrides: [],
      privateWindows: [],
      hydrated: {},
    };

    const { rerender } = render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() =>
      expect(screen.getByTestId('tabletop-tab-ts-1')).toHaveAttribute('aria-selected', 'true')
    );

    // Switch campaigns in place: new screen set, new persisted selection.
    listResult = {
      screens: [{ ...mockScreens[0]!, id: 'ts-x', campaignId: 'c2', name: 'Xray' }],
      isLoading: false,
      error: null,
    };
    playerStateResult = {
      id: 'ps-2',
      campaignId: 'c2',
      userId: 'u1',
      activeScreenId: 'ts-x',
      activeGMScreenId: null,
      viewports: [],
      windowOverrides: [],
      privateWindows: [],
      hydrated: {},
    };
    rerender(
      <TabletopView
        campaignId="c2"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('tabletop-tab-ts-x')).toHaveAttribute('aria-selected', 'true')
    );
  });

  it('renders the tabletop view with correct test id', () => {
    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      {
        wrapper: Wrapper,
      }
    );
    expect(screen.getByTestId('tabletop-view')).toBeInTheDocument();
  });

  it('renders loading state when screens are loading', () => {
    listResult = { screens: [], isLoading: true, error: null };
    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      {
        wrapper: Wrapper,
      }
    );
    expect(screen.getByText('Loading tabletop...')).toBeInTheDocument();
  });

  it('renders the tab bar and canvas when loaded', () => {
    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      {
        wrapper: Wrapper,
      }
    );
    expect(screen.getByTestId('tabletop-tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('tabletop-canvas')).toBeInTheDocument();
  });

  it('renders the dice tool window when "dice" is in openToolWindows', () => {
    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={['dice']}
        onCloseToolWindow={vi.fn()}
      />,
      { wrapper: Wrapper }
    );
    expect(screen.getByTestId('tool-window-dice-header')).toHaveTextContent('Dice Roller');
    expect(screen.getByTestId('dice-roller-panel')).toBeInTheDocument();
  });

  it('does not render the dice tool window when "dice" is not in openToolWindows', () => {
    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={[]}
        onCloseToolWindow={vi.fn()}
      />,
      { wrapper: Wrapper }
    );
    expect(screen.queryByTestId('tool-window-dice')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Private windows — owner-only, never broadcast
  // -------------------------------------------------------------------------

  describe('private windows', () => {
    function makePrivateWindow(overrides: Partial<PrivateWindowData> = {}): PrivateWindowData {
      return {
        id: 'pw-1',
        surface: 'tabletop',
        screenId: 'ts-1',
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

    function makePlayerState(privateWindows: PrivateWindowData[]): TabletopPlayerStateData {
      return {
        id: 'ps-1',
        campaignId: 'c1',
        userId: 'u1',
        activeScreenId: 'ts-1',
        activeGMScreenId: null,
        viewports: [],
        windowOverrides: [],
        privateWindows,
        hydrated: {
          'lore:doc-1': {
            id: 'doc-1',
            collection: 'lore',
            title: 'The Sunken Crown',
            content: 'secret lore',
          },
        },
      };
    }

    function renderView() {
      return render(
        <TabletopView
          campaignId="c1"
          isGM={false}
          currentUserId="u1"
          getToken={mockGetToken}
          sessionId={null}
          openToolWindows={[]}
          onCloseToolWindow={vi.fn()}
        />,
        { wrapper: Wrapper }
      );
    }

    it("renders the caller's private window for the active screen, titled from player-state hydration", async () => {
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());
      // Title must resolve — a fallback would read "lore:doc-1".
      expect(screen.getByTestId('fwm-window-pw-1')).toHaveTextContent('The Sunken Crown');
    });

    it('does not render private windows belonging to another screen or the gmscreen surface', async () => {
      playerStateResult = makePlayerState([
        makePrivateWindow({ id: 'pw-other-screen', screenId: 'ts-2' }),
        makePrivateWindow({ id: 'pw-gmscreen', surface: 'gmscreen' }),
      ]);
      renderView();

      await waitFor(() =>
        expect(screen.getByTestId('floating-window-manager')).toBeInTheDocument()
      );
      expect(screen.queryByTestId('fwm-window-pw-other-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('fwm-window-pw-gmscreen')).not.toBeInTheDocument();
    });

    it('closing a private window calls removePrivateWindow and never the GM-only closeWindow', async () => {
      // closeTabletopWindow is requireCampaignGM: routing a private close there
      // would 403 for a player and close the SHARED window for everyone.
      const user = userEvent.setup();
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-close-pw-1')).toBeInTheDocument());
      await user.click(screen.getByTestId('fwm-close-pw-1'));

      expect(mockRemovePrivateWindowMutate).toHaveBeenCalledWith({ privateWindowId: 'pw-1' });
      expect(mockCloseWindowMutate).not.toHaveBeenCalled();
    });

    it('closing a shared window still calls closeWindow and not removePrivateWindow', async () => {
      const user = userEvent.setup();
      detailResult = {
        screen: {
          ...mockDetail,
          windows: [
            {
              id: 'w-shared',
              collection: 'lore',
              documentId: 'doc-shared',
              state: 'open',
              x: 0,
              y: 0,
              width: null,
              height: null,
              zIndex: 1,
            },
          ],
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
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-close-w-shared')).toBeInTheDocument());
      await user.click(screen.getByTestId('fwm-close-w-shared'));

      expect(mockCloseWindowMutate).toHaveBeenCalledWith({
        screenId: 'ts-1',
        windowId: 'w-shared',
      });
      expect(mockRemovePrivateWindowMutate).not.toHaveBeenCalled();
    });

    it('suppresses a private window whose document is also open as a shared window', async () => {
      // The client's own `isAlreadyOpen` check only prevents opening a private
      // window for something already shared. The reverse order is entirely
      // reachable: the viewer shows themselves lore doc-1, then the GM pushes
      // doc-1 to everyone. Rendering both produces two identical windows.
      detailResult = {
        screen: {
          ...mockDetail,
          windows: [
            {
              id: 'w-shared',
              collection: 'lore',
              documentId: 'doc-1',
              state: 'open',
              x: 0,
              y: 0,
              width: null,
              height: null,
              zIndex: 1,
            },
          ],
          hydrated: {
            'lore:doc-1': {
              id: 'doc-1',
              collection: 'lore',
              title: 'The Sunken Crown',
              content: '',
            },
          },
        },
        isLoading: false,
        error: null,
      };
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-window-w-shared')).toBeInTheDocument());
      expect(screen.queryByTestId('fwm-window-pw-1')).not.toBeInTheDocument();

      // Crucially, suppressed is NOT deleted: the row stays so the private
      // window returns if the shared one is closed. A close-detection pass over
      // the UNFILTERED list would treat it as closed and destroy it.
      expect(mockRemovePrivateWindowMutate).not.toHaveBeenCalled();
    });

    it('closing the SHARED window does not delete a suppressed private window', async () => {
      // The dangerous interaction. A suppressed private window is never
      // rendered, so it is never in `nextWindows` — meaning any close-detection
      // pass that reads the UNFILTERED private list would see it as "closed"
      // and destroy it the moment the user closes the shared window that was
      // suppressing it. The row must survive so it reappears afterwards.
      const user = userEvent.setup();
      detailResult = {
        screen: {
          ...mockDetail,
          windows: [
            {
              id: 'w-shared',
              collection: 'lore',
              documentId: 'doc-1',
              state: 'open',
              x: 0,
              y: 0,
              width: null,
              height: null,
              zIndex: 1,
            },
          ],
          hydrated: {
            'lore:doc-1': {
              id: 'doc-1',
              collection: 'lore',
              title: 'The Sunken Crown',
              content: '',
            },
          },
        },
        isLoading: false,
        error: null,
      };
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-close-w-shared')).toBeInTheDocument());
      // Precondition: the private duplicate really is suppressed.
      expect(screen.queryByTestId('fwm-window-pw-1')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('fwm-close-w-shared'));

      expect(mockCloseWindowMutate).toHaveBeenCalledWith({
        screenId: 'ts-1',
        windowId: 'w-shared',
      });
      expect(mockRemovePrivateWindowMutate).not.toHaveBeenCalled();
    });

    it('persists a private window layout change through updatePrivateWindow', async () => {
      const user = userEvent.setup();
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-move-pw-1')).toBeInTheDocument());
      await user.click(screen.getByTestId('fwm-move-pw-1'));

      // Debounced — the write lands after the timer, not on the gesture.
      await waitFor(
        () =>
          expect(mockUpdatePrivateWindowMutate).toHaveBeenCalledWith(
            expect.objectContaining({ privateWindowId: 'pw-1' })
          ),
        { timeout: 2000 }
      );
    });

    it('does not write for private windows that did not move', async () => {
      // FloatingWindowManager re-emits the WHOLE list on any interaction. Since
      // updatePrivateWindow deliberately does not invalidate player state, a
      // naive "changed vs the server copy" check would mark every already-moved
      // window as dirty on every re-emit — so dragging one window would POST for
      // all of them.
      const user = userEvent.setup();
      playerStateResult = makePlayerState([
        makePrivateWindow(),
        makePrivateWindow({ id: 'pw-2', documentId: 'doc-1' }),
      ]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-move-pw-1')).toBeInTheDocument());

      // Move pw-1 twice; pw-2 is re-emitted both times but never moves.
      await user.click(screen.getByTestId('fwm-move-pw-1'));
      await waitFor(() => expect(mockUpdatePrivateWindowMutate).toHaveBeenCalled(), {
        timeout: 2000,
      });
      await user.click(screen.getByTestId('fwm-move-pw-1'));
      await new Promise((r) => setTimeout(r, 700));

      const touched = mockUpdatePrivateWindowMutate.mock.calls.map(
        (c) => (c[0] as { privateWindowId: string }).privateWindowId
      );
      expect(touched).not.toContain('pw-2');
    });

    it('does not persist layout for a SHARED window through updatePrivateWindow', async () => {
      const user = userEvent.setup();
      detailResult = {
        screen: {
          ...mockDetail,
          windows: [
            {
              id: 'w-shared',
              collection: 'lore',
              documentId: 'doc-shared',
              state: 'open',
              x: 0,
              y: 0,
              width: null,
              height: null,
              zIndex: 1,
            },
          ],
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
      playerStateResult = makePlayerState([]);
      renderView();

      await waitFor(() => expect(screen.getByTestId('fwm-move-w-shared')).toBeInTheDocument());
      await user.click(screen.getByTestId('fwm-move-w-shared'));

      await new Promise((r) => setTimeout(r, 700));
      expect(mockUpdatePrivateWindowMutate).not.toHaveBeenCalled();
    });

    it('flashes a matching private window on a cartyx:focus-window event', async () => {
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();
      await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

      await waitFor(() => {
        window.dispatchEvent(
          new CustomEvent('cartyx:focus-window', {
            detail: {
              campaignId: 'c1',
              surface: 'tabletop',
              collection: 'lore',
              documentId: 'doc-1',
            },
          })
        );
        expect(screen.getByTestId('fwm-window-pw-1')).toHaveClass('animate-flash-border');
      });
    });

    it('ignores focus events aimed at the gmscreen surface', async () => {
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();
      await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

      window.dispatchEvent(
        new CustomEvent('cartyx:focus-window', {
          detail: { surface: 'gmscreen', collection: 'lore', documentId: 'doc-1' },
        })
      );

      await waitFor(() =>
        expect(screen.getByTestId('fwm-window-pw-1')).not.toHaveClass('animate-flash-border')
      );
    });

    it('ignores focus events whose campaignId does not match this view', async () => {
      // Defense against a stale/cross-campaign event: the surface matches but the
      // campaignId does not, so the matching window must NOT flash. Asserted
      // synchronously after dispatch (the flash self-clears after 700ms, so a
      // retrying waitFor would go green even if the guard were removed).
      playerStateResult = makePlayerState([makePrivateWindow()]);
      renderView();
      await waitFor(() => expect(screen.getByTestId('fwm-window-pw-1')).toBeInTheDocument());

      act(() => {
        window.dispatchEvent(
          new CustomEvent('cartyx:focus-window', {
            detail: {
              campaignId: 'other-campaign',
              surface: 'tabletop',
              collection: 'lore',
              documentId: 'doc-1',
            },
          })
        );
      });

      expect(screen.getByTestId('fwm-window-pw-1')).not.toHaveClass('animate-flash-border');
    });
  });

  it('closing the dice window calls onCloseToolWindow with "dice"', async () => {
    const user = userEvent.setup();
    const onCloseToolWindow = vi.fn();
    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        openToolWindows={['dice']}
        onCloseToolWindow={onCloseToolWindow}
      />,
      { wrapper: Wrapper }
    );
    await user.click(screen.getByTestId('tool-window-dice-close'));
    expect(onCloseToolWindow).toHaveBeenCalledWith('dice');
  });
});
