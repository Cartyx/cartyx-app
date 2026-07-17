import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { PixelButton } from '~/components/PixelButton';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { useModalForm } from '~/hooks/useModalForm';
import {
  useSpell,
  useCreateSpell,
  useUpdateSpell,
  useDeleteSpell,
  useDuplicateSpell,
} from '~/hooks/useSpells';
import { SpellForm, EMPTY_SPELL_FORM, spellToForm, formToInput } from './spellForm';
import { SpellBasicInfoSection } from './SpellBasicInfoSection';
import { SpellAdditionalInfoSection } from './SpellAdditionalInfoSection';
import { SpellModifiersEditor } from './SpellModifiersEditor';
import { SpellConditionsEditor } from './SpellConditionsEditor';
import { SpellHigherLevelsEditor } from './SpellHigherLevelsEditor';
import { SpellWindow } from './SpellWindow';

interface SpellModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  spellId?: string;
}

interface FieldErrors {
  name?: string;
  description?: string;
}

export function SpellModal({ isOpen, onClose, campaignId, spellId }: SpellModalProps) {
  const isEdit = !!spellId;
  const { spell: existing, isLoading: isFetching } = useSpell(spellId ?? '', campaignId);
  const { create, isLoading: isCreating } = useCreateSpell();
  const { update, isLoading: isUpdating } = useUpdateSpell();
  const { remove, isLoading: isDeleting } = useDeleteSpell();
  const { duplicate, isLoading: isDuplicating } = useDuplicateSpell();

  const [form, setForm] = useState<SpellForm>(EMPTY_SPELL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const patch = useCallback((partial: Partial<SpellForm>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  }, []);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    if (!form.description.trim()) errors.description = 'Description is required';
    return errors;
  }, [form.name, form.description]);

  const { fieldErrors, runValidation } = useModalForm({
    isOpen,
    onClose,
    recordId: spellId,
    isEdit,
    record: existing,
    reset: () => {
      setForm(EMPTY_SPELL_FORM);
      setError(null);
      setShowDeleteConfirm(false);
    },
    populate: (spell) => setForm(spellToForm(spell)),
    validate,
  });

  const isSrd = existing?.source === 'srd';
  const isReadOnly = isEdit && isSrd;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    const errors = runValidation();
    if (Object.keys(errors).length > 0) return;
    setError(null);

    let success = false;
    if (isEdit && spellId) {
      const result = await update(
        formToInput(form, campaignId, spellId) as Parameters<typeof update>[0]
      );
      success = !!result;
    } else {
      const result = await create(formToInput(form, campaignId));
      success = !!result;
    }
    if (success) onClose();
    else setError(`Failed to ${isEdit ? 'update' : 'create'} spell. Please try again.`);
  };

  const handleDuplicate = async () => {
    if (!spellId) return;
    setError(null);
    const result = await duplicate({ id: spellId, campaignId });
    if (result) onClose();
    else setError('Failed to duplicate spell. Please try again.');
  };

  const handleDelete = async () => {
    if (!spellId) return;
    setError(null);
    const result = await remove({ id: spellId, campaignId });
    if (result) onClose();
    else {
      setError('Failed to delete spell. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  const isLoadingSpell = !!(isEdit && isFetching);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingSpell || isSaving || isDeleting || isDuplicating;

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
        aria-labelledby="spell-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="spell-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isReadOnly ? 'SRD Spell (read-only)' : isEdit ? 'Edit Spell' : 'Create Spell'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 min-h-0">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          {isLoadingSpell ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading spell...</p>
            </div>
          ) : isReadOnly && existing ? (
            <div className="rounded-lg border border-white/[0.05] overflow-hidden">
              <SpellWindow spell={existing} />
            </div>
          ) : (
            <>
              <SpellBasicInfoSection
                form={form}
                patch={patch}
                disabled={isDisabled}
                errors={fieldErrors}
              />
              <SpellAdditionalInfoSection form={form} patch={patch} disabled={isDisabled} />
              <SpellModifiersEditor
                value={form.modifiers}
                onChange={(v) => patch({ modifiers: v })}
                disabled={isDisabled}
              />
              <SpellConditionsEditor
                value={form.conditions}
                onChange={(v) => patch({ conditions: v })}
                disabled={isDisabled}
              />
              <SpellHigherLevelsEditor
                value={form.higherLevels}
                onChange={(v) => patch({ higherLevels: v })}
                disabled={isDisabled}
              />
              <TagAutocompleteInput
                campaignId={campaignId}
                selectedTags={form.tags}
                onTagsChange={(tags) => patch({ tags })}
                disabled={isDisabled}
              />
            </>
          )}
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] shrink-0 gap-3">
          {isEdit && !isSrd && (
            <div className="flex items-center gap-2">
              {showDeleteConfirm ? (
                <>
                  <span className="text-xs text-rose-400 font-semibold">Delete this spell?</span>
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
            {isReadOnly ? (
              <>
                <PixelButton
                  type="button"
                  variant="ghost"
                  onClick={handleDuplicate}
                  disabled={isDisabled}
                >
                  {isDuplicating ? 'Duplicating...' : 'Duplicate to Homebrew'}
                </PixelButton>
                <PixelButton type="button" onClick={onClose} disabled={isDisabled}>
                  Close
                </PixelButton>
              </>
            ) : (
              <>
                <PixelButton type="button" variant="ghost" onClick={onClose} disabled={isDisabled}>
                  Cancel
                </PixelButton>
                <PixelButton type="submit" disabled={isDisabled}>
                  {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Spell'}
                </PixelButton>
              </>
            )}
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
