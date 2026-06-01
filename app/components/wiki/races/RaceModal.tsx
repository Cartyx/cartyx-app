import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { useRace, useCreateRace, useUpdateRace, useDeleteRace } from '~/hooks/useRaces';
import { useCampaign } from '~/hooks/useCampaigns';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';

interface RaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  raceId?: string;
}

interface FieldErrors {
  title?: string;
  content?: string;
}

export function RaceModal({ isOpen, onClose, campaignId, raceId }: RaceModalProps) {
  const isEdit = !!raceId;

  const { race: existingRace, isLoading: isFetchingRace } = useRace(raceId ?? '', campaignId);
  const { create, isLoading: isCreating } = useCreateRace();
  const { update, isLoading: isUpdating } = useUpdateRace();
  const { remove, isLoading: isDeleting } = useDeleteRace();
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Close on Escape key — only active when the modal is open
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Reset form when opening
  useEffect(() => {
    setTitle('');
    setContent('');
    setTags([]);
    setError(null);
    setFieldErrors({});
    setHasSubmitted(false);
    setShowDeleteConfirm(false);
  }, [raceId, isOpen]);

  // Populate form with existing race data when editing
  useEffect(() => {
    if (!isEdit || !existingRace) return;
    setTitle(existingRace.title);
    setContent(existingRace.content);
    setTags(existingRace.tags);
  }, [isEdit, existingRace]);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = 'Title is required';
    if (!content.trim()) errors.content = 'Content is required';
    return errors;
  }, [title, content]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setError(null);

    let success = false;
    if (isEdit && raceId) {
      const result = await update({ id: raceId, campaignId, title, content, tags });
      success = !!result;
    } else {
      const result = await create({ campaignId, title, content, tags });
      success = !!result;
    }

    if (success) {
      onClose();
    } else {
      setError(`Failed to ${isEdit ? 'update' : 'create'} race. Please try again.`);
    }
  };

  const handleDelete = async () => {
    if (!raceId) return;
    setError(null);
    const result = await remove({ id: raceId, campaignId });
    if (result) {
      onClose();
    } else {
      setError('Failed to delete race. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  // Update field errors on change if user has already submitted
  useEffect(() => {
    if (!isOpen || !hasSubmitted) return;
    setFieldErrors(validate());
  }, [isOpen, hasSubmitted, validate]);

  if (!isOpen) return null;

  const isLoadingRace = !!(isEdit && isFetchingRace);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingRace || isSaving || isDeleting;

  return createPortal(
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
        aria-labelledby="race-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="race-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Race' : 'Create Race'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {isEdit && raceId && (
              <ShowOnTabletopButton
                campaignId={campaignId}
                collection="race"
                documentId={raceId}
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

          {isLoadingRace ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading race...</p>
            </div>
          ) : (
            <>
              <FormInput
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                error={fieldErrors.title}
                required
                disabled={isDisabled}
                placeholder="e.g. Half-Elf"
              />

              <MarkdownEditor
                label="Content"
                value={content}
                onChange={setContent}
                placeholder="Describe this race..."
                error={fieldErrors.content}
                disabled={isDisabled}
                minHeight="300px"
              />

              <TagAutocompleteInput
                campaignId={campaignId}
                selectedTags={tags}
                onTagsChange={setTags}
                disabled={isDisabled}
              />
            </>
          )}
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] shrink-0 gap-3">
          {isEdit && (
            <div className="flex items-center gap-2">
              {showDeleteConfirm ? (
                <>
                  <span className="text-xs text-rose-400 font-semibold">Delete this race?</span>
                  <PixelButton
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDisabled}
                  >
                    {isDeleting ? 'Deleting...' : 'Confirm'}
                  </PixelButton>
                  <PixelButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDisabled}
                  >
                    Cancel
                  </PixelButton>
                </>
              ) : (
                <PixelButton
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDisabled}
                >
                  Delete
                </PixelButton>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <PixelButton type="button" variant="ghost" onClick={onClose} disabled={isDisabled}>
              Cancel
            </PixelButton>
            <PixelButton type="submit" disabled={isDisabled}>
              {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Race'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
