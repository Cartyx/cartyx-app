import { useState, useId } from 'react';
import { X } from 'lucide-react';
import { useEvents } from '~/hooks/useEvents';
import type { QuestEventLinkInput } from '~/types/quest';

interface Props {
  campaignId: string;
  events: QuestEventLinkInput[];
  onChange: (events: QuestEventLinkInput[]) => void;
  disabled?: boolean;
  isGM: boolean;
}

export function QuestEventsEditor({ campaignId, events, onChange, disabled, isGM }: Props) {
  const uid = useId();
  const entitySelectId = `quest-events-entity-${uid}`;

  const [selectedId, setSelectedId] = useState('');

  const { events: candidates } = useEvents(campaignId);

  const labelFor = (e: QuestEventLinkInput): string => {
    return candidates.find((x) => x.id === e.eventId)?.title ?? e.eventId;
  };

  const addEvent = () => {
    if (!selectedId) return;
    if (events.some((e) => e.eventId === selectedId)) return;
    onChange([...events, { eventId: selectedId, role: '', publicInfo: '', privateInfo: '' }]);
    setSelectedId('');
  };

  const patch = (i: number, part: Partial<QuestEventLinkInput>) => {
    onChange(events.map((e, idx) => (idx === i ? { ...e, ...part } : e)));
  };
  const remove = (i: number) => onChange(events.filter((_, idx) => idx !== i));

  return (
    <div data-testid="quest-events-editor" className="space-y-3">
      <span className="block text-xs font-semibold text-slate-400 tracking-wide">
        Linked Events
      </span>

      {events.map((e, i) => (
        <div
          key={e.eventId}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-200">{labelFor(e)}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${labelFor(e)}`}
                onClick={() => remove(i)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <input
            type="text"
            value={e.role}
            disabled={disabled}
            onChange={(ev) => patch(i, { role: ev.target.value })}
            placeholder="Role (e.g. Trigger, Aftermath)"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-slate-200"
          />
          <textarea
            value={e.publicInfo}
            disabled={disabled}
            onChange={(ev) => patch(i, { publicInfo: ev.target.value })}
            placeholder="Public notes"
            rows={2}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-slate-200"
          />
          {isGM && (
            <textarea
              value={e.privateInfo}
              disabled={disabled}
              onChange={(ev) => patch(i, { privateInfo: ev.target.value })}
              placeholder="GM-only notes"
              rows={2}
              className="w-full bg-amber-500/[0.04] border border-amber-500/20 rounded-lg px-2.5 py-1.5 text-sm text-amber-100"
            />
          )}
        </div>
      ))}

      {!disabled && (
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label htmlFor={entitySelectId} className="block text-[11px] text-slate-500 mb-1">
              Event
            </label>
            <select
              id={entitySelectId}
              aria-label="Event to link"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={candidates.length === 0}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500/50 transition-all appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="" className="bg-[#0D1117]">
                {candidates.length === 0 ? 'No events' : 'Select event…'}
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0D1117]">
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={addEvent}
            disabled={!selectedId}
            className="flex-shrink-0 px-3 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-white/[0.06] disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors"
          >
            Add event
          </button>
        </div>
      )}
    </div>
  );
}
