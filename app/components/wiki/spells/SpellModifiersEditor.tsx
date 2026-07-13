import { Trash2, Plus } from 'lucide-react';
import type { SpellModifier } from '~/types/spell';
import { MODIFIER_TYPES } from '~/constants/spells';
import { newId } from './newId';

interface Props {
  value: SpellModifier[];
  onChange: (next: SpellModifier[]) => void;
  disabled?: boolean;
}

export function SpellModifiersEditor({ value, onChange, disabled }: Props) {
  const patch = (id: string, partial: Partial<SpellModifier>) =>
    onChange(value.map((m) => (m.id === id ? { ...m, ...partial } : m)));

  return (
    <fieldset className="border border-white/[0.07] rounded-lg p-3 m-0">
      <legend className="px-1 text-xs font-bold uppercase tracking-widest text-slate-400">
        Modifiers ({value.length})
      </legend>
      <div className="space-y-2">
        {value.map((m) => (
          <div key={m.id} className="flex flex-wrap items-end gap-2 p-2 rounded bg-white/[0.02]">
            <label className="flex flex-col text-[10px] text-slate-500">
              Type
              <select
                value={m.type}
                disabled={disabled}
                onChange={(e) => patch(m.id, { type: e.target.value as SpellModifier['type'] })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              >
                {MODIFIER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 w-16">
              Dice count
              <input
                type="number"
                min={0}
                value={m.dice?.count ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const count = e.target.value === '' ? undefined : Number(e.target.value);
                  patch(m.id, {
                    dice: count == null ? undefined : { count, sides: m.dice?.sides ?? 6 },
                  });
                }}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 w-16">
              Dice sides
              <input
                type="number"
                min={2}
                value={m.dice?.sides ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const sides = e.target.value === '' ? undefined : Number(e.target.value);
                  patch(m.id, {
                    dice: sides == null ? m.dice : { count: m.dice?.count ?? 1, sides },
                  });
                }}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <label className="flex flex-col text-[10px] text-slate-500 flex-1 min-w-[120px]">
              Damage type
              <input
                type="text"
                value={m.damageType ?? ''}
                disabled={disabled}
                placeholder="e.g. fire"
                onChange={(e) => patch(m.id, { damageType: e.target.value || undefined })}
                className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x.id !== m.id))}
              className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
              aria-label="Remove modifier"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...value, { id: newId(), type: 'damage' }])}
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
      >
        <Plus className="h-3.5 w-3.5" /> Add a modifier
      </button>
    </fieldset>
  );
}
