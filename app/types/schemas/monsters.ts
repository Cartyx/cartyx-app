import { z } from 'zod';

export const MONSTER_SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type MonsterSize = (typeof MONSTER_SIZES)[number];

export const FEATURE_SECTIONS = [
  'traits',
  'actions',
  'bonusActions',
  'reactions',
  'legendaryActions',
] as const;
export type FeatureSection = (typeof FEATURE_SECTIONS)[number];

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Invalid color');

const abilityScoreSchema = z.object({
  score: z.number().int().min(0).max(40).default(10),
  mod: z.number().int().min(-10).max(15).default(0),
  save: z.number().int().min(-10).max(20).default(0),
});

const speedItemSchema = z.object({
  kind: z.enum(['walk', 'fly', 'swim', 'climb', 'burrow']),
  feet: z.number().int().min(0).max(1000).default(30),
  notes: z.string().max(120).default(''),
});

const skillItemSchema = z.object({
  name: z.string().min(1).max(60),
  modifier: z.number().int().min(-20).max(40),
});

const senseItemSchema = z.object({
  name: z.string().min(1).max(60),
  range: z.number().int().min(0).max(10_000).nullable().default(null),
});

const featureItemSchema = z.object({
  section: z.enum(FEATURE_SECTIONS),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).default(''),
});

const linkItemSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().url().max(500),
});

const crSchema = z.object({
  value: z.number().min(0).max(40).default(0),
  xp: z.number().int().min(0).default(0),
  proficiencyBonus: z.number().int().min(2).max(10).default(2),
});

const pictureCropSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const monsterBaseSchema = z.object({
  name: z.string().trim().min(1, 'Monster name is required').max(120),
  size: z.enum(MONSTER_SIZES).default('medium'),
  type: z.string().max(60).default(''),
  subtype: z.string().max(60).default(''),
  alignment: z.string().max(60).default(''),

  armorClass: z.number().int().min(0).max(40).default(10),
  armorClassNote: z.string().max(60).default(''),
  hitPoints: z
    .object({
      average: z.number().int().min(1).max(10_000).default(1),
      formula: z.string().max(60).default(''),
    })
    .default({ average: 1, formula: '' }),
  initiativeMod: z.number().int().min(-20).max(20).default(0),
  initiativePassive: z.number().int().min(0).max(40).default(10),
  speeds: z.array(speedItemSchema).default([]),
  abilities: z
    .object({
      str: abilityScoreSchema.default({ score: 10, mod: 0, save: 0 }),
      dex: abilityScoreSchema.default({ score: 10, mod: 0, save: 0 }),
      con: abilityScoreSchema.default({ score: 10, mod: 0, save: 0 }),
      int: abilityScoreSchema.default({ score: 10, mod: 0, save: 0 }),
      wis: abilityScoreSchema.default({ score: 10, mod: 0, save: 0 }),
      cha: abilityScoreSchema.default({ score: 10, mod: 0, save: 0 }),
    })
    .default({
      str: { score: 10, mod: 0, save: 0 },
      dex: { score: 10, mod: 0, save: 0 },
      con: { score: 10, mod: 0, save: 0 },
      int: { score: 10, mod: 0, save: 0 },
      wis: { score: 10, mod: 0, save: 0 },
      cha: { score: 10, mod: 0, save: 0 },
    }),
  skills: z.array(skillItemSchema).default([]),
  resistances: z.array(z.string().max(40)).default([]),
  immunities: z.array(z.string().max(40)).default([]),
  vulnerabilities: z.array(z.string().max(40)).default([]),
  conditionImmunities: z.array(z.string().max(40)).default([]),
  senses: z.array(senseItemSchema).default([]),
  passivePerception: z.number().int().min(0).max(40).default(10),
  languages: z.array(z.string().max(60)).default([]),
  cr: crSchema.default({ value: 0, xp: 0, proficiencyBonus: 2 }),
  features: z.array(featureItemSchema).default([]),

  picture: z.string().default(''),
  pictureCrop: pictureCropSchema.nullable().default(null),
  links: z.array(linkItemSchema).default([]),
  gmNotes: z.string().max(20_000).default(''),
  tags: z.array(z.string()).default([]),
  sessionId: z.string().trim().min(1).nullable().default(null),
  color: hexColor.default('#9ca3af'),
});

// CRUD wrappers ------------------------------------------------------------

export const listMonstersSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  minCr: z.number().min(0).optional(),
  maxCr: z.number().min(0).optional(),
});

export const getMonsterSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const createMonsterSchema = monsterBaseSchema.extend({
  campaignId: z.string().trim().min(1),
});

export const updateMonsterSchema = monsterBaseSchema.partial().extend({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const deleteMonsterSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});
