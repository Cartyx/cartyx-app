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

export const SPELL_SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
] as const;

export const SPELL_CLASSES = [
  'Bard',
  'Cleric',
  'Druid',
  'Paladin',
  'Ranger',
  'Sorcerer',
  'Warlock',
  'Wizard',
] as const;

export const CASTING_TIME_UNITS = ['action', 'bonus', 'reaction', 'minute', 'hour'] as const;

export const RANGE_TYPES = ['self', 'touch', 'ranged', 'sight', 'unlimited'] as const;

export const DURATION_TYPES = [
  'instantaneous',
  'timed',
  'concentration',
  'until-dispelled',
  'special',
] as const;

export const DURATION_UNITS = ['round', 'minute', 'hour', 'day'] as const;

export const SAVE_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export const AOE_SHAPES = ['none', 'sphere', 'cone', 'cube', 'line', 'cylinder'] as const;

export const MODIFIER_TYPES = ['damage', 'healing', 'bonus', 'proficiency', 'other'] as const;

export const CONDITION_ACTIONS = ['applies', 'removes', 'suppresses'] as const;

export const SCALING_TYPES = ['spell-scale', 'character-level'] as const;

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
