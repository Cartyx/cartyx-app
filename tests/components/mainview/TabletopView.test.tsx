import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TabletopScreenData, TabletopScreenDetailData } from '~/types/tabletop';

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
    createScreen: { ...noopMutation },
    renameScreen: { ...noopMutation },
    deleteScreen: { ...noopMutation },
    updateSettings: { ...noopMutation },
    openWindow: { ...noopMutation },
    closeWindow: { ...noopMutation },
    invalidateList: mockInvalidateList,
    invalidateDetail: mockInvalidateDetail,
  }),
}));

vi.mock('~/hooks/useTabletopPlayerState', () => ({
  useTabletopPlayerState: () => ({
    playerState: null,
    isLoading: false,
    updateState: { ...noopMutation },
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

vi.mock('~/components/mainview/FloatingWindowManager', () => ({
  FloatingWindowManager: ({ windows }: { windows: Array<{ id: string; title: string }> }) => (
    <div data-testid="floating-window-manager">
      {windows.map((w) => (
        <div key={w.id} data-testid={`fwm-window-${w.id}`}>
          {w.title}
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
  });

  it('renders the tabletop view with correct test id', () => {
    render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
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
      />,
      {
        wrapper: Wrapper,
      }
    );
    expect(screen.getByTestId('tabletop-tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('tabletop-canvas')).toBeInTheDocument();
  });

  it('opens the dice roller window when the dice tool is selected and reverts the tool', () => {
    const onToolChange = vi.fn();
    const { rerender } = render(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        activeTool="ruler"
        onToolChange={onToolChange}
      />,
      { wrapper: Wrapper }
    );
    expect(screen.queryByTestId('fwm-window-dice-roller')).not.toBeInTheDocument();

    rerender(
      <TabletopView
        campaignId="c1"
        isGM={true}
        currentUserId={null}
        getToken={mockGetToken}
        sessionId={null}
        activeTool="dice"
        onToolChange={onToolChange}
      />
    );
    expect(screen.getByTestId('fwm-window-dice-roller')).toHaveTextContent('Dice Roller');
    expect(onToolChange).toHaveBeenCalledWith('ruler');
  });

  it('keeps the dice window a singleton across repeated dice-tool selections', () => {
    const onToolChange = vi.fn();
    const props = {
      campaignId: 'c1',
      isGM: true,
      currentUserId: null,
      getToken: mockGetToken,
      sessionId: null,
      onToolChange,
    };
    const { rerender } = render(<TabletopView {...props} activeTool="pointer" />, {
      wrapper: Wrapper,
    });
    rerender(<TabletopView {...props} activeTool="dice" />);
    rerender(<TabletopView {...props} activeTool="pointer" />);
    rerender(<TabletopView {...props} activeTool="dice" />);
    expect(screen.getAllByTestId('fwm-window-dice-roller')).toHaveLength(1);
  });
});
