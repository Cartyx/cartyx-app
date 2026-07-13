import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useCharacters } from '~/hooks/useCharacters';
import { usePlayers } from '~/hooks/usePlayers';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import type { MemberKind } from '~/types/organization';

export interface MembershipDraft {
  memberKind: MemberKind;
  memberId: string;
  title: string;
  publicNotes: string;
  privateNotes: string;
}

interface Props {
  campaignId: string;
  isGM: boolean;
  mode: 'add' | 'edit';
  /** Present in edit mode; the member cannot be changed when editing. */
  existing?: MembershipDraft & { memberLabel: string };
  /** memberKind+memberId already taken, excluded from the add picker. */
  excludeKeys?: string[];
  onSave: (draft: MembershipDraft) => void;
  onClose: () => void;
}

export function OrganizationMembershipModal({
  campaignId,
  isGM,
  mode,
  existing,
  excludeKeys = [],
  onSave,
  onClose,
}: Props) {
  const { characters } = useCharacters(campaignId);
  const { players } = usePlayers(campaignId);

  const [memberKind, setMemberKind] = useState<MemberKind>(existing?.memberKind ?? 'character');
  const [memberId, setMemberId] = useState(existing?.memberId ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [publicNotes, setPublicNotes] = useState(existing?.publicNotes ?? '');
  const [privateNotes, setPrivateNotes] = useState(existing?.privateNotes ?? '');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const candidates = useMemo(() => {
    const excl = new Set(excludeKeys);
    const list =
      memberKind === 'character'
        ? characters.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`.trim() }))
        : players.map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}`.trim() }));
    return list.filter((x) => !excl.has(`${memberKind}:${x.id}`));
  }, [memberKind, characters, players, excludeKeys]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId) return;
    onSave({ memberKind, memberId, title: title.trim(), publicNotes, privateNotes });
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
        aria-labelledby="org-membership-modal-title"
        className="w-full max-w-md bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="org-membership-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {mode === 'add' ? 'Add Member' : 'Edit Member'}
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
          {mode === 'edit' && existing ? (
            <div className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-slate-300">
              {existing.memberLabel}
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-shrink-0">
                <label htmlFor="org-member-kind" className="block text-[11px] text-slate-500 mb-1">
                  Type
                </label>
                <select
                  id="org-member-kind"
                  value={memberKind}
                  onChange={(e) => {
                    setMemberKind(e.target.value as MemberKind);
                    setMemberId('');
                  }}
                  className="bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm appearance-none cursor-pointer"
                >
                  <option value="character" className="bg-[#0D1117]">
                    Character
                  </option>
                  <option value="player" className="bg-[#0D1117]">
                    Player
                  </option>
                </select>
              </div>
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="org-member-entity"
                  className="block text-[11px] text-slate-500 mb-1"
                >
                  Member
                </label>
                <select
                  id="org-member-entity"
                  aria-label="Member to add"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  disabled={candidates.length === 0}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm appearance-none cursor-pointer disabled:opacity-50"
                >
                  <option value="" className="bg-[#0D1117]">
                    {candidates.length === 0 ? `No ${memberKind}s` : `Select ${memberKind}…`}
                  </option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id} className="bg-[#0D1117]">
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="org-member-title"
              className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
            >
              Title
            </label>
            <input
              id="org-member-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Guildmaster, Informant (optional)"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none transition-colors"
            />
          </div>

          <MarkdownEditor
            label="Public relationship notes"
            value={publicNotes}
            onChange={setPublicNotes}
            placeholder="Public notes about this member's relationship to the org..."
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
            disabled={!memberId}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {mode === 'add' ? 'Add Member' : 'Save Changes'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
