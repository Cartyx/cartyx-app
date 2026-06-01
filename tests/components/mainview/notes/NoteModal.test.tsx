import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoteModal } from '~/components/mainview/notes/NoteModal';
import { useCreateNote, useUpdateNote, useDeleteNote, useNote } from '~/hooks/useNotes';

// Mock hooks
vi.mock('~/hooks/useNotes');
vi.mock('~/hooks/useTags', () => ({
  useTags: () => ({ tags: [], isLoading: false, error: null }),
}));
vi.mock('~/hooks/useCampaigns', () => ({
  useCampaign: () => ({ campaign: { isGM: false }, isLoading: false }),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => ({ screens: [], isLoading: false, error: null }),
  useTabletopMutations: () => ({
    openWindow: { mutate: vi.fn(), isPending: false },
  }),
}));

// Mock CodeMirror (same approach as MarkdownEditor tests)
let lastCmOnChange: ((value: string) => void) | undefined;
let lastCmValue: string | undefined;
vi.mock('@codemirror/view', () => {
  class FakeEditorView {
    dom: HTMLDivElement;
    contentDOM: HTMLDivElement;
    state = { doc: { toString: () => lastCmValue ?? '' } };

    constructor(opts: { state: { doc: string }; parent: HTMLElement }) {
      lastCmValue = opts.state.doc;
      this.dom = document.createElement('div');
      this.dom.setAttribute('data-testid', 'cm-mock');
      this.contentDOM = document.createElement('div');
      this.contentDOM.setAttribute('contenteditable', 'true');
      this.dom.appendChild(this.contentDOM);
      opts.parent.appendChild(this.dom);
    }
    dispatch(tr: { changes?: { insert: string }; effects?: unknown }) {
      if (tr.changes) {
        lastCmValue = tr.changes.insert;
      }
    }
    focus() {}
    destroy() {}
  }

  return {
    EditorView: Object.assign(FakeEditorView, {
      theme: () => [],
      updateListener: {
        of: (
          fn: (u: { docChanged: boolean; state: { doc: { toString: () => string } } }) => void
        ) => {
          lastCmOnChange = (val: string) =>
            fn({ docChanged: true, state: { doc: { toString: () => val } } });
          return [];
        },
      },
      lineWrapping: [],
    }),
    placeholder: () => [],
    keymap: { of: () => [] },
  };
});

vi.mock('@codemirror/state', () => {
  class FakeCompartment {
    of(ext: unknown) {
      return ext;
    }
    reconfigure(ext: unknown) {
      return ext;
    }
  }
  return {
    EditorState: {
      create: (opts: { doc: string }) => ({ doc: opts.doc }),
      readOnly: { of: () => [] },
    },
    Compartment: FakeCompartment,
  };
});

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => [],
  markdownLanguage: {},
}));

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: () => [],
  historyKeymap: [],
}));

vi.mock('@codemirror/language', () => ({
  syntaxHighlighting: () => [],
}));

vi.mock('@codemirror/theme-one-dark', () => ({
  oneDarkHighlightStyle: {},
}));

const mockSessions = [
  {
    id: 'session-1',
    number: 1,
    name: 'First Session',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: null,
    status: 'not_started' as const,
    catchUp: null,
  },
  {
    id: 'session-2',
    number: 2,
    name: 'Second Session',
    startDate: '2026-01-08T00:00:00.000Z',
    endDate: null,
    status: 'active' as const,
    catchUp: null,
  },
];

const mockNote = {
  id: 'note-1',
  campaignId: 'campaign-123',
  sessionId: 'session-1',
  createdBy: 'user-1',
  title: 'Existing Note',
  note: '# Markdown content',
  tags: ['lore', 'npc'],
  isPublic: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();

function renderModal(overrides: Partial<React.ComponentProps<typeof NoteModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    campaignId: 'campaign-123',
    sessions: mockSessions,
    ...overrides,
  };
  const result = render(<NoteModal {...props} />);
  return { ...result, props };
}

describe('NoteModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    lastCmOnChange = undefined;
    lastCmValue = undefined;
    mockCreate.mockResolvedValue({ id: 'new-note' });
    mockUpdate.mockResolvedValue({ id: 'note-1' });
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: null,
      isLoading: false,
      error: null,
    });
    (useCreateNote as ReturnType<typeof vi.fn>).mockReturnValue({
      create: mockCreate,
      isLoading: false,
      error: null,
    });
    (useUpdateNote as ReturnType<typeof vi.fn>).mockReturnValue({
      update: mockUpdate,
      isLoading: false,
      error: null,
    });
    (useDeleteNote as ReturnType<typeof vi.fn>).mockReturnValue({
      remove: mockRemove,
      isLoading: false,
      error: null,
    });
  });

  // ── Create mode ─────────────────────────────────────────

  it('opens in create mode with default values', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'Create Note' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('defaults session to defaultSessionId in create mode', () => {
    renderModal({ defaultSessionId: 'session-2' });
    const sessionSelect = screen.getByRole('combobox');
    expect(sessionSelect).toHaveValue('session-2');
  });

  it('defaults session to No Session when no defaultSessionId', () => {
    renderModal();
    const sessionSelect = screen.getByRole('combobox');
    expect(sessionSelect).toHaveValue('');
  });

  it('treats "__none__" defaultSessionId as No Session', () => {
    renderModal({ defaultSessionId: '__none__' });
    const sessionSelect = screen.getByRole('combobox');
    expect(sessionSelect).toHaveValue('');
  });

  it('defaults visibility to private for new notes', () => {
    renderModal();
    const privateRadio = screen.getByRole('radio', { name: /private/i });
    expect(privateRadio).toBeChecked();
  });

  it('submits a new note on valid create (no session by default)', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    await user.type(screen.getByLabelText('Title'), 'My Note');

    // Wait for CodeMirror mock to initialize before invoking onChange
    await waitFor(() => {
      expect(lastCmOnChange).toBeDefined();
    });
    act(() => {
      lastCmOnChange!('Some markdown content');
    });

    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: 'campaign-123',
          title: 'My Note',
          note: 'Some markdown content',
          isPublic: false,
        })
      );
    });

    // sessionId should NOT be included when "No Session" is selected
    await waitFor(() => {
      const callArg = mockCreate.mock.calls[0]![0];
      expect(callArg).not.toHaveProperty('sessionId');
    });

    expect(props.onClose).toHaveBeenCalled();
  });

  // ── Edit mode ───────────────────────────────────────────

  it('opens in edit mode with saved values populated', () => {
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });

    renderModal({ noteId: 'note-1' });

    expect(screen.getByRole('heading', { name: 'Edit Note' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Existing Note');
    expect(screen.getByText('#lore')).toBeInTheDocument();
    expect(screen.getByText('#npc')).toBeInTheDocument();
  });

  it('shows saved session in edit mode', () => {
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });

    renderModal({ noteId: 'note-1' });
    const sessionSelect = screen.getByRole('combobox');
    expect(sessionSelect).toHaveValue('session-1');
  });

  it('submits update when editing', async () => {
    const user = userEvent.setup();
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });

    const { props } = renderModal({ noteId: 'note-1' });

    // Title and content are pre-populated — just submit
    await user.click(screen.getByRole('button', { name: 'Update Note' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'note-1',
          campaignId: 'campaign-123',
          title: 'Existing Note',
        })
      );
    });

    expect(props.onClose).toHaveBeenCalled();
  });

  // ── Validation ──────────────────────────────────────────

  it('shows validation error when title is empty', async () => {
    const user = userEvent.setup();
    renderModal();

    // Wait for CodeMirror mock to initialize
    await waitFor(() => {
      expect(lastCmOnChange).toBeDefined();
    });
    act(() => {
      lastCmOnChange!('body text');
    });

    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows validation error when note body is empty', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('Title'), 'My Note');

    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    await waitFor(() => {
      expect(screen.getByText('Note body is required')).toBeInTheDocument();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('allows creating a note with no sessions available', () => {
    renderModal({ sessions: [] });

    // No "Session Required" warning — notes can be created without sessions
    expect(screen.queryByText('Session Required')).not.toBeInTheDocument();
    // The submit button should still be enabled
    expect(screen.getByRole('button', { name: 'Create Note' })).not.toBeDisabled();
  });

  it('shows multiple validation errors simultaneously', async () => {
    const user = userEvent.setup();
    renderModal();

    // Type into title to trigger a render cycle that ensures effects have flushed
    const titleInput = screen.getByLabelText('Title');
    await user.click(titleInput);
    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
      expect(screen.getByText('Note body is required')).toBeInTheDocument();
    });
  });

  it('clears validation errors when fields are corrected', async () => {
    const user = userEvent.setup();
    renderModal();

    // Trigger validation by submitting empty form
    const titleInput = screen.getByLabelText('Title');
    await user.click(titleInput);
    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });

    // Fix title
    await user.type(titleInput, 'Fixed title');

    await waitFor(() => {
      expect(screen.queryByText('Title is required')).not.toBeInTheDocument();
    });
  });

  // ── Shared MarkdownEditor integration ───────────────────

  it('renders the shared MarkdownEditor with Edit/Preview tabs', () => {
    renderModal();
    expect(screen.getByRole('tab', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument();
  });

  it('passes content to MarkdownEditor and receives changes', async () => {
    renderModal();

    await waitFor(() => {
      expect(lastCmOnChange).toBeDefined();
    });
    act(() => {
      lastCmOnChange!('Updated markdown');
    });
  });

  it('shows error styling on MarkdownEditor when validation fails', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('Title'), 'My Note');
    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    await waitFor(() => {
      expect(screen.getByText('Note body is required')).toBeInTheDocument();
    });
  });

  // ── Tag chips ───────────────────────────────────────────

  it('adds a tag when pressing Enter', async () => {
    const user = userEvent.setup();
    renderModal();

    const tagInput = screen.getByLabelText('Add tag');
    await user.type(tagInput, 'lore{Enter}');

    expect(screen.getByText('#lore')).toBeInTheDocument();
    expect(tagInput).toHaveValue('');
  });

  it('adds a tag when pressing comma', async () => {
    const user = userEvent.setup();
    renderModal();

    const tagInput = screen.getByLabelText('Add tag');
    await user.type(tagInput, 'secret,');

    expect(screen.getByText('#secret')).toBeInTheDocument();
  });

  it('strips # prefix from user tag input', async () => {
    const user = userEvent.setup();
    renderModal();

    const tagInput = screen.getByLabelText('Add tag');
    await user.type(tagInput, '#magic{Enter}');

    expect(screen.getByText('#magic')).toBeInTheDocument();
  });

  it('removes a tag when clicking its remove button', async () => {
    const user = userEvent.setup();
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });

    renderModal({ noteId: 'note-1' });

    expect(screen.getByText('#lore')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Remove tag lore'));

    expect(screen.queryByText('#lore')).not.toBeInTheDocument();
    expect(screen.getByText('#npc')).toBeInTheDocument();
  });

  it('prevents duplicate tags', async () => {
    const user = userEvent.setup();
    renderModal();

    const tagInput = screen.getByLabelText('Add tag');
    await user.type(tagInput, 'lore{Enter}');
    await user.type(tagInput, 'lore{Enter}');

    const tagElements = screen.getAllByText('#lore');
    expect(tagElements).toHaveLength(1);
  });

  it('removes last tag on Backspace when input is empty', async () => {
    const user = userEvent.setup();
    renderModal();

    const tagInput = screen.getByLabelText('Add tag');
    await user.type(tagInput, 'first{Enter}');
    await user.type(tagInput, 'second{Enter}');

    expect(screen.getByText('#second')).toBeInTheDocument();

    await user.click(tagInput);
    await user.keyboard('{Backspace}');

    expect(screen.queryByText('#second')).not.toBeInTheDocument();
    expect(screen.getByText('#first')).toBeInTheDocument();
  });

  // ── Visibility toggle ───────────────────────────────────

  it('toggles from private to public', async () => {
    const user = userEvent.setup();
    renderModal();

    const publicRadio = screen.getByRole('radio', { name: /public/i });
    await user.click(publicRadio);

    expect(publicRadio).toBeChecked();
  });

  // ── Modal behavior ──────────────────────────────────────

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    // The backdrop has role="presentation"; the inner form has role="dialog"
    const [backdrop] = screen.getAllByRole('presentation');
    await user.click(backdrop!);

    expect(props.onClose).toHaveBeenCalled();
  });

  it('closes when X button is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    await user.click(screen.getByLabelText('Close modal'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('closes when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  // ── Responsive layout ──────────────────────────────────

  it('renders with 90% viewport constraints', () => {
    renderModal();
    // role="dialog" is on the <form> element itself
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain('max-w-[90vw]');
    expect(dialog.className).toContain('max-h-[90vh]');
  });

  it('uses full width and height within the modal', () => {
    renderModal();
    // role="dialog" is on the <form> element itself
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-full');
    expect(dialog.className).toContain('h-full');
  });

  // ── Error handling ──────────────────────────────────────

  // ── Delete ─────────────────────────────────────────────

  it('does not show delete button in create mode', () => {
    renderModal();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows delete button in edit mode', () => {
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });
    renderModal({ noteId: 'note-1' });
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('shows confirmation when delete is clicked', async () => {
    const user = userEvent.setup();
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });
    renderModal({ noteId: 'note-1' });

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(screen.getByText('Delete this note?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /yes, delete/i })).toBeInTheDocument();
  });

  it('calls remove and closes modal on confirmed delete', async () => {
    const user = userEvent.setup();
    mockRemove.mockResolvedValue({ success: true });
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });
    const { props } = renderModal({ noteId: 'note-1' });

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete/i }));

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith({ id: 'note-1', campaignId: 'campaign-123' });
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it('shows error when delete fails', async () => {
    const user = userEvent.setup();
    mockRemove.mockResolvedValue(null);
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });
    renderModal({ noteId: 'note-1' });

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to delete note. Please try again.')).toBeInTheDocument();
    });
  });

  it('hides confirmation when cancel is clicked in delete confirm', async () => {
    const user = userEvent.setup();
    (useNote as ReturnType<typeof vi.fn>).mockReturnValue({
      note: mockNote,
      isLoading: false,
      error: null,
    });
    renderModal({ noteId: 'note-1' });

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(screen.getByText('Delete this note?')).toBeInTheDocument();

    // Click the Cancel next to "Yes, delete" (not the main Cancel button)
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    await user.click(cancelButtons[0]!);

    expect(screen.queryByText('Delete this note?')).not.toBeInTheDocument();
  });

  // ── Header visibility icon ───────────────────────────────

  describe('header visibility icon', () => {
    it('shows a Lock icon by default when creating a note', () => {
      renderModal();
      const matches = screen.getAllByLabelText('Private');
      expect(matches.some((el) => el.tagName.toLowerCase() === 'svg')).toBe(true);
    });

    it('shows a Globe icon after the user toggles to Public', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText('Public'));
      const matches = screen.getAllByLabelText('Public');
      expect(matches.some((el) => el.tagName.toLowerCase() === 'svg')).toBe(true);
    });
  });

  // ── Error handling ──────────────────────────────────────

  it('shows error when save fails', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(null);
    renderModal();

    await user.type(screen.getByLabelText('Title'), 'My Note');

    await waitFor(() => {
      expect(lastCmOnChange).toBeDefined();
    });
    act(() => {
      lastCmOnChange!('Some content');
    });

    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to save note. Please try again.')).toBeInTheDocument();
    });
  });
});
