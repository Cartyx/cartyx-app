import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Globe, Lock } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { LoreLinksEditor } from '~/components/wiki/lore/LoreLinksEditor';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';
import { useLoreEntry, useCreateLore, useUpdateLore } from '~/hooks/useLore';
import { useCampaign } from '~/hooks/useCampaigns';
import { useModalForm } from '~/hooks/useModalForm';
import { uploadToR2 } from '~/utils/uploadToR2';
import { compressImage } from '~/utils/compressImage';
import type { LoreLink, LoreImage } from '~/types/lore';

interface LoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  loreId?: string;
  initialLinks?: LoreLink[];
}

interface FieldErrors {
  title?: string;
}

export function LoreModal({ isOpen, onClose, campaignId, loreId, initialLinks }: LoreModalProps) {
  const isEdit = !!loreId;

  const { lore: existingLore, isLoading: isFetchingLore } = useLoreEntry(loreId ?? '', campaignId);
  const { create, isLoading: isCreating } = useCreateLore();
  const { update, isLoading: isUpdating } = useUpdateLore();
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [gmContent, setGmContent] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [images, setImages] = useState<LoreImage[]>([]);
  const [links, setLinks] = useState<LoreLink[]>(initialLinks ?? []);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = 'Title is required';
    return errors;
  }, [title]);

  const { fieldErrors, runValidation } = useModalForm({
    isOpen,
    onClose,
    recordId: loreId,
    isEdit,
    record: existingLore,
    reset: () => {
      setTitle('');
      setContent('');
      setGmContent('');
      setIsPublic(false);
      setImages([]);
      setLinks(initialLinks ?? []);
      setTags([]);
      setError(null);
    },
    populate: (l) => {
      setTitle(l.title);
      setContent(l.content);
      setGmContent(l.gmContent);
      setIsPublic(l.isPublic);
      setImages(l.images);
      setLinks(l.links);
      setTags(l.tags);
    },
    validate,
  });

  const handleAddImage = useCallback(async (file: File) => {
    setIsUploadingImage(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const { publicUrl } = await uploadToR2(compressed, 'uploads/lore');
      const newImage: LoreImage = { url: publicUrl, caption: '', crop: null };
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const errors = runValidation();
    if (Object.keys(errors).length > 0) return;

    const input = {
      campaignId,
      title: title.trim(),
      content,
      gmContent: isGM ? gmContent : undefined,
      isPublic,
      images: images.map((img) => ({
        url: img.url,
        caption: img.caption,
        crop: img.crop,
      })),
      links: links.map((l) => ({ kind: l.kind, id: l.id })),
      tags,
    };

    let success = false;
    if (isEdit && loreId) {
      const result = await update({ ...input, id: loreId });
      success = !!result;
    } else {
      const result = await create(input);
      success = !!result;
    }

    if (success) {
      onClose();
    } else {
      setError(`Failed to ${isEdit ? 'update' : 'create'} lore. Please try again.`);
    }
  };

  if (!isOpen) return null;

  const isLoadingLore = !!(isEdit && isFetchingLore);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingLore || isSaving || isUploadingImage;

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
        aria-labelledby="lore-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="lore-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Lore' : 'Create Lore'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {isEdit && loreId && (
              <ShowOnTabletopButton
                campaignId={campaignId}
                collection="lore"
                documentId={loreId}
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

          {isLoadingLore ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading lore...</p>
            </div>
          ) : (
            <>
              {/* Title */}
              <FormInput
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                error={fieldErrors.title}
                required
                disabled={isDisabled}
                placeholder="Lore entry title"
                data-testid="lore-title-input"
              />

              {/* Content */}
              <MarkdownEditor
                label="Content"
                value={content}
                onChange={setContent}
                placeholder="Public lore content..."
                disabled={isDisabled}
                minHeight="120px"
                id="lore-content-editor"
              />

              {/* GM Notes — only visible to GM */}
              {isGM && (
                <MarkdownEditor
                  label={
                    <span>
                      GM Notes{' '}
                      <span className="text-amber-500 text-[10px] font-normal">
                        (only visible to GM)
                      </span>
                    </span>
                  }
                  value={gmContent}
                  onChange={setGmContent}
                  placeholder="GM-only lore notes..."
                  disabled={isDisabled}
                  minHeight="120px"
                  id="lore-gmcontent-editor"
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
                          alt={img.caption || `Lore image ${idx + 1}`}
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

              {/* Tags */}
              <div>
                <label
                  htmlFor="lore-tags-input"
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
                  id="lore-tags-input"
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
                    name="lore-visibility"
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
                    name="lore-visibility"
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

              {/* Linked Entities */}
              <LoreLinksEditor
                campaignId={campaignId}
                links={links}
                onChange={setLinks}
                disabled={isDisabled}
              />
            </>
          )}
        </div>

        <footer className="flex items-center justify-end px-4 sm:px-6 py-4 border-t border-white/[0.07] bg-white/[0.01] shrink-0 gap-3">
          <PixelButton
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
            type="button"
          >
            Cancel
          </PixelButton>
          <PixelButton variant="primary" size="sm" disabled={isDisabled} type="submit">
            {isSaving
              ? 'Saving...'
              : isLoadingLore
                ? 'Loading...'
                : isEdit
                  ? 'Update Lore'
                  : 'Create Lore'}
          </PixelButton>
        </footer>
      </form>
    </div>,
    document.body
  );
}
