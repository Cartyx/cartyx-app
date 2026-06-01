import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Globe, Lock } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { FormSelect } from '~/components/FormSelect';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import type { CampaignData } from '~/types/campaign';
import { useCreateNote, useUpdateNote, useDeleteNote, useNote } from '~/hooks/useNotes';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { useCampaign } from '~/hooks/useCampaigns';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  noteId?: string;
  sessions: CampaignData['sessions'];
  defaultSessionId?: string;
}

interface FieldErrors {
  title?: string;
  content?: string;
}

export function NoteModal({
  isOpen,
  onClose,
  campaignId,
  noteId,
  sessions,
  defaultSessionId,
}: NoteModalProps) {
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;
  const { note: fetchedNote, isLoading: isFetchingNote } = useNote(noteId ?? '', campaignId);
  const { create, isLoading: isCreating } = useCreateNote();
  const { update, isLoading: isUpdating } = useUpdateNote();
  const { remove, isLoading: isDeleting } = useDeleteNote();

  const [title, setTitle] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Reset form to blank when switching noteId or opening the modal,
  // so stale values from a previous note never flash.
  useEffect(() => {
    setTitle('');
    const safeDefault = defaultSessionId === '__none__' ? '' : defaultSessionId;
    setSessionId(noteId ? '' : safeDefault || '');
    setContent('');
    setTags([]);
    setIsPublic(false);
    setError(null);
    setFieldErrors({});
    setHasSubmitted(false);
    setShowDeleteConfirm(false);
  }, [noteId, defaultSessionId, sessions, isOpen]);

  // Populate form once the fetched note resolves in edit mode
  useEffect(() => {
    if (noteId && fetchedNote) {
      setTitle(fetchedNote.title);
      setSessionId(fetchedNote.sessionId ?? '');
      setContent(fetchedNote.note);
      setTags(fetchedNote.tags);
      setIsPublic(fetchedNote.isPublic);
    }
  }, [noteId, fetchedNote]);

  const sessionOptions = useMemo(
    () => [
      { value: '', label: 'No Session' },
      ...sessions.map((s) => ({
        value: s.id,
        label: `Session ${s.number}: ${s.name}`,
      })),
    ],
    [sessions]
  );

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = 'Title is required';
    if (!content.trim()) errors.content = 'Note body is required';
    return errors;
  }, [title, content]);

  useEffect(() => {
    if (hasSubmitted) {
      setFieldErrors(validate());
    }
  }, [hasSubmitted, validate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);
    setError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const input = {
      campaignId,
      title: title.trim(),
      note: content.trim(),
      tags,
      isPublic,
      ...(sessionId ? { sessionId } : {}),
    };

    let success = false;
    if (noteId) {
      const result = await update({ ...input, id: noteId });
      success = !!result;
    } else {
      const result = await create(input);
      success = !!result;
    }

    if (success) {
      onClose();
    } else {
      setError('Failed to save note. Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!noteId) return;
    setError(null);
    const result = await remove({ id: noteId, campaignId });
    if (result) {
      onClose();
    } else {
      setError('Failed to delete note. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  const isLoadingNote = !!(noteId && isFetchingNote);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingNote || isSaving || isDeleting;

  return createPortal(
    // role="presentation": backdrop click-to-close is a convenience; Escape key handler closes the dialog
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2">
            {isPublic ? (
              <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-label="Public" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-label="Private" />
            )}
            <h2
              id="note-modal-title"
              className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
            >
              {noteId ? 'Edit Note' : 'Create Note'}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {noteId && (
              <ShowOnTabletopButton
                campaignId={campaignId}
                collection="note"
                documentId={noteId}
                isGM={isGM}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-500 hover:text-white transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 min-h-0">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FormInput
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Traitor's Meeting"
              disabled={isDisabled}
              error={fieldErrors.title}
            />
            <FormSelect
              label="Session"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              options={sessionOptions}
              disabled={isDisabled}
            />
          </div>

          <MarkdownEditor
            label="Note"
            value={content}
            onChange={setContent}
            placeholder="What happened? What did you discover?..."
            disabled={isDisabled}
            error={fieldErrors.content}
            minHeight="16rem"
            id="note-modal-editor"
          />

          {/* Tags */}
          <div>
            <label
              htmlFor="note-tags-input"
              className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
            >
              Tags
            </label>
            <TagAutocompleteInput
              campaignId={campaignId}
              selectedTags={tags}
              onTagsChange={setTags}
              placeholder="Type a tag and press Enter"
              disabled={isDisabled}
              id="note-tags-input"
            />
            <p className="text-xs text-slate-700 mt-1.5">
              Press Enter or comma to add. Suggestions appear as you type.
            </p>
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="visibility"
                checked={!isPublic}
                onChange={() => setIsPublic(false)}
                className="sr-only"
                disabled={isDisabled}
              />
              <div
                className={`h-10 px-4 rounded-xl border flex items-center gap-2.5 transition-all ${
                  !isPublic
                    ? 'bg-blue-600/10 border-blue-500/50 text-blue-300 shadow-sm shadow-blue-500/10'
                    : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20'
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                <span className="font-sans font-bold text-xs">Private</span>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="visibility"
                checked={isPublic}
                onChange={() => setIsPublic(true)}
                className="sr-only"
                disabled={isDisabled}
              />
              <div
                className={`h-10 px-4 rounded-xl border flex items-center gap-2.5 transition-all ${
                  isPublic
                    ? 'bg-emerald-600/10 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/10'
                    : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                <span className="font-sans font-bold text-xs">Public</span>
              </div>
            </label>
          </div>
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] bg-white/[0.01] shrink-0">
          <div>
            {noteId && !showDeleteConfirm && (
              <PixelButton
                variant="secondary"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDisabled}
                type="button"
              >
                <span className="text-rose-400">Delete</span>
              </PixelButton>
            )}
            {noteId && showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-400 font-semibold">Delete this note?</span>
                <PixelButton
                  variant="secondary"
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  type="button"
                >
                  <span className="text-rose-400">
                    {isDeleting ? 'Deleting...' : 'Yes, delete'}
                  </span>
                </PixelButton>
                <PixelButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  type="button"
                >
                  Cancel
                </PixelButton>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isSaving || isDeleting}
              type="button"
            >
              Cancel
            </PixelButton>
            <PixelButton variant="primary" size="sm" disabled={isDisabled} type="submit">
              {isSaving
                ? 'Saving...'
                : isLoadingNote
                  ? 'Loading...'
                  : noteId
                    ? 'Update Note'
                    : 'Create Note'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
