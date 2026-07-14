import { useState } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import {
  useMembershipsForOrg,
  useAddMembership,
  useUpdateMembership,
  useRemoveMembership,
} from '~/hooks/useOrganizations';
import { OrganizationMembershipModal, type MembershipDraft } from './OrganizationMembershipModal';

interface Props {
  campaignId: string;
  organizationId: string;
  isGM: boolean;
  canManage: boolean;
}

export function OrganizationMembersEditor({ campaignId, organizationId, isGM, canManage }: Props) {
  const { memberships } = useMembershipsForOrg(campaignId, organizationId);
  const { mutate: add } = useAddMembership();
  const { mutate: update } = useUpdateMembership();
  const { mutate: remove } = useRemoveMembership();

  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null);

  const editing = modal?.mode === 'edit' ? memberships.find((m) => m.id === modal.id) : undefined;
  const excludeKeys = memberships.map((m) => `${m.memberKind}:${m.memberId}`);

  const handleSave = async (draft: MembershipDraft) => {
    if (modal?.mode === 'edit' && modal.id) {
      await update({
        campaignId,
        id: modal.id,
        title: draft.title,
        publicNotes: draft.publicNotes,
        privateNotes: draft.privateNotes,
      });
    } else {
      await add({
        campaignId,
        organizationId,
        memberKind: draft.memberKind,
        memberId: draft.memberId,
        title: draft.title,
        publicNotes: draft.publicNotes,
        privateNotes: draft.privateNotes,
      });
    }
    setModal(null);
  };

  return (
    <div className="space-y-2" data-testid="organization-members-editor">
      <div className="flex items-center justify-between">
        <span className="block text-xs font-semibold text-slate-400 tracking-wide">Members</span>
        {canManage && (
          <button
            type="button"
            onClick={() => setModal({ mode: 'add' })}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add member
          </button>
        )}
      </div>

      {memberships.length === 0 && <p className="text-xs text-slate-500">No members yet.</p>}

      {memberships.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-200 truncate">
              {m.memberLabel || 'Unknown'}
            </p>
            {m.title && <p className="text-[11px] text-blue-400 truncate">{m.title}</p>}
          </div>
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/[0.05] text-slate-400 border border-white/10 capitalize">
            {m.memberKind}
          </span>
          {canManage && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setModal({ mode: 'edit', id: m.id })}
                aria-label={`Edit ${m.memberLabel}`}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => remove({ id: m.id, campaignId })}
                aria-label={`Remove ${m.memberLabel}`}
                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-white/[0.05] transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}

      {modal && (
        <OrganizationMembershipModal
          campaignId={campaignId}
          isGM={isGM}
          mode={modal.mode}
          existing={
            editing
              ? {
                  memberKind: editing.memberKind,
                  memberId: editing.memberId,
                  memberLabel: editing.memberLabel,
                  title: editing.title,
                  publicNotes: editing.publicNotes,
                  privateNotes: editing.privateNotes,
                }
              : undefined
          }
          excludeKeys={modal.mode === 'add' ? excludeKeys : []}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
