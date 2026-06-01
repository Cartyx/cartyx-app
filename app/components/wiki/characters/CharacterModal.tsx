import React, { useState, useEffect, useMemo, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { X, Globe, Lock } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { FormSelect } from '~/components/FormSelect';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { ImageCropInput } from './ImageCropInput';
import { SessionMultiSelect } from './SessionMultiSelect';
import {
  useCharacter,
  useCreateCharacter,
  useUpdateCharacter,
  useDeleteCharacter,
} from '~/hooks/useCharacters';
import { useRaces } from '~/hooks/useRaces';
import { useCampaign } from '~/hooks/useCampaigns';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';
import type { CampaignData } from '~/types/campaign';
import type { PictureCrop } from '~/types/character';
import { uploadToR2 } from '~/utils/uploadToR2';
import { compressImage } from '~/utils/compressImage';

interface CharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  characterId?: string;
  sessions: CampaignData['sessions'];
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  link?: string;
}

export function CharacterModal({
  isOpen,
  onClose,
  campaignId,
  characterId,
  sessions,
}: CharacterModalProps) {
  const isEdit = !!characterId;
  const raceDatalistId = useId();

  const { character: existingCharacter, isLoading: isFetchingCharacter } = useCharacter(
    characterId ?? '',
    campaignId
  );
  const { create, isLoading: isCreating } = useCreateCharacter();
  const { update, isLoading: isUpdating } = useUpdateCharacter();
  const { remove, isLoading: isDeleting } = useDeleteCharacter();
  const { races } = useRaces(campaignId, { enabled: isOpen });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [race, setRace] = useState('');
  const [characterClass, setCharacterClass] = useState('');
  const [age, setAge] = useState('');
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [picture, setPicture] = useState('');
  const [pictureCrop, setPictureCrop] = useState<PictureCrop | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [gmNotes, setGmNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Close on Escape key — only active when modal is open to avoid interfering with other dialogs
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Reset form when opening — clears stale values from a previous character
  useEffect(() => {
    setFirstName('');
    setLastName('');
    setRace('');
    setCharacterClass('');
    setAge('');
    setLocation('');
    setLink('');
    setPicture('');
    setPictureCrop(null);
    setSessionId('');
    setSelectedSessions([]);
    setNotes('');
    setGmNotes('');
    setTags([]);
    setIsPublic(false);
    setError(null);
    setFieldErrors({});
    setHasSubmitted(false);
    setShowDeleteConfirm(false);
  }, [characterId, isOpen]);

  // Populate form once the fetched character resolves in edit mode
  useEffect(() => {
    if (isEdit && existingCharacter) {
      setFirstName(existingCharacter.firstName);
      setLastName(existingCharacter.lastName);
      setRace(existingCharacter.race);
      setCharacterClass(existingCharacter.characterClass);
      setAge(existingCharacter.age != null ? String(existingCharacter.age) : '');
      setLocation(existingCharacter.location);
      setLink(existingCharacter.link);
      setPicture(existingCharacter.picture);
      setPictureCrop(existingCharacter.pictureCrop);
      setSessionId(existingCharacter.sessionId ?? '');
      setSelectedSessions(existingCharacter.sessions);
      setNotes(existingCharacter.notes);
      setGmNotes(existingCharacter.gmNotes);
      setTags(existingCharacter.tags);
      setIsPublic(existingCharacter.isPublic);
    }
  }, [isEdit, existingCharacter]);

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
    if (!firstName.trim()) errors.firstName = 'First name is required';
    if (!lastName.trim()) errors.lastName = 'Last name is required';
    if (link.trim() && !/^https?:\/\/.+/.test(link.trim())) {
      errors.link = 'Must be a valid HTTP or HTTPS URL';
    }
    return errors;
  }, [firstName, lastName, link]);

  useEffect(() => {
    if (hasSubmitted) setFieldErrors(validate());
  }, [hasSubmitted, validate]);

  const handleUpload = useCallback(async (file: File): Promise<string> => {
    const compressed = await compressImage(file);
    const { publicUrl } = await uploadToR2(compressed, 'uploads/characters');
    return publicUrl;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);
    setError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const parsedAge = age.trim() ? parseInt(age, 10) : null;

    const input = {
      campaignId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      race: race.trim(),
      characterClass: characterClass.trim(),
      age: parsedAge,
      location: location.trim(),
      link: link.trim(),
      picture,
      pictureCrop: pictureCrop
        ? {
            x: pictureCrop.x,
            y: pictureCrop.y,
            width: pictureCrop.width,
            height: pictureCrop.height,
          }
        : null,
      sessionId: sessionId || undefined,
      sessions: selectedSessions,
      notes,
      gmNotes,
      tags,
      isPublic,
    };

    let success = false;
    if (isEdit && characterId) {
      const result = await update({ ...input, id: characterId });
      success = !!result;
    } else {
      const result = await create(input);
      success = !!result;
    }

    if (success) {
      onClose();
    } else {
      setError(`Failed to ${isEdit ? 'update' : 'create'} character. Please try again.`);
    }
  };

  const handleDelete = async () => {
    if (!characterId) return;
    setError(null);
    const result = await remove({ id: characterId, campaignId });
    if (result) {
      onClose();
    } else {
      setError('Failed to delete character. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  const handleSessionToggle = useCallback((sessId: string) => {
    setSelectedSessions((prev) =>
      prev.includes(sessId) ? prev.filter((s) => s !== sessId) : [...prev, sessId]
    );
  }, []);

  if (!isOpen) return null;

  const isLoadingCharacter = !!(isEdit && isFetchingCharacter);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingCharacter || isSaving || isDeleting;

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
        aria-labelledby="character-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="character-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Character' : 'Create Character'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {isEdit && characterId && (
              <ShowOnTabletopButton
                campaignId={campaignId}
                collection="character"
                documentId={characterId}
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

          {isLoadingCharacter ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading character...</p>
            </div>
          ) : (
            <>
              {/* Picture upload */}
              <ImageCropInput
                imageUrl={picture}
                crop={pictureCrop}
                onImageChange={setPicture}
                onCropChange={setPictureCrop}
                onUpload={handleUpload}
                disabled={isDisabled}
              />

              {/* First Name + Last Name */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormInput
                  label="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  error={fieldErrors.firstName}
                  required
                  disabled={isDisabled}
                  placeholder="First name"
                />
                <FormInput
                  label="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  error={fieldErrors.lastName}
                  required
                  disabled={isDisabled}
                  placeholder="Last name"
                />
              </div>

              {/* Race + Class */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <FormInput
                    label="Race"
                    value={race}
                    onChange={(e) => setRace(e.target.value)}
                    disabled={isDisabled}
                    placeholder="e.g. Half-Elf"
                    list={raceDatalistId}
                  />
                  <datalist id={raceDatalistId}>
                    {races.map((r) => (
                      <option key={r.id} value={r.title} />
                    ))}
                  </datalist>
                </div>
                <FormInput
                  label="Class"
                  value={characterClass}
                  onChange={(e) => setCharacterClass(e.target.value)}
                  disabled={isDisabled}
                  placeholder="e.g. Ranger / Druid"
                />
              </div>

              {/* Age + Location */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormInput
                  label="Age"
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  disabled={isDisabled}
                  placeholder="Age"
                />
                <FormInput
                  label="Location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={isDisabled}
                  placeholder="Current residence"
                />
              </div>

              {/* Link */}
              <FormInput
                label="Link"
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                error={fieldErrors.link}
                disabled={isDisabled}
                placeholder="https://..."
              />

              {/* Session Introduced */}
              <FormSelect
                label="Session Introduced"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                options={sessionOptions}
                disabled={isDisabled}
              />

              {/* Sessions Appeared In — chip multi-select */}
              <SessionMultiSelect
                sessions={sessions}
                selectedSessions={selectedSessions}
                onToggle={handleSessionToggle}
                disabled={isDisabled}
              />

              {/* Notes */}
              <MarkdownEditor
                label="Notes"
                value={notes}
                onChange={setNotes}
                placeholder="Public details about this character..."
                disabled={isDisabled}
                minHeight="120px"
                id="character-notes-editor"
              />

              {/* GM Notes */}
              <MarkdownEditor
                label={
                  <span>
                    GM Notes{' '}
                    <span className="text-amber-500 text-[10px] font-normal">
                      (only visible to GM)
                    </span>
                  </span>
                }
                value={gmNotes}
                onChange={setGmNotes}
                placeholder="Secret GM-only notes..."
                disabled={isDisabled}
                minHeight="120px"
                id="character-gmnotes-editor"
              />

              {/* Tags */}
              <div>
                <label
                  htmlFor="character-tags-input"
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
                  id="character-tags-input"
                />
                <p className="text-xs text-slate-700 mt-1.5">
                  Press Enter or comma to add. Suggestions appear as you type.
                </p>
              </div>

              {/* Visibility */}
              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="character-visibility"
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
                    name="character-visibility"
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
            </>
          )}
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] bg-white/[0.01] shrink-0">
          <div>
            {isEdit && !showDeleteConfirm && (
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
            {isEdit && showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-400 font-semibold">Delete this character?</span>
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
                : isLoadingCharacter
                  ? 'Loading...'
                  : isEdit
                    ? 'Update Character'
                    : 'Create Character'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
