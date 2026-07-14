import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Globe, Lock } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';
import { useModalForm } from '~/hooks/useModalForm';
import { useCampaign } from '~/hooks/useCampaigns';
import {
  useOrganization,
  useCreateOrganization,
  useUpdateOrganization,
  useDeleteOrganization,
} from '~/hooks/useOrganizations';
import { OrganizationLocationsEditor } from './OrganizationLocationsEditor';
import { OrganizationMembersEditor } from './OrganizationMembersEditor';
import { EntityQuestsTab } from '~/components/shared/EntityQuestsTab';
import { uploadToR2 } from '~/utils/uploadToR2';
import { compressImage } from '~/utils/compressImage';
import type { OrganizationLocationLinkInput, OrganizationImage } from '~/types/organization';

interface OrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  organizationId?: string;
}

interface FieldErrors {
  name?: string;
}

export function OrganizationModal({
  isOpen,
  onClose,
  campaignId,
  organizationId,
}: OrganizationModalProps) {
  const isEdit = !!organizationId;

  const { organization: existing, isLoading: isFetching } = useOrganization(
    organizationId ?? '',
    campaignId
  );
  const { create, isLoading: isCreating } = useCreateOrganization();
  const { update, isLoading: isUpdating } = useUpdateOrganization();
  const { remove, isLoading: isDeleting } = useDeleteOrganization();
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [name, setName] = useState('');
  const [publicInfo, setPublicInfo] = useState('');
  const [privateInfo, setPrivateInfo] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [images, setImages] = useState<OrganizationImage[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [locations, setLocations] = useState<OrganizationLocationLinkInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Name is required';
    return errors;
  }, [name]);

  const { fieldErrors, runValidation } = useModalForm({
    isOpen,
    onClose,
    recordId: organizationId,
    isEdit,
    record: existing,
    reset: () => {
      setName('');
      setPublicInfo('');
      setPrivateInfo('');
      setIsPublic(false);
      setImages([]);
      setTags([]);
      setLocations([]);
      setError(null);
      setShowDeleteConfirm(false);
    },
    populate: (org) => {
      setName(org.name);
      setPublicInfo(org.publicInfo);
      setPrivateInfo(org.privateInfo);
      setIsPublic(org.isPublic);
      setImages(org.images);
      setTags(org.tags);
      setLocations(
        org.locations.map((l) => ({
          locationId: l.locationId,
          label: l.label,
          publicInfo: l.publicInfo,
          privateInfo: l.privateInfo,
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
      const { publicUrl } = await uploadToR2(compressed, 'uploads/organizations');
      const newImage: OrganizationImage = { url: publicUrl, caption: '', crop: null };
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
    if (Object.keys(runValidation()).length > 0) return;
    setError(null);

    const payload = {
      campaignId,
      name,
      publicInfo,
      privateInfo,
      isPublic,
      images: images.map((img) => ({
        url: img.url,
        caption: img.caption,
        crop: img.crop,
      })),
      tags,
      locations: locations.map((l) => ({
        locationId: l.locationId,
        publicInfo: l.publicInfo,
        privateInfo: l.privateInfo,
      })),
    };

    const result =
      isEdit && organizationId
        ? await update({ ...payload, id: organizationId })
        : await create(payload);

    if (result) onClose();
    else setError(`Failed to ${isEdit ? 'update' : 'create'} organization. Please try again.`);
  };

  const handleDelete = async () => {
    if (!organizationId) return;
    setError(null);
    const result = await remove({ id: organizationId, campaignId });
    if (result) onClose();
    else {
      setError('Failed to delete organization. Please try again.');
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  const isLoadingOrg = !!(isEdit && isFetching);
  const isSaving = isCreating || isUpdating;
  const isDisabled = isLoadingOrg || isSaving || isDeleting || isUploadingImage;

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
        aria-labelledby="organization-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="organization-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Organization' : 'Create Organization'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {isEdit && organizationId && (
              <ShowOnTabletopButton
                campaignId={campaignId}
                collection="organization"
                documentId={organizationId}
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

          {isLoadingOrg ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading organization...</p>
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
                placeholder="e.g. The Thieves' Guild"
              />

              {/* Visibility toggle */}
              <div className="flex items-center gap-4">
                <label
                  className={`flex items-center gap-2 ${isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="org-visibility"
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
                    name="org-visibility"
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
                placeholder="Public description of this organization..."
                disabled={isDisabled}
                minHeight="200px"
              />

              {isGM && (
                <MarkdownEditor
                  label="Private info (GM only)"
                  value={privateInfo}
                  onChange={setPrivateInfo}
                  placeholder="GM-only notes about this organization..."
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
                          alt={img.caption || `Organization image ${idx + 1}`}
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

              <OrganizationLocationsEditor
                campaignId={campaignId}
                value={locations}
                onChange={setLocations}
                isGM={isGM}
                disabled={isDisabled}
              />

              {isEdit && organizationId ? (
                <OrganizationMembersEditor
                  campaignId={campaignId}
                  organizationId={organizationId}
                  isGM={isGM}
                  canManage={existing?.canEdit ?? false}
                />
              ) : (
                <p className="text-xs text-slate-500">
                  Save the organization first to add members.
                </p>
              )}

              {isEdit && organizationId && (
                <div>
                  <span className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                    Linked Quests
                  </span>
                  <EntityQuestsTab
                    campaignId={campaignId}
                    kind="organization"
                    id={organizationId}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] shrink-0 gap-3">
          {isEdit && (
            <div className="flex items-center gap-2">
              {showDeleteConfirm ? (
                <>
                  <span className="text-xs text-rose-400 font-semibold">
                    Delete this organization?
                  </span>
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
              {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Organization'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
