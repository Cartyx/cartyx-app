import type {
  SpellData,
  SpellModifier,
  SpellCondition,
  SpellHigherLevel,
  SpellSchool,
  CastingTimeUnit,
  RangeType,
  DurationType,
  DurationUnit,
  AttackSaveKind,
  AttackType,
  SaveAbility,
  AoeShape,
  ScalingType,
} from '~/types/spell';

export interface SpellForm {
  name: string;
  description: string;
  version: string;
  level: number;
  school: SpellSchool;
  castingValue: number;
  castingUnit: CastingTimeUnit;
  reactionCondition: string;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  materialDescription: string;
  rangeType: RangeType;
  rangeDistance: string; // text input, parsed on submit
  durationType: DurationType;
  durationValue: string;
  durationUnit: DurationUnit;
  concentration: boolean;
  ritual: boolean;
  scalingEnabled: boolean;
  scalingType: ScalingType;
  classes: string[];
  attackKind: AttackSaveKind;
  attackType: AttackType;
  saveAbility: SaveAbility;
  saveEffect: string;
  aoeShape: AoeShape;
  aoeSize: string;
  aoeWidth: string;
  modifiers: SpellModifier[];
  conditions: SpellCondition[];
  higherLevels: SpellHigherLevel[];
  tags: string[];
}

export const EMPTY_SPELL_FORM: SpellForm = {
  name: '',
  description: '',
  version: '',
  level: 0,
  school: 'evocation',
  castingValue: 1,
  castingUnit: 'action',
  reactionCondition: '',
  verbal: false,
  somatic: false,
  material: false,
  materialDescription: '',
  rangeType: 'self',
  rangeDistance: '',
  durationType: 'instantaneous',
  durationValue: '',
  durationUnit: 'round',
  concentration: false,
  ritual: false,
  scalingEnabled: false,
  scalingType: 'spell-scale',
  classes: [],
  attackKind: 'none',
  attackType: 'ranged',
  saveAbility: 'dex',
  saveEffect: '',
  aoeShape: 'none',
  aoeSize: '',
  aoeWidth: '',
  modifiers: [],
  conditions: [],
  higherLevels: [],
  tags: [],
};

export function spellToForm(s: SpellData): SpellForm {
  return {
    name: s.name,
    description: s.description,
    version: s.version ?? '',
    level: s.level,
    school: s.school,
    castingValue: s.castingTime.value,
    castingUnit: s.castingTime.unit,
    reactionCondition: s.castingTime.reactionCondition ?? '',
    verbal: s.components.verbal,
    somatic: s.components.somatic,
    material: s.components.material,
    materialDescription: s.components.materialDescription ?? '',
    rangeType: s.range.type,
    rangeDistance: s.range.distance != null ? String(s.range.distance) : '',
    durationType: s.duration.type,
    durationValue: s.duration.value != null ? String(s.duration.value) : '',
    durationUnit: s.duration.unit ?? 'round',
    concentration: s.duration.concentration,
    ritual: s.ritual,
    scalingEnabled: s.higherLevelScaling.enabled,
    scalingType: s.higherLevelScaling.type ?? 'spell-scale',
    classes: s.classes,
    attackKind: s.attackSave.kind,
    attackType: s.attackSave.attackType ?? 'ranged',
    saveAbility: s.attackSave.saveAbility ?? 'dex',
    saveEffect: s.attackSave.saveEffect ?? '',
    aoeShape: s.areaOfEffect.shape,
    aoeSize: s.areaOfEffect.size != null ? String(s.areaOfEffect.size) : '',
    aoeWidth: s.areaOfEffect.width != null ? String(s.areaOfEffect.width) : '',
    modifiers: s.modifiers,
    conditions: s.conditions,
    higherLevels: s.higherLevels,
    tags: s.tags,
  };
}

function toIntOrUndef(v: string): number | undefined {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function formToInput(form: SpellForm, campaignId: string, id?: string) {
  const base = {
    campaignId,
    name: form.name.trim(),
    description: form.description.trim(),
    version: form.version.trim() || undefined,
    level: form.level,
    school: form.school,
    castingTime: {
      value: form.castingValue,
      unit: form.castingUnit,
      reactionCondition:
        form.castingUnit === 'reaction' ? form.reactionCondition.trim() || undefined : undefined,
    },
    components: {
      verbal: form.verbal,
      somatic: form.somatic,
      material: form.material,
      materialDescription: form.material ? form.materialDescription.trim() || undefined : undefined,
    },
    range: {
      type: form.rangeType,
      distance: form.rangeType === 'ranged' ? toIntOrUndef(form.rangeDistance) : undefined,
    },
    duration: {
      type: form.durationType,
      value: toIntOrUndef(form.durationValue),
      unit:
        form.durationType === 'timed' || form.durationType === 'concentration'
          ? form.durationUnit
          : undefined,
      concentration: form.concentration || form.durationType === 'concentration',
    },
    ritual: form.ritual,
    higherLevelScaling: {
      enabled: form.scalingEnabled,
      type: form.scalingEnabled ? form.scalingType : undefined,
    },
    classes: form.classes,
    attackSave: {
      kind: form.attackKind,
      attackType: form.attackKind === 'attack' ? form.attackType : undefined,
      saveAbility: form.attackKind === 'save' ? form.saveAbility : undefined,
      saveEffect: form.attackKind === 'save' ? form.saveEffect.trim() || undefined : undefined,
    },
    modifiers: form.modifiers,
    conditions: form.conditions,
    higherLevels: form.higherLevels,
    areaOfEffect: {
      shape: form.aoeShape,
      size: form.aoeShape !== 'none' ? toIntOrUndef(form.aoeSize) : undefined,
      width:
        form.aoeShape === 'line' || form.aoeShape === 'cylinder'
          ? toIntOrUndef(form.aoeWidth)
          : undefined,
    },
    tags: form.tags,
  };
  return id ? { id, ...base } : base;
}
