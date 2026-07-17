import { useState, useMemo, useId } from 'react';
import { X } from 'lucide-react';
import { useCharacters } from '~/hooks/useCharacters';
import { usePlayers } from '~/hooks/usePlayers';
import { useLocations } from '~/hooks/useLocations';
import { useOrganizations } from '~/hooks/useOrganizations';
import type { QuestLinkInput, QuestLinkKind } from '~/types/quest';

interface Candidate {
  id: string;
  label: string;
}

const KIND_LABELS: Record<QuestLinkKind, string> = {
  character: 'Character',
  player: 'Player',
  location: 'Location',
  organization: 'Organization',
};

interface Props {
  campaignId: string;
  links: QuestLinkInput[];
  onChange: (links: QuestLinkInput[]) => void;
  disabled?: boolean;
  isGM: boolean;
}

export function QuestLinksEditor({ campaignId, links, onChange, disabled, isGM }: Props) {
  const uid = useId();
  const kindSelectId = `quest-links-kind-${uid}`;
  const entitySelectId = `quest-links-entity-${uid}`;

  const [kind, setKind] = useState<QuestLinkKind>('character');
  const [selectedId, setSelectedId] = useState('');

  const { characters } = useCharacters(campaignId);
  const { players } = usePlayers(campaignId);
  const { locations } = useLocations(campaignId);
  const { organizations } = useOrganizations(campaignId);

  const candidates: Candidate[] = useMemo(() => {
    switch (kind) {
      case 'character':
        return characters.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`.trim() }));
      case 'player':
        return players.map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}`.trim() }));
      case 'location':
        return locations.map((l) => ({ id: l.id, label: l.name }));
      case 'organization':
        return organizations.map((o) => ({ id: o.id, label: o.name }));
    }
  }, [kind, characters, players, locations, organizations]);

  const labelFor = (l: QuestLinkInput): string => {
    switch (l.kind) {
      case 'character': {
        const c = characters.find((x) => x.id === l.id);
        return c ? `${c.firstName} ${c.lastName}`.trim() : l.id;
      }
      case 'player': {
        const p = players.find((x) => x.id === l.id);
        return p ? `${p.firstName} ${p.lastName}`.trim() : l.id;
      }
      case 'location':
        return locations.find((x) => x.id === l.id)?.name ?? l.id;
      case 'organization':
        return organizations.find((x) => x.id === l.id)?.name ?? l.id;
    }
  };

  const handleKindChange = (newKind: QuestLinkKind) => {
    setKind(newKind);
    setSelectedId('');
  };

  const addLink = () => {
    if (!selectedId) return;
    if (links.some((l) => l.kind === kind && l.id === selectedId)) return;
    onChange([...links, { kind, id: selectedId, role: '', publicInfo: '', privateInfo: '' }]);
    setSelectedId('');
  };

  const patch = (i: number, part: Partial<QuestLinkInput>) => {
    onChange(links.map((l, idx) => (idx === i ? { ...l, ...part } : l)));
  };
  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i));

  return (
    <div data-testid="quest-links-editor" className="space-y-3">
      <span className="block text-xs font-semibold text-slate-400 tracking-wide">
        Linked Entities
      </span>

      {links.map((l, i) => (
        <div
          key={`${l.kind}-${l.id}`}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-200">
              {labelFor(l)}{' '}
              <span className="text-[10px] text-slate-500">({KIND_LABELS[l.kind]})</span>
            </span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${labelFor(l)}`}
                onClick={() => remove(i)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <input
            type="text"
            value={l.role}
            disabled={disabled}
            onChange={(e) => patch(i, { role: e.target.value })}
            placeholder="Role (e.g. Target, Ally, Reward)"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-slate-200"
          />
          <textarea
            value={l.publicInfo}
            disabled={disabled}
            onChange={(e) => patch(i, { publicInfo: e.target.value })}
            placeholder="Public notes"
            rows={2}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-slate-200"
          />
          {isGM && (
            <textarea
              value={l.privateInfo}
              disabled={disabled}
              onChange={(e) => patch(i, { privateInfo: e.target.value })}
              placeholder="GM-only notes"
              rows={2}
              className="w-full bg-amber-500/[0.04] border border-amber-500/20 rounded-lg px-2.5 py-1.5 text-sm text-amber-100"
            />
          )}
        </div>
      ))}

      {!disabled && (
        <div className="flex items-end gap-2">
          <div className="flex-shrink-0">
            <label htmlFor={kindSelectId} className="block text-[11px] text-slate-500 mb-1">
              Type
            </label>
            <select
              id={kindSelectId}
              value={kind}
              onChange={(e) => handleKindChange(e.target.value as QuestLinkKind)}
              className="bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50 transition-all appearance-none cursor-pointer"
            >
              {(Object.keys(KIND_LABELS) as QuestLinkKind[]).map((k) => (
                <option key={k} value={k} className="bg-[#0D1117]">
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-0">
            <label htmlFor={entitySelectId} className="block text-[11px] text-slate-500 mb-1">
              Entity
            </label>
            <select
              id={entitySelectId}
              aria-label="Entity to link"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={candidates.length === 0}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50 transition-all appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="" className="bg-[#0D1117]">
                {candidates.length === 0
                  ? `No ${KIND_LABELS[kind].toLowerCase()}s`
                  : `Select ${KIND_LABELS[kind].toLowerCase()}…`}
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0D1117]">
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={addLink}
            disabled={!selectedId}
            className="flex-shrink-0 px-3 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-white/[0.06] disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors"
          >
            Add link
          </button>
        </div>
      )}
    </div>
  );
}
