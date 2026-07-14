import React, { useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Globe, Lock } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';
import { useModalForm } from '~/hooks/useModalForm';
import { useCampaign } from '~/hooks/useCampaigns';
import { useCharacters } from '~/hooks/useCharacters';
import { usePlayers } from '~/hooks/usePlayers';
import { useOrganizations } from '~/hooks/useOrganizations';
import {
  useQuest,
  useQuests,
  useCreateQuest,
  useUpdateQuest,
  useDeleteQuest,
} from '~/hooks/useQuests';
import { QuestLinksEditor } from './QuestLinksEditor';
import { QuestEventsEditor } from './QuestEventsEditor';
import { uploadToR2 } from '~/utils/uploadToR2';
import { compressImage } from '~/utils/compressImage';
import type {
  QuestImage,
  QuestStatus,
  QuestGiverKind,
  QuestLinkInput,
  QuestEventLinkInput,
} from '~/types/quest';

interface QuestModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  questId?: string;
}

interface FieldErrors {
  name?: string;
}

const STATUS_OPTIONS: { value: QuestStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const GIVER_KIND_LABELS: Record<QuestGiverKind, string> = {
  character: 'Character',
  player: 'Player',
  organization: 'Organization',
};

export function QuestModal({ isOpen, onClose, campaignId, questId }: QuestModalProps) {
  const isEdit = !!questId;

  const { quest: existing, isLoading: isFetching } = useQuest(questId ?? '', campaignId);
  const { create, isLoading: isCreating } = useCreateQuest();
  const { update, isLoading: isUpdating } = useUpdateQuest();
  const { remove, isLoading: isDeleting } = useDeleteQuest();
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const { characters } = useCharacters(campaignId);
  const { players } = usePlayers(campaignId);
  const { organizations } = useOrganizations(campaignId);
  const { quests } = useQuests(campaignId);

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState<QuestStatus>('not_started');
  const [publicInfo, setPublicInfo] = useState('');
  const [privateInfo, setPrivateInfo] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [images, setImages] = useState<QuestImage[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [giverKind, setGiverKind] = useState<QuestGiverKind>('character');
  const [giverId, setGiverId] = useState('');
  const [parentQuestId, setParentQuestId] = useState('');
  const [links, setLinks] = useState<QuestLinkInput[]>([]);
  const [events, setEvents] = useState<QuestEventLinkInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const giverCandidates = useMemo<{ id: string; label: string }[]>(() => {
    switch (giverKind) {
      case 'character':
        return characters.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`.trim() }));
      case 'player':
        return players.map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}`.trim() }));
      case 'organization':
        return organizations.map((o) => ({ id: o.id, label: o.name }));
    }
  }, [giverKind, characters, players, organizations]);

  const parentQuestOptions = useMemo(
    () => quests.filter((q) => q.id !== questId),
    [quests, questId]
  );

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Name is required';
    return errors;
  }, [name]);

  const { fieldErrors, runValidation } = useModalForm({
    isOpen,
    onClose,
    recordId: questId,
    isEdit,
    record: existing,
    reset: () => {
      setName('');
      setType('');
      setStatus('not_started');
      setPublicInfo('');
      setPrivateInfo('');
      setIsPublic(false);
      setImages([]);
      setTags([]);
      setGiverKind('character');
      setGiverId('');
      setParentQuestId('');
      setLinks([]);
      setEvents([]);
      setError(null);
      setShowDeleteConfirm(false);
    },
    populate: (q) => {
      setName(q.name);
      setType(q.type);
      setStatus(q.status);
      setPublicInfo(q.publicInfo);
      setPrivateInfo(q.privateInfo);
      setIsPublic(q.isPublic);
      setImages(q.images);
      setTags(q.tags);
      setGiverKind(q.giver?.kind ?? 'character');
      setGiverId(q.giver?.id ?? '');
      setParentQuestId(q.parentQuestId ?? '');
      setLinks(
        q.links.map((l) => ({
          kind: l.kind,
          id: l.id,
          role: l.role,
          publicInfo: l.publicInfo,
          privateInfo: l.privateInfo,
        }))
      );
      setEvents(
        q.events.map((ev) => ({
          eventId: ev.eventId,
          role: ev.role,
          publicInfo: ev.publicInfo,
          privateInfo: ev.privateInfo,
        }))
      );
    },
    validate,
  });

  const handleAddImage = useCallback(async (file: File) => {
    setIsUploadingImage(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const { publicUrl } = await uploadToR2(compressed, 'uploads/quests');
      const newImage: QuestImage = { url: publicUrl, caption: '', crop: null };
      setImages((prev) => [...prev, newImage]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image upload failed');
    } finally {
      setIsUploadingImage(false);
    }
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleAddImage(file);
      // Reset input so same file can be re-selected
      e.target.value = '';
    },
    [handleAddImage]
  );

  const handleGiverKindChange = (kind: QuestGiverKind) => {
    setGiverKind(kind);
    setGiverId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.keys(runValidation()).length > 0) return;
    setError(null);

    const payload = {
      campaignId,
      name,
      type,
      status,
      publicInfo,
      privateInfo,
      isPublic,
      giver: giverId ? { kind: giverKind, id: giverId } : null,
      parentQuestId: parentQuestId || null,
      links,
      events,
      images: images.map((img) => ({
        url: img.url,
        caption: img.caption,
        crop: img.crop,
      })),
      tags,
    };

    const result =
      isEdit && questId ? await update({ ...payload, id: questId }) : await create(payload);

    if (result) onClose();
    else setError(`Failed to ${isEdit ? 'update' : 'create'} quest. Please try again.`);
  };

  const handleDelete = async () => {
    if (!questId) return;
    setError(null);
    const result = await remove({ id: questId, campaignId });
    if (result) onClose();
    else {
      setError('Failed to delete quest. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  const isLoadingQuest = !!(isEdit && isFetching);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingQuest || isSaving || isDeleting || isUploadingImage;

  const selectClass =
    'w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50 transition-all appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quest-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="quest-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Quest' : 'Create Quest'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {isEdit && questId && (
              <ShowOnTabletopButton
                campaignId={campaignId}
                collection="quest"
                documentId={questId}
                isGM={isGM}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="text-slate-500 hover:text-white transition-colors"
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

          {isLoadingQuest ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading quest...</p>
            </div>
          ) : (
            <>
              <FormInput
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={fieldErrors.name}
                required
                disabled={isDisabled}
                placeholder="e.g. Goblin Arrows"
              />

              <FormInput
                label="Type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                disabled={isDisabled}
                placeholder="e.g. Main, Side, Personal"
              />

              {/* Status */}
              <div>
                <label
                  htmlFor="quest-status"
                  className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
                >
                  Status
                </label>
                <select
                  id="quest-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as QuestStatus)}
                  disabled={isDisabled}
                  className={selectClass}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value} className="bg-[#0D1117]">
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Giver */}
              <div>
                <span className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                  Quest giver
                </span>
                <div className="flex items-end gap-2">
                  <div className="flex-shrink-0">
                    <label
                      htmlFor="quest-giver-kind"
                      className="block text-[11px] text-slate-500 mb-1"
                    >
                      Type
                    </label>
                    <select
                      id="quest-giver-kind"
                      value={giverKind}
                      onChange={(e) => handleGiverKindChange(e.target.value as QuestGiverKind)}
                      disabled={isDisabled}
                      className={selectClass}
                    >
                      {(Object.keys(GIVER_KIND_LABELS) as QuestGiverKind[]).map((k) => (
                        <option key={k} value={k} className="bg-[#0D1117]">
                          {GIVER_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor="quest-giver-entity"
                      className="block text-[11px] text-slate-500 mb-1"
                    >
                      Giver
                    </label>
                    <select
                      id="quest-giver-entity"
                      aria-label="Quest giver"
                      value={giverId}
                      onChange={(e) => setGiverId(e.target.value)}
                      disabled={isDisabled || giverCandidates.length === 0}
                      className={selectClass}
                    >
                      <option value="" className="bg-[#0D1117]">
                        {giverCandidates.length === 0
                          ? `No ${GIVER_KIND_LABELS[giverKind].toLowerCase()}s`
                          : `Select ${GIVER_KIND_LABELS[giverKind].toLowerCase()}…`}
                      </option>
                      {giverCandidates.map((c) => (
                        <option key={c.id} value={c.id} className="bg-[#0D1117]">
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGiverId('')}
                    disabled={isDisabled || !giverId}
                    className="flex-shrink-0 px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Parent quest */}
              <div>
                <label
                  htmlFor="quest-parent"
                  className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
                >
                  Parent quest
                </label>
                <select
                  id="quest-parent"
                  value={parentQuestId}
                  onChange={(e) => setParentQuestId(e.target.value)}
                  disabled={isDisabled}
                  className={selectClass}
                >
                  <option value="" className="bg-[#0D1117]">
                    None
                  </option>
                  {parentQuestOptions.map((q) => (
                    <option key={q.id} value={q.id} className="bg-[#0D1117]">
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Visibility toggle */}
              <div className="flex items-center gap-4">
                <label
                  className={`flex items-center gap-2 ${isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="quest-visibility"
                    checked={!isPublic}
                    onChange={() => setIsPublic(false)}
                    disabled={isDisabled}
                    className="sr-only"
                  />
                  <div
                    className={`h-8 px-3 rounded-lg border flex items-center gap-2 transition-all text-xs ${!isPublic ? 'bg-blue-600/10 border-blue-500/50 text-blue-300' : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20'}`}
                  >
                    <Lock className="h-3 w-3" />
                    <span className="font-bold">Private (GM only)</span>
                  </div>
                </label>
                <label
                  className={`flex items-center gap-2 ${isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="quest-visibility"
                    checked={isPublic}
                    onChange={() => setIsPublic(true)}
                    disabled={isDisabled}
                    className="sr-only"
                  />
                  <div
                    className={`h-8 px-3 rounded-lg border flex items-center gap-2 transition-all text-xs ${isPublic ? 'bg-emerald-600/10 border-emerald-500/50 text-emerald-300' : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20'}`}
                  >
                    <Globe className="h-3 w-3" />
                    <span className="font-bold">Public</span>
                  </div>
                </label>
              </div>

              <MarkdownEditor
                label="Public info"
                value={publicInfo}
                onChange={setPublicInfo}
                placeholder="Public description of this quest..."
                disabled={isDisabled}
                minHeight="200px"
              />

              {isGM && (
                <MarkdownEditor
                  label="Private info (GM only)"
                  value={privateInfo}
                  onChange={setPrivateInfo}
                  placeholder="GM-only notes about this quest..."
                  disabled={isDisabled}
                  minHeight="200px"
                />
              )}

              {/* Images */}
              <div>
                <span className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                  Images
                </span>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-3">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative group">
                        <img
                          src={img.url}
                          alt={img.caption || `Quest image ${idx + 1}`}
                          className="w-20 h-20 object-cover rounded-lg border border-white/10"
                        />
                        {!isDisabled && (
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(idx)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 flex items-center justify-center hover:bg-rose-500 transition-colors"
                            aria-label={`Remove image ${idx + 1}`}
                          >
                            <X className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <label
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${isDisabled || isUploadingImage ? 'opacity-50 cursor-not-allowed border-white/10 text-slate-500' : 'border-white/10 text-slate-300 hover:border-blue-500/50 hover:text-blue-300'}`}
                >
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={handleImageFileChange}
                    disabled={isDisabled || isUploadingImage}
                    className="hidden"
                  />
                  {isUploadingImage ? 'Uploading...' : 'Add image'}
                </label>
                <p className="text-xs text-slate-700 mt-1.5">JPG, PNG, or WebP. Max 5MB.</p>
              </div>

              <TagAutocompleteInput
                campaignId={campaignId}
                selectedTags={tags}
                onTagsChange={setTags}
                disabled={isDisabled}
              />

              <QuestLinksEditor
                campaignId={campaignId}
                links={links}
                onChange={setLinks}
                isGM={isGM}
                disabled={isDisabled}
              />

              <QuestEventsEditor
                campaignId={campaignId}
                events={events}
                onChange={setEvents}
                isGM={isGM}
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
                  <span className="text-xs text-rose-400 font-semibold">Delete this quest?</span>
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
              {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Quest'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
