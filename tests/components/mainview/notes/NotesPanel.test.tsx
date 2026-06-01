import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotesPanel } from '~/components/mainview/notes/NotesPanel';
import { useNotes, useNote, useCreateNote, useUpdateNote, useDeleteNote } from '~/hooks/useNotes';
import { useCampaign } from '~/hooks/useCampaigns';

// Mock the hooks
vi.mock('~/hooks/useNotes');
vi.mock('~/hooks/useCampaigns');
vi.mock('~/hooks/useTags', () => ({
  useTags: () => ({ tags: [], isLoading: false, error: null }),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => ({ screens: [], isLoading: false, error: null }),
  useTabletopMutations: () => ({
    openWindow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'campaign-123' }),
}));

const mockSessions = [
  {
    id: 'session-1',
    number: 1,
    name: 'First Session',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: null,
  },
  {
    id: 'session-2',
    number: 2,
    name: 'Second Session',
    startDate: '2026-01-08T00:00:00.000Z',
    endDate: null,
  },
];

const mockNotes = [
  {
    id: 'note-1',
    campaignId: 'campaign-123',
    sessionId: 'session-1',
    title: 'Note 1',
    tags: ['lore', 'secret'],
    isPublic: true,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: 'user-1',
  },
];

describe('NotesPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (useCampaign as any).mockReturnValue({
      campaign: { sessions: mockSessions },
      isLoading: false,
      error: null,
    });
    (useNotes as any).mockReturnValue({
      notes: mockNotes,
      isLoading: false,
      error: null,
    });
    (useNote as any).mockReturnValue({
      note: null,
      isLoading: false,
      error: null,
    });
    (useCreateNote as any).mockReturnValue({
      create: vi.fn(),
      isLoading: false,
      error: null,
    });
    (useUpdateNote as any).mockReturnValue({
      update: vi.fn(),
      isLoading: false,
      error: null,
    });
    (useDeleteNote as any).mockReturnValue({
      remove: vi.fn(),
      isLoading: false,
      error: null,
    });
  });

  it('renders filters and notes list', async () => {
    render(<NotesPanel />);

    expect(screen.getByPlaceholderText('Search notes...')).toBeInTheDocument();
    expect(screen.getByLabelText('Create new note')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Note 1')).toBeInTheDocument();
      expect(screen.getByText('Session 1')).toBeInTheDocument();
      expect(screen.getByText('#lore')).toBeInTheDocument();
      expect(screen.getByText('#secret')).toBeInTheDocument();
    });
  });

  it('updates filters when search input changes', async () => {
    const user = userEvent.setup();
    render(<NotesPanel />);

    const searchInput = screen.getByPlaceholderText('Search notes...');
    await user.type(searchInput, 'test search');

    expect(useNotes).toHaveBeenLastCalledWith(
      'campaign-123',
      expect.objectContaining({
        search: 'test search',
      })
    );
  });

  it('updates filters when session select changes', async () => {
    const user = userEvent.setup();
    render(<NotesPanel />);

    await waitFor(() => {
      expect(screen.getByText('Session 1: First Session')).toBeInTheDocument();
    });

    const sessionSelect = screen.getByLabelText('Filter by session');
    await user.selectOptions(sessionSelect, 'session-1');

    expect(useNotes).toHaveBeenLastCalledWith(
      'campaign-123',
      expect.objectContaining({
        sessionId: 'session-1',
      })
    );
  });

  it('updates filters when visibility select changes', async () => {
    const user = userEvent.setup();
    render(<NotesPanel />);

    const visibilitySelect = screen.getByLabelText('Filter by visibility');
    await user.selectOptions(visibilitySelect, 'public');

    expect(useNotes).toHaveBeenLastCalledWith(
      'campaign-123',
      expect.objectContaining({
        visibility: 'public',
      })
    );
  });

  it('opens create modal when + button is clicked', async () => {
    const user = userEvent.setup();
    render(<NotesPanel />);

    const createButton = screen.getByLabelText('Create new note');
    await user.click(createButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create Note' })).toBeInTheDocument();
  });

  it('opens edit modal when a note is clicked', async () => {
    const user = userEvent.setup();
    render(<NotesPanel />);

    await waitFor(() => {
      expect(screen.getByText('Note 1')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Note 1'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Note' })).toBeInTheDocument();
  });

  it('shows loading state', () => {
    (useNotes as any).mockReturnValue({
      notes: [],
      isLoading: true,
      error: null,
    });

    render(<NotesPanel />);
    expect(screen.getByText('Loading notes...')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    (useNotes as any).mockReturnValue({
      notes: [],
      isLoading: false,
      error: null,
    });

    render(<NotesPanel />);
    expect(screen.getByText('No notes found matching your filters.')).toBeInTheDocument();
  });

  it('shows error state', () => {
    (useNotes as any).mockReturnValue({
      notes: [],
      isLoading: false,
      error: 'Failed to fetch',
    });

    render(<NotesPanel />);
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });
});
