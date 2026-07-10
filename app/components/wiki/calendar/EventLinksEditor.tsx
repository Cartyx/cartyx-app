import { useState, useMemo, useId } from 'react';
import { X } from 'lucide-react';
import { useCharacters } from '~/hooks/useCharacters';
import { usePlayers } from '~/hooks/usePlayers';
import { useLocations } from '~/hooks/useLocations';
import { useRaces } from '~/hooks/useRaces';
import { useLore } from '~/hooks/useLore';
import type { EventLink, EventLinkKind } from '~/types/event';

interface Candidate {
  id: string;
  label: string;
}

const KIND_LABELS: Record<EventLinkKind, string> = {
  character: 'Character',
  player: 'Player',
  location: 'Location',
  race: 'Race',
  lore: 'Lore',
};

const KIND_BADGE_COLORS: Record<EventLinkKind, string> = {
  character: 'bg-blue-500/20 text-blue-300',
  player: 'bg-green-500/20 text-green-300',
  location: 'bg-amber-500/20 text-amber-300',
  race: 'bg-purple-500/20 text-purple-300',
  lore: 'bg-sky-500/20 text-sky-300',
};

interface Props {
  campaignId: string;
  links: EventLink[];
  onChange: (links: EventLink[]) => void;
  disabled?: boolean;
}

export function EventLinksEditor({ campaignId, links, onChange, disabled }: Props) {
  const uid = useId();
  const kindSelectId = `event-links-kind-${uid}`;
  const entitySelectId = `event-links-entity-${uid}`;

  const [kind, setKind] = useState<EventLinkKind>('character');
  const [selectedId, setSelectedId] = useState('');

  // Fetch all five entity lists — always enabled so the selects populate quickly
  const { characters } = useCharacters(campaignId);
  const { players } = usePlayers(campaignId);
  const { locations } = useLocations(campaignId);
  const { races } = useRaces(campaignId);
  const { lore } = useLore(campaignId);

  // Build the candidate list for the currently chosen kind
  const candidates: Candidate[] = useMemo(() => {
    switch (kind) {
      case 'character':
        return characters.map((c) => ({
          id: c.id,
          label: `${c.firstName} ${c.lastName}`.trim(),
        }));
      case 'player':
        return players.map((p) => ({
          id: p.id,
          label: `${p.firstName} ${p.lastName}`.trim(),
        }));
      case 'location':
        return locations.map((l) => ({ id: l.id, label: l.name }));
      case 'race':
        return races.map((r) => ({ id: r.id, label: r.title }));
      case 'lore':
        return lore.map((l) => ({ id: l.id, label: l.title }));
    }
  }, [kind, characters, players, locations, races, lore]);

  // Reset entity selection when kind changes
  const handleKindChange = (newKind: EventLinkKind) => {
    setKind(newKind);
    setSelectedId('');
  };

  const handleAddLink = () => {
    if (!selectedId) return;

    // Deduplicate: same kind + id already present
    const alreadyLinked = links.some((l) => l.kind === kind && l.id === selectedId);
    if (alreadyLinked) return;

    const candidate = candidates.find((c) => c.id === selectedId);
    if (!candidate) return;

    const newLink: EventLink = { kind, id: selectedId, label: candidate.label };
    onChange([...links, newLink]);
    setSelectedId('');
  };

  const handleRemoveLink = (removeKind: EventLinkKind, removeId: string) => {
    onChange(links.filter((l) => !(l.kind === removeKind && l.id === removeId)));
  };

  return (
    <div data-testid="event-links-editor" className="space-y-3">
      <span className="block text-xs font-semibold text-slate-400 tracking-wide">
        Linked Entities
      </span>

      {/* Existing link chips */}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => {
            const label = link.label ?? link.id;
            return (
              <span
                key={`${link.kind}-${link.id}`}
                className="inline-flex items-center gap-1.5 bg-white/[0.06] border border-white/10 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-slate-200"
              >
                {label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${KIND_BADGE_COLORS[link.kind]}`}
                >
                  {KIND_LABELS[link.kind]}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => handleRemoveLink(link.kind, link.id)}
                    className="text-slate-500 hover:text-white transition-colors ml-0.5 rounded-full p-0.5 focus:outline-none focus:ring-1 focus:ring-white/30"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Add link controls */}
      {!disabled && (
        <div className="flex items-end gap-2">
          {/* Kind selector */}
          <div className="flex-shrink-0">
            <label htmlFor={kindSelectId} className="block text-[11px] text-slate-500 mb-1">
              Type
            </label>
            <select
              id={kindSelectId}
              value={kind}
              onChange={(e) => handleKindChange(e.target.value as EventLinkKind)}
              className="bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50 transition-all appearance-none cursor-pointer"
            >
              {(Object.keys(KIND_LABELS) as EventLinkKind[]).map((k) => (
                <option key={k} value={k} className="bg-[#0D1117]">
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {/* Entity selector */}
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

          {/* Add button */}
          <button
            type="button"
            onClick={handleAddLink}
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
