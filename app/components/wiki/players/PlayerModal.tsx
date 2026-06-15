import React, { useState, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { ColorPicker } from '~/components/shared/ColorPicker';
import { ImageCropInput } from '~/components/wiki/characters/ImageCropInput';
import { usePlayer, useUpdatePlayer, useDeletePlayer } from '~/hooks/usePlayers';
import { useCampaign } from '~/hooks/useCampaigns';
import { useRaces } from '~/hooks/useRaces';
import { useModalForm } from '~/hooks/useModalForm';
import type { PictureCrop } from '~/types/character';
import { uploadToR2 } from '~/utils/uploadToR2';
import { compressImage } from '~/utils/compressImage';

interface PlayerModalProps {
  campaignId: string;
  playerId?: string;
  onClose: () => void;
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  link?: string;
}

export function PlayerModal({ campaignId, playerId, onClose }: PlayerModalProps) {
  const isEdit = !!playerId;
  const raceDatalistId = useId();

  const { player: existingPlayer, isLoading: isFetchingPlayer } = usePlayer(
    playerId ?? '',
    campaignId
  );
  const { update, isLoading: isUpdating } = useUpdatePlayer();
  const { remove, isLoading: isDeleting } = useDeletePlayer();
  const { campaign } = useCampaign(campaignId);
  const { races } = useRaces(campaignId, { enabled: true });

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [race, setRace] = useState('');
  const [characterClass, setCharacterClass] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [picture, setPicture] = useState('');
  const [pictureCrop, setPictureCrop] = useState<PictureCrop | null>(null);
  const [color, setColor] = useState('');
  const [eyeColor, setEyeColor] = useState('');
  const [hairColor, setHairColor] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [size, setSize] = useState('');
  const [description, setDescription] = useState('');
  const [appearance, setAppearance] = useState('');
  const [backstory, setBackstory] = useState('');
  const [gmNotes, setGmNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!firstName.trim()) errors.firstName = 'First name is required';
    if (!lastName.trim()) errors.lastName = 'Last name is required';
    if (link.trim() && !/^https?:\/\/.+/.test(link.trim())) {
      errors.link = 'Must be a valid HTTP or HTTPS URL';
    }
    return errors;
  }, [firstName, lastName, link]);

  // PlayerModal is mounted only while open (the parent renders it conditionally),
  // so `isOpen` is effectively always true: the Escape listener stays active for
  // the modal's lifetime and reset keys only off `playerId`.
  const { fieldErrors, runValidation } = useModalForm({
    isOpen: true,
    onClose,
    recordId: playerId,
    isEdit,
    record: existingPlayer,
    reset: () => {
      setFirstName('');
      setLastName('');
      setRace('');
      setCharacterClass('');
      setAge('');
      setGender('');
      setLocation('');
      setLink('');
      setPicture('');
      setPictureCrop(null);
      setColor('');
      setEyeColor('');
      setHairColor('');
      setWeight('');
      setHeight('');
      setSize('');
      setDescription('');
      setAppearance('');
      setBackstory('');
      setGmNotes('');
      setError(null);
      setShowDeleteConfirm(false);
    },
    populate: (p) => {
      setFirstName(p.firstName);
      setLastName(p.lastName);
      setRace(p.race);
      setCharacterClass(p.characterClass);
      setAge(p.age != null ? String(p.age) : '');
      setGender(p.gender);
      setLocation(p.location);
      setLink(p.link);
      setPicture(p.picture);
      setPictureCrop(p.pictureCrop);
      setColor(p.color);
      setEyeColor(p.eyeColor);
      setHairColor(p.hairColor);
      setWeight(p.weight != null ? String(p.weight) : '');
      setHeight(p.height);
      setSize(p.size);
      setDescription(p.description);
      setAppearance(p.appearance);
      setBackstory(p.backstory);
      setGmNotes(p.gmNotes);
    },
    validate,
  });

  const handleUpload = useCallback(async (file: File): Promise<string> => {
    const compressed = await compressImage(file);
    const { publicUrl } = await uploadToR2(compressed, 'uploads/players');
    return publicUrl;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const errors = runValidation();
    if (Object.keys(errors).length > 0) return;

    const parsedAge = age.trim() ? parseInt(age, 10) : 0;
    const parsedWeight = weight.trim() ? parseInt(weight, 10) : null;

    const input = {
      campaignId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      race: race.trim(),
      characterClass: characterClass.trim(),
      age: parsedAge,
      gender: gender.trim(),
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
      description,
      backstory,
      gmNotes,
      color,
      eyeColor: eyeColor.trim(),
      hairColor: hairColor.trim(),
      weight: parsedWeight,
      height: height.trim(),
      size: size.trim(),
      appearance,
    };

    let success = false;
    if (isEdit && playerId) {
      const result = await update({ ...input, id: playerId });
      success = !!result;
    }

    if (success) {
      onClose();
    } else {
      setError('Failed to update player. Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!playerId) return;
    setError(null);
    const result = await remove({ id: playerId, campaignId });
    if (result) {
      onClose();
    } else {
      setError('Failed to delete player. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  const isLoadingPlayer = !!(isEdit && isFetchingPlayer);
  const isSaving = isUpdating;
  const isDisabled = isLoadingPlayer || isSaving || isDeleting;

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
        aria-labelledby="player-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="player-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Player' : 'Create Player'}
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 min-h-0">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          {isLoadingPlayer ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading player...</p>
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

              {/* Color picker */}
              <ColorPicker
                label="Player Color"
                value={color}
                onChange={setColor}
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

              {/* Race + Class + Age */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
                <FormInput
                  label="Age"
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  disabled={isDisabled}
                  placeholder="Age"
                />
              </div>

              {/* Gender + Location */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormInput
                  label="Gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  disabled={isDisabled}
                  placeholder="Gender"
                />
                <FormInput
                  label="Location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={isDisabled}
                  placeholder="Current residence"
                />
              </div>

              {/* Eye Color + Hair Color */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormInput
                  label="Eye Color"
                  value={eyeColor}
                  onChange={(e) => setEyeColor(e.target.value)}
                  disabled={isDisabled}
                  placeholder="e.g. Blue"
                />
                <FormInput
                  label="Hair Color"
                  value={hairColor}
                  onChange={(e) => setHairColor(e.target.value)}
                  disabled={isDisabled}
                  placeholder="e.g. Auburn"
                />
              </div>

              {/* Height + Weight + Size */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <FormInput
                  label="Height"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  disabled={isDisabled}
                  placeholder={`e.g. 5'10"`}
                />
                <FormInput
                  label="Weight"
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  disabled={isDisabled}
                  placeholder="lbs"
                />
                <FormInput
                  label="Size"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  disabled={isDisabled}
                  placeholder="e.g. Medium"
                />
              </div>

              {/* External Link */}
              <FormInput
                label="External Link"
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                error={fieldErrors.link}
                disabled={isDisabled}
                placeholder="https://..."
              />

              {/* Description */}
              <MarkdownEditor
                label="Description"
                value={description}
                onChange={setDescription}
                placeholder="A brief description of this player character..."
                disabled={isDisabled}
                minHeight="120px"
                id="player-description-editor"
              />

              {/* Appearance */}
              <MarkdownEditor
                label="Appearance"
                value={appearance}
                onChange={setAppearance}
                placeholder="Physical appearance details..."
                disabled={isDisabled}
                minHeight="120px"
                id="player-appearance-editor"
              />

              {/* Backstory */}
              <MarkdownEditor
                label={
                  <span>
                    Backstory{' '}
                    <span className="text-amber-500 text-[10px] font-normal">
                      (Only you and the Game Master can see your backstory)
                    </span>
                  </span>
                }
                value={backstory}
                onChange={setBackstory}
                placeholder="Character backstory..."
                disabled={isDisabled}
                minHeight="160px"
                id="player-backstory-editor"
              />

              {/* GM Notes — only visible to GM */}
              {campaign?.isGM && (
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
                  id="player-gmnotes-editor"
                />
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] bg-white/[0.01] shrink-0">
          <div>
            {isEdit && campaign?.isGM && !showDeleteConfirm && (
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
            {isEdit && campaign?.isGM && showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-400 font-semibold">Delete this player?</span>
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
                : isLoadingPlayer
                  ? 'Loading...'
                  : isEdit
                    ? 'Update Player'
                    : 'Create Player'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
