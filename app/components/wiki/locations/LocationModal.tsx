import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Globe, Lock } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import {
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
  useLocation,
} from '~/hooks/useLocations';
import { useLocationTypes } from '~/hooks/useLocationTypes';
import { useLocations } from '~/hooks/useLocations';
import { useCampaign } from '~/hooks/useCampaigns';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';

interface LocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  locationId?: string;
}

interface FieldErrors {
  name?: string;
  locationType?: string;
}

export function LocationModal({ isOpen, onClose, campaignId, locationId }: LocationModalProps) {
  const isEdit = !!locationId;
  const { location: fetchedLocation, isLoading: isFetchingLocation } = useLocation(
    locationId ?? '',
    campaignId
  );
  const { create, isLoading: isCreating } = useCreateLocation();
  const { update, isLoading: isUpdating } = useUpdateLocation();
  const { remove, isLoading: isDeleting } = useDeleteLocation();
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;
  const { locationTypes } = useLocationTypes(campaignId);
  const { locations: allLocations } = useLocations(campaignId);

  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState('');
  const [description, setDescription] = useState('');
  const [gmNotes, setGmNotes] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [parentLocations, setParentLocations] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Reset form when switching locationId or opening the modal
  useEffect(() => {
    setName('');
    setLocationType('');
    setDescription('');
    setGmNotes('');
    setIsPublic(true);
    setParentLocations([]);
    setTags([]);
    setError(null);
    setFieldErrors({});
    setHasSubmitted(false);
    setShowDeleteConfirm(false);
  }, [locationId, isOpen]);

  // Populate form once the fetched location resolves in edit mode
  useEffect(() => {
    if (locationId && fetchedLocation) {
      setName(fetchedLocation.name);
      setLocationType(fetchedLocation.locationType);
      setDescription(fetchedLocation.description);
      setGmNotes(fetchedLocation.gmNotes);
      setIsPublic(fetchedLocation.isPublic);
      setParentLocations(fetchedLocation.parentLocations);
      setTags(fetchedLocation.tags);
    }
  }, [locationId, fetchedLocation]);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Location name is required';
    if (!locationType) errors.locationType = 'Location type is required';
    return errors;
  }, [name, locationType]);

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
      name: name.trim(),
      locationType,
      description: description.trim(),
      gmNotes: gmNotes.trim(),
      isPublic,
      parentLocations,
      tags,
    };

    let success = false;
    if (locationId) {
      const result = await update({ ...input, id: locationId });
      success = !!result;
    } else {
      const result = await create(input);
      success = !!result;
    }

    if (success) {
      onClose();
    } else {
      setError('Failed to save location. Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!locationId) return;
    setError(null);
    const result = await remove({ id: locationId, campaignId });
    if (result) {
      onClose();
    } else {
      setError('Failed to delete location. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  const isLoadingLocation = !!(locationId && isFetchingLocation);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingLocation || isSaving || isDeleting;

  // Filter out current location from parent options to prevent self-referencing
  const parentOptions = allLocations.filter((l) => l.id !== locationId);

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
        aria-labelledby="location-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="location-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Location' : 'Create Location'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {isEdit && locationId && (
              <ShowOnTabletopButton
                campaignId={campaignId}
                collection="location"
                documentId={locationId}
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

          <FormInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Waterdeep"
            disabled={isDisabled}
            error={fieldErrors.name}
          />

          {/* Location Type */}
          <div>
            <label
              htmlFor="location-type-select"
              className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
            >
              Location Type
            </label>
            <select
              id="location-type-select"
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
              disabled={isDisabled}
              className="w-full bg-[#080A12] border border-white/[0.07] rounded px-3 py-2 font-sans font-semibold text-xs text-white outline-none focus:border-blue-500/50 transition-colors"
            >
              <option value="">Select a type...</option>
              {locationTypes.map((lt) => (
                <option key={lt.id} value={lt.name}>
                  {lt.name}
                </option>
              ))}
            </select>
            {fieldErrors.locationType && (
              <p className="text-xs text-rose-400 mt-1">{fieldErrors.locationType}</p>
            )}
          </div>

          <MarkdownEditor
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Describe this location..."
            disabled={isDisabled}
            minHeight="10rem"
            id="location-description-editor"
          />

          {isGM && (
            <MarkdownEditor
              label="GM Notes"
              value={gmNotes}
              onChange={setGmNotes}
              placeholder="Private notes only visible to GMs..."
              disabled={isDisabled}
              minHeight="8rem"
              id="location-gm-notes-editor"
            />
          )}

          {/* Parent Locations */}
          <div>
            <label
              htmlFor="location-parents"
              className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
            >
              Parent Locations
            </label>
            <select
              id="location-parents"
              multiple
              value={parentLocations}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                setParentLocations(selected);
              }}
              disabled={isDisabled}
              className="w-full bg-[#080A12] border border-white/[0.07] rounded px-3 py-2 font-sans font-semibold text-xs text-white outline-none focus:border-blue-500/50 transition-colors min-h-[4rem]"
            >
              {parentOptions.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.locationType})
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-700 mt-1.5">
              Hold Ctrl/Cmd to select multiple. Leave empty for top-level.
            </p>
          </div>

          {/* Tags */}
          <div>
            <label
              htmlFor="location-tags-input"
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
              id="location-tags-input"
            />
            <p className="text-xs text-slate-700 mt-1.5">
              Press Enter or comma to add. Suggestions appear as you type.
            </p>
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="location-visibility"
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
                name="location-visibility"
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
            {locationId && !showDeleteConfirm && (
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
            {locationId && showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-400 font-semibold">Delete this location?</span>
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
                : isLoadingLocation
                  ? 'Loading...'
                  : locationId
                    ? 'Update Location'
                    : 'Create Location'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
