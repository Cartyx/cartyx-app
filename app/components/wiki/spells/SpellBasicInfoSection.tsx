import { FormInput } from '~/components/FormInput';
import { FormSelect } from '~/components/FormSelect';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import {
  SPELL_SCHOOLS,
  CASTING_TIME_UNITS,
  RANGE_TYPES,
  DURATION_TYPES,
  DURATION_UNITS,
  formatSpellLevel,
} from '~/constants/spells';
import type { SpellForm } from './spellForm';

interface Props {
  form: SpellForm;
  patch: (partial: Partial<SpellForm>) => void;
  disabled?: boolean;
  errors: { name?: string; description?: string };
}

export function SpellBasicInfoSection({ form, patch, disabled, errors }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <FormInput
            label="Spell Name"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            error={errors.name}
            required
            disabled={disabled}
            placeholder="e.g. Fireball"
          />
        </div>
        <FormInput
          label="Version"
          value={form.version}
          onChange={(e) => patch({ version: e.target.value })}
          disabled={disabled}
          placeholder="optional"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Level"
          value={String(form.level)}
          onChange={(e) => patch({ level: Number(e.target.value) })}
          options={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
            value: String(n),
            label: formatSpellLevel(n),
          }))}
        />
        <FormSelect
          label="School"
          value={form.school}
          onChange={(e) => patch({ school: e.target.value as SpellForm['school'] })}
          options={SPELL_SCHOOLS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
        />
        <FormSelect
          label="Casting Unit"
          value={form.castingUnit}
          onChange={(e) => patch({ castingUnit: e.target.value as SpellForm['castingUnit'] })}
          options={CASTING_TIME_UNITS.map((u) => ({ value: u, label: u }))}
        />
        <FormInput
          label="Casting Value"
          value={String(form.castingValue)}
          onChange={(e) => patch({ castingValue: Number(e.target.value) || 0 })}
          disabled={disabled}
        />
      </div>

      {form.castingUnit === 'reaction' && (
        <FormInput
          label="Reaction Condition"
          value={form.reactionCondition}
          onChange={(e) => patch({ reactionCondition: e.target.value })}
          disabled={disabled}
          placeholder="which you take when..."
        />
      )}

      <fieldset className="border-none p-0 m-0">
        <legend className="block text-xs font-semibold text-slate-400 mb-2">Components</legend>
        <div className="flex gap-2">
          {(['verbal', 'somatic', 'material'] as const).map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => patch({ [key]: !form[key] } as Partial<SpellForm>)}
              className={`px-3 py-2 rounded-lg border text-sm font-bold transition-all ${
                form[key]
                  ? 'bg-blue-600/25 border-blue-500/70 text-blue-300'
                  : 'bg-white/[0.04] border-white/10 text-slate-500'
              }`}
            >
              {key[0].toUpperCase()}
            </button>
          ))}
        </div>
      </fieldset>

      {form.material && (
        <FormInput
          label="Material Components"
          value={form.materialDescription}
          onChange={(e) => patch({ materialDescription: e.target.value })}
          disabled={disabled}
          placeholder="a ball of bat guano and sulfur"
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <FormSelect
          label="Range Type"
          value={form.rangeType}
          onChange={(e) => patch({ rangeType: e.target.value as SpellForm['rangeType'] })}
          options={RANGE_TYPES.map((r) => ({ value: r, label: r }))}
        />
        {form.rangeType === 'ranged' && (
          <FormInput
            label="Range (ft.)"
            value={form.rangeDistance}
            onChange={(e) => patch({ rangeDistance: e.target.value })}
            disabled={disabled}
            placeholder="150"
          />
        )}
        <FormSelect
          label="Duration Type"
          value={form.durationType}
          onChange={(e) => patch({ durationType: e.target.value as SpellForm['durationType'] })}
          options={DURATION_TYPES.map((d) => ({ value: d, label: d }))}
        />
        {(form.durationType === 'timed' || form.durationType === 'concentration') && (
          <>
            <FormInput
              label="Duration Value"
              value={form.durationValue}
              onChange={(e) => patch({ durationValue: e.target.value })}
              disabled={disabled}
              placeholder="10"
            />
            <FormSelect
              label="Duration Unit"
              value={form.durationUnit}
              onChange={(e) => patch({ durationUnit: e.target.value as SpellForm['durationUnit'] })}
              options={DURATION_UNITS.map((u) => ({ value: u, label: u }))}
            />
          </>
        )}
      </div>

      <MarkdownEditor
        label="Description"
        value={form.description}
        onChange={(v) => patch({ description: v })}
        placeholder="Describe this spell..."
        error={errors.description}
        disabled={disabled}
        minHeight="220px"
      />
    </div>
  );
}
