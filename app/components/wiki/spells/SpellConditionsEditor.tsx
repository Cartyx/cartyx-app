import { Trash2, Plus } from 'lucide-react';
import type { SpellCondition } from '~/types/spell';
import { CONDITION_ACTIONS } from '~/constants/spells';
import { newId } from './newId';

interface Props {
  value: SpellCondition[];
  onChange: (next: SpellCondition[]) => void;
  disabled?: boolean;
}

export function SpellConditionsEditor({ value, onChange, disabled }: Props) {
  const patch = (id: string, partial: Partial<SpellCondition>) =>
    onChange(value.map((c) => (c.id === id ? { ...c, ...partial } : c)));

  return (
    <fieldset className="border border-white/[0.07] rounded-lg p-3 m-0">
      <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">
        Conditions ({value.length})
      </legend>
      <div className="space-y-2">
        {value.map((c) => (
          <div key={c.id} className="flex flex-wrap items-end gap-2 p-2 rounded bg-white/[0.02]">
            <label className="flex flex-col text-[10px] text-slate-500">
              Action
              <select
                value={c.action}
                disabled={disabled}
                onChange={(e) =>
                  patch(c.id, { action: e.target.value as SpellCondition['action'] })
                }
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              >
                {CONDITION_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 flex-1 min-w-[140px]">
              Condition
              <input
                type="text"
                value={c.condition}
                disabled={disabled}
                placeholder="e.g. Prone"
                onChange={(e) => patch(c.id, { condition: e.target.value })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x.id !== c.id))}
              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
              aria-label="Remove condition"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...value, { id: newId(), action: 'applies', condition: '' }])}
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
      >
        <Plus className="h-3.5 w-3.5" /> Add a condition
      </button>
    </fieldset>
  );
}
