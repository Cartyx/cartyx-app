import { FormSelect } from '~/components/FormSelect';
import { FormInput } from '~/components/FormInput';
import { SPELL_CLASSES, SAVE_ABILITIES, AOE_SHAPES, SCALING_TYPES } from '~/constants/spells';
import type { SpellForm } from './spellForm';

interface Props {
  form: SpellForm;
  patch: (partial: Partial<SpellForm>) => void;
  disabled?: boolean;
}

export function SpellAdditionalInfoSection({ form, patch, disabled }: Props) {
  const toggleClass = (c: string) =>
    patch({
      classes: form.classes.includes(c)
        ? form.classes.filter((x) => x !== c)
        : [...form.classes, c],
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ ritual: !form.ritual })}
          className={`px-3 py-2 rounded-lg border text-xs font-bold ${
            form.ritual
              ? 'bg-blue-600/25 border-blue-500/70 text-blue-300'
              : 'bg-white/[0.04] border-white/10 text-slate-500'
          }`}
        >
          Ritual
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ scalingEnabled: !form.scalingEnabled })}
          className={`px-3 py-2 rounded-lg border text-xs font-bold ${
            form.scalingEnabled
              ? 'bg-blue-600/25 border-blue-500/70 text-blue-300'
              : 'bg-white/[0.04] border-white/10 text-slate-500'
          }`}
        >
          Scales at Higher Levels
        </button>
        {form.scalingEnabled && (
          <FormSelect
            label=""
            value={form.scalingType}
            onChange={(e) => patch({ scalingType: e.target.value as SpellForm['scalingType'] })}
            options={SCALING_TYPES.map((s) => ({ value: s, label: s }))}
          />
        )}
      </div>

      <fieldset className="border-none p-0 m-0">
        <legend className="block text-xs font-semibold text-slate-400 mb-2">
          Available For Class(es)
        </legend>
        <div className="flex flex-wrap gap-2">
          {SPELL_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => toggleClass(c)}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium ${
                form.classes.includes(c)
                  ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                  : 'bg-white/[0.04] border-white/10 text-slate-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Attack / Save"
          value={form.attackKind}
          onChange={(e) => patch({ attackKind: e.target.value as SpellForm['attackKind'] })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'attack', label: 'Attack' },
            { value: 'save', label: 'Save' },
          ]}
        />
        {form.attackKind === 'attack' && (
          <FormSelect
            label="Attack Type"
            value={form.attackType}
            onChange={(e) => patch({ attackType: e.target.value as SpellForm['attackType'] })}
            options={[
              { value: 'melee', label: 'Melee' },
              { value: 'ranged', label: 'Ranged' },
            ]}
          />
        )}
        {form.attackKind === 'save' && (
          <FormSelect
            label="Save Ability"
            value={form.saveAbility}
            onChange={(e) => patch({ saveAbility: e.target.value as SpellForm['saveAbility'] })}
            options={SAVE_ABILITIES.map((a) => ({ value: a, label: a.toUpperCase() }))}
          />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Area Shape"
          value={form.aoeShape}
          onChange={(e) => patch({ aoeShape: e.target.value as SpellForm['aoeShape'] })}
          options={AOE_SHAPES.map((s) => ({ value: s, label: s }))}
        />
        {form.aoeShape !== 'none' && (
          <FormInput
            label="Area Size (ft.)"
            value={form.aoeSize}
            onChange={(e) => patch({ aoeSize: e.target.value })}
            disabled={disabled}
            placeholder="20"
          />
        )}
        {(form.aoeShape === 'line' || form.aoeShape === 'cylinder') && (
          <FormInput
            label="Area Width (ft.)"
            value={form.aoeWidth}
            onChange={(e) => patch({ aoeWidth: e.target.value })}
            disabled={disabled}
            placeholder="5"
          />
        )}
      </div>
    </div>
  );
}
