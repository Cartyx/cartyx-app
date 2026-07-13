import { Trash2, Plus } from 'lucide-react';
import type { SpellHigherLevel } from '~/types/spell';
import { newId } from './newId';

interface Props {
  value: SpellHigherLevel[];
  onChange: (next: SpellHigherLevel[]) => void;
  disabled?: boolean;
}

export function SpellHigherLevelsEditor({ value, onChange, disabled }: Props) {
  const patch = (id: string, partial: Partial<SpellHigherLevel>) =>
    onChange(value.map((h) => (h.id === id ? { ...h, ...partial } : h)));

  return (
    <fieldset className="border border-white/[0.07] rounded-lg p-3 m-0">
      <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">
        At Higher Levels ({value.length})
      </legend>
      <div className="space-y-2">
        {value.map((h) => (
          <div key={h.id} className="flex flex-wrap items-end gap-2 p-2 rounded bg-white/[0.02]">
            <label className="flex flex-col text-[10px] text-slate-500 w-16">
              Level
              <input
                type="number"
                min={1}
                max={9}
                value={h.level}
                disabled={disabled}
                onChange={(e) => patch(h.id, { level: Number(e.target.value) })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 flex-1 min-w-[160px]">
              Description
              <input
                type="text"
                value={h.description}
                disabled={disabled}
                placeholder="Damage increases by 1d6..."
                onChange={(e) => patch(h.id, { description: e.target.value })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x.id !== h.id))}
              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
              aria-label="Remove higher-level entry"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || value.length >= 25}
        onClick={() =>
          onChange([...value, { id: newId(), level: value.length + 2, description: '' }])
        }
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" /> Add a higher-level entry
      </button>
    </fieldset>
  );
}
