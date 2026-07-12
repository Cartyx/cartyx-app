import type {
  SpellSchool,
  CastingTimeUnit,
  RangeType,
  DurationType,
  DurationUnit,
  SaveAbility,
  AoeShape,
  ModifierType,
  ConditionAction,
  ScalingType,
} from '~/types/spell';

export const SPELL_SCHOOLS: readonly SpellSchool[] = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
] as const;

export const SPELL_CLASSES: readonly string[] = [
  'Bard',
  'Cleric',
  'Druid',
  'Paladin',
  'Ranger',
  'Sorcerer',
  'Warlock',
  'Wizard',
] as const;

export const CASTING_TIME_UNITS: readonly CastingTimeUnit[] = [
  'action',
  'bonus',
  'reaction',
  'minute',
  'hour',
] as const;

export const RANGE_TYPES: readonly RangeType[] = [
  'self',
  'touch',
  'ranged',
  'sight',
  'unlimited',
] as const;

export const DURATION_TYPES: readonly DurationType[] = [
  'instantaneous',
  'timed',
  'concentration',
  'until-dispelled',
  'special',
] as const;

export const DURATION_UNITS: readonly DurationUnit[] = ['round', 'minute', 'hour', 'day'] as const;

export const SAVE_ABILITIES: readonly SaveAbility[] = [
  'str',
  'dex',
  'con',
  'int',
  'wis',
  'cha',
] as const;

export const AOE_SHAPES: readonly AoeShape[] = [
  'none',
  'sphere',
  'cone',
  'cube',
  'line',
  'cylinder',
] as const;

export const MODIFIER_TYPES: readonly ModifierType[] = [
  'damage',
  'healing',
  'bonus',
  'proficiency',
  'other',
] as const;

export const CONDITION_ACTIONS: readonly ConditionAction[] = [
  'applies',
  'removes',
  'suppresses',
] as const;

export const SCALING_TYPES: readonly ScalingType[] = ['spell-scale', 'character-level'] as const;

/** Spell level 0 renders as "Cantrip". */
export function formatSpellLevel(level: number): string {
  if (level === 0) return 'Cantrip';
  if (level === 1) return '1st';
  if (level === 2) return '2nd';
  if (level === 3) return '3rd';
  return `${level}th`;
}

/** Title-case a school id for display, e.g. 'evocation' -> 'Evocation'. */
export function formatSchool(school: SpellSchool): string {
  return school.charAt(0).toUpperCase() + school.slice(1);
}
