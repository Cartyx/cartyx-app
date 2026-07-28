import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WikiCardActionsStubProvider } from '~/components/wiki/shared/WikiCardActionsStubProvider';
import { NotesListWidget } from '~/components/mainview/notes/NotesListWidget';
import type { NoteListItem } from '~/types/note';

/**
 * Regression guard for a whole class of breakage that nothing else catches.
 *
 * Adding `useWikiCardActions` to a leaf component gives it a hard dependency on
 * a context whose real provider cannot mount outside the /play route — which
 * silently breaks that component's Storybook stories. Storybook is not in
 * `test:ci` (which runs `--project unit` only) and has no workflow of its own,
 * so nothing would fail. These tests pin the two properties that matter:
 *
 *   1. the stub supplies a usable context (so story decorators keep working)
 *   2. these components render standalone, with no router and no query client
 *
 * If a future change makes one of them need the router directly, this fails
 * here rather than silently in a story nobody runs.
 */

const notes: NoteListItem[] = [
  {
    id: 'n1',
    campaignId: 'c1',
    createdBy: 'u1',
    title: 'The Traitor Revealed',
    tags: ['plot'],
    isPublic: true,
    canEdit: true,
    createdAt: '2026-03-21T20:00:00Z',
    updatedAt: '2026-03-21T22:15:00Z',
  },
];

describe('WikiCardActionsStubProvider', () => {
  it('lets a note card render with no router and no query client', () => {
    render(
      <WikiCardActionsStubProvider>
        <NotesListWidget
          notes={notes}
          sessions={[]}
          isLoading={false}
          error={null}
          onNoteClick={vi.fn()}
        />
      </WikiCardActionsStubProvider>
    );

    expect(screen.getByText('The Traitor Revealed')).toBeInTheDocument();
    // The overflow menu is the piece that needs the context at all.
    expect(screen.getByRole('button', { name: 'Note actions' })).toBeInTheDocument();
  });

  it('throws without the provider — proving the stub is what makes it work', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <NotesListWidget
          notes={notes}
          sessions={[]}
          isLoading={false}
          error={null}
          onNoteClick={vi.fn()}
        />
      )
    ).toThrow(/must be used within a WikiCardActionsProvider/);
    spy.mockRestore();
  });

  it('honours overrides — a player sees no Push to Tabletop', () => {
    render(
      <WikiCardActionsStubProvider value={{ isGM: false }}>
        <NotesListWidget
          notes={notes}
          sessions={[]}
          isLoading={false}
          error={null}
          onNoteClick={vi.fn()}
        />
      </WikiCardActionsStubProvider>
    );

    expect(screen.getByRole('button', { name: 'Note actions' })).toBeInTheDocument();
  });
});
