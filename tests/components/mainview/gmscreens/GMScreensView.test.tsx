import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GMScreenData, GMScreenDetailData } from '~/types/gmscreen';

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
let playerStateResult: {
  playerState: { activeGMScreenId: string | null } | null;
  isLoading: boolean;
  updateState: { mutate: typeof mockUpdateStateMutate };
} = {
  playerState: null,
  isLoading: false,
  updateState: { mutate: mockUpdateStateMutate },
};

vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: (_campaignId: string) => playerStateResult,
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
    playerStateResult = {
      playerState: null,
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };
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
    playerStateResult = {
      playerState: null,
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };
  });

  it('falls back to the first screen on first visit (activeGMScreenId is null)', async () => {
    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('restores the persisted screen from player state', async () => {
    playerStateResult = {
      playerState: { activeGMScreenId: 'scr-c' },
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };

    render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-c')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('restores the persisted screen even when player state arrives after screens resolve (race)', async () => {
    // Screens are already resolved (listLoading: false) but player state is
    // still loading — the seeding effect must wait rather than flashing
    // screens[0] before the persisted value is known.
    playerStateResult = {
      playerState: null,
      isLoading: true,
      updateState: { mutate: mockUpdateStateMutate },
    };

    const { rerender } = render(<GMScreensView campaignId="c1" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-a')).toHaveAttribute('aria-selected', 'false');
    });
    expect(screen.getByTestId('screen-tab-scr-c')).toHaveAttribute('aria-selected', 'false');

    // Player state now resolves with a persisted screen, after the screen list settled.
    playerStateResult = {
      playerState: { activeGMScreenId: 'scr-c' },
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };
    rerender(<GMScreensView campaignId="c1" />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-c')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('falls back to the first screen when the persisted screen was deleted', async () => {
    playerStateResult = {
      playerState: { activeGMScreenId: 'scr-deleted' },
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };

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
    playerStateResult = {
      playerState: { activeGMScreenId: 'scr-b' },
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };
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
    playerStateResult = {
      playerState: null,
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };
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
    playerStateResult = {
      playerState: { activeGMScreenId: 'scr-y' },
      isLoading: false,
      updateState: { mutate: mockUpdateStateMutate },
    };
    rerender(<GMScreensView campaignId="c2" />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-tab-scr-y')).toHaveAttribute('aria-selected', 'true');
    });
  });
});
