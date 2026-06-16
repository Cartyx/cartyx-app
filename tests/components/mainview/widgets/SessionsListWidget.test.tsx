import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionsListWidget } from '~/components/mainview/widgets/SessionsListWidget';

// The catch-up modal fetches a session's catch-up via useSessionCatchUp
// (React Query). Mock it so these tests don't need a QueryClientProvider and so
// we can control the fetched content.
const mockUseSessionCatchUp = vi.fn();
vi.mock('~/hooks/useSessions', () => ({
  useSessionCatchUp: (...args: unknown[]) => mockUseSessionCatchUp(...args),
}));

beforeEach(() => {
  mockUseSessionCatchUp.mockReset();
  mockUseSessionCatchUp.mockReturnValue({ catchUp: null, isLoading: false, error: null });
});

// Mock useCampaign to provide session data when no prop is passed
vi.mock('~/hooks/useCampaigns', () => ({
  useCampaign: () => ({
    campaign: {
      sessions: [
        {
          id: 's1',
          number: 14,
          name: 'Ashes at Emberfall',
          startDate: '2026-03-21T00:00:00.000Z',
          endDate: null,
        },
        {
          id: 's2',
          number: 13,
          name: 'The Bell Beneath',
          startDate: '2026-03-14T00:00:00.000Z',
          endDate: null,
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
}));

const mockSessions = [
  {
    id: 's1',
    number: 14,
    name: 'Ashes at Emberfall',
    startDate: '2026-03-21T00:00:00.000Z',
    endDate: null,
    status: 'active' as const,
    catchUp: null,
  },
  {
    id: 's2',
    number: 13,
    name: 'The Bell Beneath',
    startDate: '2026-03-14T00:00:00.000Z',
    endDate: null,
    status: 'not_started' as const,
    catchUp: null,
  },
];

describe('SessionsListWidget', () => {
  it('renders the widget title', () => {
    render(<SessionsListWidget sessions={mockSessions} />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('renders all session names', () => {
    render(<SessionsListWidget sessions={mockSessions} />);
    expect(screen.getByText('Ashes at Emberfall')).toBeInTheDocument();
    expect(screen.getByText('The Bell Beneath')).toBeInTheDocument();
  });

  it('renders session numbers in "Session N" format', () => {
    render(<SessionsListWidget sessions={mockSessions} />);
    expect(screen.getByText('Session 14')).toBeInTheDocument();
    expect(screen.getByText('Session 13')).toBeInTheDocument();
  });

  it('renders session start dates formatted as locale date strings', () => {
    render(<SessionsListWidget sessions={mockSessions} />);
    expect(
      screen.getByText(new Date('2026-03-21T00:00:00.000Z').toLocaleDateString())
    ).toBeInTheDocument();
    expect(
      screen.getByText(new Date('2026-03-14T00:00:00.000Z').toLocaleDateString())
    ).toBeInTheDocument();
  });

  it('renders sessions in a card grid', () => {
    render(<SessionsListWidget sessions={mockSessions} />);
    const grid = screen.getByTestId('sessions-grid');
    expect(grid).toBeInTheDocument();
  });

  it('renders at most 5 sessions even when more are provided', () => {
    const manySessions = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      number: i + 1,
      name: `Session Name ${i + 1}`,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: null,
      status: (i === 0 ? 'active' : 'not_started') as 'not_started' | 'active' | 'completed',
      catchUp: null,
    }));
    render(<SessionsListWidget sessions={manySessions} />);
    expect(screen.getByText('Session Name 1')).toBeInTheDocument();
    expect(screen.getByText('Session Name 5')).toBeInTheDocument();
    expect(screen.queryByText('Session Name 6')).not.toBeInTheDocument();
    expect(screen.queryByText('Session Name 8')).not.toBeInTheDocument();
  });

  it('shows empty state when sessions is empty', () => {
    render(<SessionsListWidget sessions={[]} />);
    expect(screen.getByText('No sessions recorded')).toBeInTheDocument();
  });

  it('uses campaign data when sessions prop is omitted', () => {
    render(<SessionsListWidget />);
    expect(screen.getByText('Ashes at Emberfall')).toBeInTheDocument();
  });

  const completedSession = {
    id: 's1',
    number: 14,
    name: 'Ashes at Emberfall',
    startDate: '2026-03-21T00:00:00.000Z',
    endDate: null,
    // Completed sessions arrive with catchUp null — content is fetched on demand.
    status: 'completed' as const,
    catchUp: null,
  };

  it("fetches and shows a session's catch-up when its card is clicked", () => {
    mockUseSessionCatchUp.mockReturnValue({
      catchUp: 'The party fled the **burning** keep.',
      isLoading: false,
      error: null,
    });
    render(<SessionsListWidget sessions={[completedSession]} campaignId="c1" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Catch up on Session 14: Ashes at Emberfall' })
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Session 14 · Catch Up');
    expect(dialog).toHaveTextContent('The party fled the burning keep.');
    // The fetch is keyed on the campaign + session that was opened.
    expect(mockUseSessionCatchUp).toHaveBeenCalledWith('c1', 's1');
  });

  it('shows a loading state in the popup while the catch-up is fetched', () => {
    mockUseSessionCatchUp.mockReturnValue({ catchUp: null, isLoading: true, error: null });
    render(<SessionsListWidget sessions={[completedSession]} campaignId="c1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Catch up on Session 14: Ashes at Emberfall' })
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('Loading catch-up...');
  });

  it('shows an empty state in the popup when the session has no catch-up', () => {
    mockUseSessionCatchUp.mockReturnValue({ catchUp: null, isLoading: false, error: null });
    render(<SessionsListWidget sessions={[completedSession]} campaignId="c1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Catch up on Session 14: Ashes at Emberfall' })
    );

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'No catch-up content available for this session.'
    );
  });

  it('closes the catch-up popup when the close button is clicked', () => {
    mockUseSessionCatchUp.mockReturnValue({
      catchUp: 'Recap text.',
      isLoading: false,
      error: null,
    });
    render(<SessionsListWidget sessions={[completedSession]} campaignId="c1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Catch up on Session 14: Ashes at Emberfall' })
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
