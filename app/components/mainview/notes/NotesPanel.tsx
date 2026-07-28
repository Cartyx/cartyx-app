import React, { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { NotesFilterWidget } from './NotesFilterWidget';
import { NotesListWidget } from './NotesListWidget';
import { NoteModal } from './NoteModal';
import { useNotes, useDeleteNote } from '~/hooks/useNotes';
import { useCampaign } from '~/hooks/useCampaigns';
import { useDeleteConfirm } from '~/hooks/useDeleteConfirm';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import type { NoteListItem } from '~/types/note';

export function NotesPanel() {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);

  const [search, setSearch] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>();

  const sessions = campaign?.sessions ?? [];

  const { notes, isLoading, error } = useNotes(campaignId, {
    search: search || undefined,
    sessionId: sessionId || undefined,
    visibility,
    tags: filterTags.length > 0 ? filterTags : undefined,
  });

  const { remove: removeNote, isLoading: isDeleting } = useDeleteNote();
  const { pendingDelete, deleteError, requestDelete, cancelDelete, confirmDelete } =
    useDeleteConfirm<NoteListItem>(
      (note) => removeNote({ id: note.id, campaignId }),
      'Failed to delete note. Please try again.'
    );

  const handleCreateClick = () => {
    setSelectedNoteId(undefined);
    setIsModalOpen(true);
  };

  const handleNoteClick = (note: NoteListItem) => {
    setSelectedNoteId(note.id);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedNoteId(undefined);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <NotesFilterWidget
        search={search}
        onSearchChange={setSearch}
        sessionId={sessionId}
        onSessionChange={setSessionId}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        sessions={sessions}
        onCreateClick={handleCreateClick}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
      />
      <NotesListWidget
        notes={notes}
        sessions={sessions}
        isLoading={isLoading}
        error={error}
        onNoteClick={handleNoteClick}
        onNoteDelete={requestDelete}
      />
      <NoteModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        campaignId={campaignId}
        noteId={selectedNoteId}
        sessions={sessions}
        defaultSessionId={sessionId}
      />
      {pendingDelete && (
        <ConfirmDialog
          title="Delete Note"
          message={`Delete "${pendingDelete.title}"? This cannot be undone.`}
          danger
          confirmLabel="Delete"
          isLoading={isDeleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
    </div>
  );
}
