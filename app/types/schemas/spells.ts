import { z } from 'zod';
import {
  SPELL_SCHOOLS,
  CASTING_TIME_UNITS,
  RANGE_TYPES,
  DURATION_TYPES,
  DURATION_UNITS,
  SAVE_ABILITIES,
  AOE_SHAPES,
  MODIFIER_TYPES,
  CONDITION_ACTIONS,
  SCALING_TYPES,
} from '~/constants/spells';

const diceSchema = z.object({
  count: z.number().int().min(1),
  sides: z.number().int().min(2),
});

const castingTimeSchema = z.object({
  value: z.number().int().min(0),
  unit: z.enum(CASTING_TIME_UNITS),
  reactionCondition: z.string().optional(),
});

const componentsSchema = z.object({
  verbal: z.boolean().default(false),
  somatic: z.boolean().default(false),
  material: z.boolean().default(false),
  materialDescription: z.string().optional(),
});

const rangeSchema = z.object({
  type: z.enum(RANGE_TYPES),
  distance: z.number().int().min(0).optional(),
});

const durationSchema = z.object({
  type: z.enum(DURATION_TYPES),
  value: z.number().int().min(0).optional(),
  unit: z.enum(DURATION_UNITS).optional(),
  concentration: z.boolean().default(false),
});

const higherLevelScalingSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(SCALING_TYPES).optional(),
});

const attackSaveSchema = z.object({
  kind: z.enum(['attack', 'save', 'none']).default('none'),
  attackType: z.enum(['melee', 'ranged']).optional(),
  saveAbility: z.enum(SAVE_ABILITIES).optional(),
  saveEffect: z.string().optional(),
});

const modifierSchema = z.object({
  id: z.string().min(1),
  type: z.enum(MODIFIER_TYPES),
  dice: diceSchema.optional(),
  scaling: z.object({ perStep: diceSchema }).optional(),
  fixedValue: z.number().int().optional(),
  damageType: z.string().optional(),
  atHigherLevels: z.string().optional(),
  notes: z.string().optional(),
});

const conditionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(CONDITION_ACTIONS),
  condition: z.string().min(1),
});

const higherLevelSchema = z.object({
  id: z.string().min(1),
  level: z.number().int().min(1).max(9),
  description: z.string().min(1),
});

const areaOfEffectSchema = z.object({
  shape: z.enum(AOE_SHAPES).default('none'),
  size: z.number().int().min(0).optional(),
  width: z.number().int().min(0).optional(),
});

/** The editable spell body, shared by create/update and importer validation. */
export const spellFieldsShape = {
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().min(1, 'Description is required'),
  imageUrl: z.string().url().optional(),
  level: z.number().int().min(0).max(9),
  school: z.enum(SPELL_SCHOOLS),
  version: z.string().optional(),
  castingTime: castingTimeSchema,
  components: componentsSchema,
  range: rangeSchema,
  duration: durationSchema,
  ritual: z.boolean().default(false),
  higherLevelScaling: higherLevelScalingSchema.default({ enabled: false }),
  classes: z.array(z.string()).default([]),
  attackSave: attackSaveSchema.default({ kind: 'none' }),
  modifiers: z.array(modifierSchema).max(25).default([]),
  conditions: z.array(conditionSchema).max(25).default([]),
  higherLevels: z.array(higherLevelSchema).max(25).default([]),
  areaOfEffect: areaOfEffectSchema.default({ shape: 'none' }),
  tags: z.array(z.string()).optional().default([]),
} as const;

export const createSpellSchema = z.object({
  campaignId: z.string().trim().min(1),
  ...spellFieldsShape,
});

export const updateSpellSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  ...spellFieldsShape,
});

export const deleteSpellSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const duplicateSpellSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const listSpellsSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  level: z.number().int().min(0).max(9).optional(),
  school: z.enum(SPELL_SCHOOLS).optional(),
});

export const getSpellSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});
