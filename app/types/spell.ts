export type SpellSource = 'srd' | 'homebrew';
export type SpellSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';
export type CastingTimeUnit = 'action' | 'bonus' | 'reaction' | 'minute' | 'hour';
export type RangeType = 'self' | 'touch' | 'ranged' | 'sight' | 'unlimited';
export type DurationType =
  'instantaneous' | 'timed' | 'concentration' | 'until-dispelled' | 'special';
export type DurationUnit = 'round' | 'minute' | 'hour' | 'day';
export type AttackSaveKind = 'attack' | 'save' | 'none';
export type AttackType = 'melee' | 'ranged';
export type SaveAbility = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type AoeShape = 'sphere' | 'cone' | 'cube' | 'line' | 'cylinder' | 'none';
export type ModifierType = 'damage' | 'healing' | 'bonus' | 'proficiency' | 'other';
export type ConditionAction = 'applies' | 'removes' | 'suppresses';
export type ScalingType = 'spell-scale' | 'character-level';

export interface SpellDice {
  count: number;
  sides: number;
}
export interface SpellCastingTime {
  value: number;
  unit: CastingTimeUnit;
  reactionCondition?: string;
}
export interface SpellComponents {
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  materialDescription?: string;
}
export interface SpellRange {
  type: RangeType;
  distance?: number;
}
export interface SpellDuration {
  type: DurationType;
  value?: number;
  unit?: DurationUnit;
  concentration: boolean;
}
export interface SpellHigherLevelScaling {
  enabled: boolean;
  type?: ScalingType;
}
export interface SpellAttackSave {
  kind: AttackSaveKind;
  attackType?: AttackType;
  saveAbility?: SaveAbility;
  saveEffect?: string;
}
export interface SpellModifier {
  id: string;
  type: ModifierType;
  dice?: SpellDice;
  scaling?: { perStep: SpellDice };
  fixedValue?: number;
  damageType?: string;
  atHigherLevels?: string;
  notes?: string;
}
export interface SpellCondition {
  id: string;
  action: ConditionAction;
  condition: string;
}
export interface SpellHigherLevel {
  id: string;
  level: number;
  description: string;
}
export interface SpellAreaOfEffect {
  shape: AoeShape;
  size?: number;
  width?: number;
}

export interface SpellData {
  id: string;
  campaignId: string;
  createdBy: string;
  source: SpellSource;
  name: string;
  description: string;
  imageUrl?: string;
  level: number;
  school: SpellSchool;
  version?: string;
  castingTime: SpellCastingTime;
  components: SpellComponents;
  range: SpellRange;
  duration: SpellDuration;
  ritual: boolean;
  higherLevelScaling: SpellHigherLevelScaling;
  classes: string[];
  attackSave: SpellAttackSave;
  modifiers: SpellModifier[];
  conditions: SpellCondition[];
  higherLevels: SpellHigherLevel[];
  areaOfEffect: SpellAreaOfEffect;
  tags: string[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpellListItem {
  id: string;
  campaignId: string;
  createdBy: string;
  source: SpellSource;
  name: string;
  level: number;
  school: SpellSchool;
  tags: string[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}
