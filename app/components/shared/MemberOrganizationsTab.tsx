import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Trash2, Plus } from 'lucide-react';
import {
  useMembershipsForMember,
  useOrganizations,
  useAddMembership,
  useUpdateMembership,
  useRemoveMembership,
} from '~/hooks/useOrganizations';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import type { MemberKind, OrganizationMembershipData } from '~/types/organization';

interface Props {
  campaignId: string;
  memberKind: MemberKind;
  memberId: string;
  isGM: boolean;
  canManage: boolean;
}

interface Draft {
  organizationId: string;
  title: string;
  publicNotes: string;
  privateNotes: string;
}

export function MemberOrganizationsTab({
  campaignId,
  memberKind,
  memberId,
  isGM,
  canManage,
}: Props) {
  const { memberships } = useMembershipsForMember(campaignId, memberKind, memberId);
  const { mutate: add } = useAddMembership();
  const { mutate: update } = useUpdateMembership();
  const { mutate: remove } = useRemoveMembership();

  const [modal, setModal] = useState<{
    mode: 'add' | 'edit';
    membership?: OrganizationMembershipData;
  } | null>(null);

  const handleSave = async (draft: Draft) => {
    if (modal?.mode === 'edit' && modal.membership) {
      await update({
        campaignId,
        id: modal.membership.id,
        title: draft.title,
        publicNotes: draft.publicNotes,
        privateNotes: draft.privateNotes,
      });
    } else {
      await add({
        campaignId,
        organizationId: draft.organizationId,
        memberKind,
        memberId,
        title: draft.title,
        publicNotes: draft.publicNotes,
        privateNotes: draft.privateNotes,
      });
    }
    setModal(null);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="member-organizations-tab">
      {canManage && (
        <button
          type="button"
          onClick={() => setModal({ mode: 'add' })}
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mb-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add to organization
        </button>
      )}

      {memberships.length === 0 && (
        <p className="text-xs text-slate-500">Not a member of any organization.</p>
      )}

      {memberships.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-200 truncate">{m.organizationName}</p>
            {m.title && <p className="text-[11px] text-blue-400 truncate">{m.title}</p>}
          </div>
          {/* Gate per-row manage buttons on this membership's own canEdit (its
              org's ownership), not the tab-level canManage — the list spans
              orgs with different ownership, so a coarse gate would show
              dead-end buttons on GM-owned orgs the viewer can't manage. */}
          {m.canEdit && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setModal({ mode: 'edit', membership: m })}
                aria-label={`Edit membership in ${m.organizationName}`}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => remove({ id: m.id, campaignId })}
                aria-label={`Remove membership in ${m.organizationName}`}
                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-white/[0.05] transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}

      {modal && (
        <MemberOrgModal
          campaignId={campaignId}
          isGM={isGM}
          mode={modal.mode}
          membership={modal.membership}
          excludeOrgIds={memberships.map((m) => m.organizationId)}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function MemberOrgModal({
  campaignId,
  isGM,
  mode,
  membership,
  excludeOrgIds,
  onSave,
  onClose,
}: {
  campaignId: string;
  isGM: boolean;
  mode: 'add' | 'edit';
  membership?: OrganizationMembershipData;
  excludeOrgIds: string[];
  onSave: (draft: Draft) => void;
  onClose: () => void;
}) {
  const { organizations } = useOrganizations(campaignId);
  const [organizationId, setOrganizationId] = useState(membership?.organizationId ?? '');
  const [title, setTitle] = useState(membership?.title ?? '');
  const [publicNotes, setPublicNotes] = useState(membership?.publicNotes ?? '');
  const [privateNotes, setPrivateNotes] = useState(membership?.privateNotes ?? '');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const available = useMemo(() => {
    const excl = new Set(excludeOrgIds);
    return organizations.filter((o) => !excl.has(o.id));
  }, [organizations, excludeOrgIds]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'add' && !organizationId) return;
    onSave({ organizationId, title: title.trim(), publicNotes, privateNotes });
  };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-org-modal-title"
        className="w-full max-w-md bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="member-org-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {mode === 'add' ? 'Add to Organization' : 'Edit Membership'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-500 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 min-h-0">
          {mode === 'edit' && membership ? (
            <div className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-slate-300">
              {membership.organizationName}
            </div>
          ) : (
            <div>
              <label
                htmlFor="member-org-select"
                className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
              >
                Organization
              </label>
              <select
                id="member-org-select"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                disabled={available.length === 0}
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="" className="bg-[#0D1117]">
                  {available.length === 0 ? 'No organizations' : 'Select organization…'}
                </option>
                {available.map((o) => (
                  <option key={o.id} value={o.id} className="bg-[#0D1117]">
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label
              htmlFor="member-org-title"
              className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
            >
              Title
            </label>
            <input
              id="member-org-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Guildmaster (optional)"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none transition-colors"
            />
          </div>
          <MarkdownEditor
            label="Public relationship notes"
            value={publicNotes}
            onChange={setPublicNotes}
            placeholder="Public notes about this membership..."
            minHeight="120px"
          />
          {isGM && (
            <MarkdownEditor
              label="Private relationship notes (GM only)"
              value={privateNotes}
              onChange={setPrivateNotes}
              placeholder="GM-only notes..."
              minHeight="120px"
            />
          )}
        </div>
        <footer className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-white/[0.07] bg-white/[0.01] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mode === 'add' && !organizationId}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {mode === 'add' ? 'Add' : 'Save Changes'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
