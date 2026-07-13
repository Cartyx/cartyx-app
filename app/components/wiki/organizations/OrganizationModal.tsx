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
import type { OrganizationLocationLinkInput } from '~/types/organization';

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
  const [tags, setTags] = useState<string[]>([]);
  const [locations, setLocations] = useState<OrganizationLocationLinkInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
  const isDisabled = isLoadingOrg || isSaving || isDeleting;

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
