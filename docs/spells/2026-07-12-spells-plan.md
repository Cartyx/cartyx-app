# Spells Feature Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured Spells wiki feature (browse/search/tag, GM create/edit/duplicate, player read-only view), ingest SRD 5.2.1 spells into generated JSON, load SRD content into campaigns on demand, and add an SRD licensing screen.

**Architecture:** Spells clone the Races wiki pattern (Mongoose model, Zod schemas, TanStack Start server functions gated by `requireCampaignMember`/`isGM`, TanStack Query hook, six wiki UI components, WikiPanel registration) but with a rich typed data model. SRD content is generated into committed JSON data modules, imported (bundled) at runtime by an in-app importer wired into campaign creation via a checkbox. An SRD Licensing info screen is added under the inspector Settings cog.

**Tech Stack:** TanStack Start (React 19), TanStack Query, Mongoose (MongoDB), Zod, Vitest + mongodb-memory-server, Playwright (e2e), Python 3 (dev seed).

## Global Constraints

- All PRs target `dev`, never `main`.
- `npm test` runs `vitest run --project unit` — NEVER run bare `npx vitest run` (storybook project crashes outside CI).
- `npm run typecheck` and `npm run lint` must both be clean: 0 lint errors; ~24 pre-existing warnings are the baseline (do not add new ones).
- Server functions keep Mongoose server-only via dynamic `import('~/server/functions/...')` inside each `createServerFn` handler.
- GM authorization is always re-checked server-side (`requireCampaignMember` → `if (!member.isGM) throw new Error('Forbidden')`); client `isGM`/`canEdit` only gate UI.
- SRD attribution string is fixed and exact (SRD 5.2.1, CC-BY-4.0) — copy verbatim from Task 6.
- New npm packages must be published ≥7 days AND pass `npm run check:deps-age`. This plan adds **no** new npm dependencies.
- Integration tests use mongodb-memory-server, never a real Atlas DB.

---

## File Structure

**New files:**

- `app/types/spell.ts` — TS interfaces + field union types
- `app/constants/spells.ts` — dropdown option arrays (schools, classes, units, etc.)
- `app/types/schemas/spells.ts` — Zod schemas
- `app/server/db/models/Spell.ts` — Mongoose model
- `app/server/functions/spells.ts` — CRUD + duplicate server functions
- `app/hooks/useSpells.ts` — TanStack Query hook
- `app/server/data/srd/attribution.ts` — shared SRD attribution constant
- `app/server/data/srd/spells.json`, `races.json`, `rules.json` — generated data (committed)
- `app/server/data/srd/index.ts` — typed loaders for the JSON
- `app/server/functions/srdImport.ts` — `importSrdContent(...)` util
- `scripts/srd/generate-srd-data.ts` — generation script (build-time)
- `app/components/wiki/spells/SpellCard.tsx`, `SpellWindow.tsx`, `SpellViewModal.tsx`, `SpellsPanel.tsx`, `SpellWindowWrapper.tsx`
- `app/components/wiki/spells/SpellModal.tsx` + section sub-editors `SpellBasicInfoSection.tsx`, `SpellAdditionalInfoSection.tsx`, `SpellModifiersEditor.tsx`, `SpellConditionsEditor.tsx`, `SpellHigherLevelsEditor.tsx`
- `app/components/mainview/settings/SrdLicensingModal.tsx`
- Test files alongside each logic module.

**Modified files:**

- `app/utils/queryKeys.ts` (add `spells` block)
- `app/components/wiki/WikiPanel.tsx` (register category)
- `app/components/wiki/spells/SpellsFilterBar.tsx` (new — extends filter row with level/school)
- `app/types/schemas/campaigns.ts` (add `loadSrdData`)
- `app/hooks/useCampaigns.ts` (thread `loadSrdData`)
- `app/routes/campaigns/new.tsx` (checkbox in Step 4 + Review)
- `app/server/functions/campaigns.ts` (call importer in transaction)
- `app/components/mainview/SettingsPanel.tsx` (register SRD Licensing category)
- `scripts/dev_seed.py` (import spells; read generated JSON; call in bulk_test)
- `package.json` (add `srd:generate` script)

This plan is split into three plan-parts by dependency order. **This document is Part A (data layer + server).** Parts B (client + UI) and C (SRD generation/import + campaign checkbox + license screen + seed + e2e) will be authored as follow-on plan files once Part A is reviewed, to keep each plan reviewable. Part A alone produces a working, tested spells backend.

---

## Task 1: Spell types and constants

**Files:**

- Create: `app/types/spell.ts`
- Create: `app/constants/spells.ts`
- Test: `app/constants/spells.test.ts`

**Interfaces:**

- Produces: all `Spell*` TS types (used by every later task) and constant arrays `SPELL_SCHOOLS`, `SPELL_CLASSES`, `CASTING_TIME_UNITS`, `RANGE_TYPES`, `DURATION_TYPES`, `DURATION_UNITS`, `SAVE_ABILITIES`, `AOE_SHAPES`, `MODIFIER_TYPES`, `CONDITION_ACTIONS`, `SCALING_TYPES`.

- [ ] **Step 1: Write `app/types/spell.ts`**

```ts
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
```

- [ ] **Step 2: Write `app/constants/spells.ts`**

```ts
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
```

- [ ] **Step 3: Write `app/constants/spells.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { SPELL_SCHOOLS, formatSpellLevel, formatSchool } from './spells';

describe('spell constants', () => {
  it('has the eight schools of magic', () => {
    expect(SPELL_SCHOOLS).toHaveLength(8);
    expect(SPELL_SCHOOLS).toContain('evocation');
  });

  it('formats level 0 as Cantrip', () => {
    expect(formatSpellLevel(0)).toBe('Cantrip');
    expect(formatSpellLevel(1)).toBe('1st');
    expect(formatSpellLevel(3)).toBe('3rd');
    expect(formatSpellLevel(9)).toBe('9th');
  });

  it('title-cases a school', () => {
    expect(formatSchool('evocation')).toBe('Evocation');
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test -- app/constants/spells.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add app/types/spell.ts app/constants/spells.ts app/constants/spells.test.ts
git commit -m "feat(spells): add spell types and constants"
```

---

## Task 2: Zod schemas

**Files:**

- Create: `app/types/schemas/spells.ts`
- Test: `app/types/schemas/spells.test.ts`

**Interfaces:**

- Consumes: types/constants from Task 1.
- Produces: `createSpellSchema`, `updateSpellSchema`, `deleteSpellSchema`, `listSpellsSchema`, `getSpellSchema`, `duplicateSpellSchema`, and `spellFieldsShape` (the shared body used by create/update and by the importer to validate generated rows).

- [ ] **Step 1: Write `app/types/schemas/spells.ts`**

```ts
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
  unit: z.enum(CASTING_TIME_UNITS as unknown as [string, ...string[]]),
  reactionCondition: z.string().optional(),
});

const componentsSchema = z.object({
  verbal: z.boolean().default(false),
  somatic: z.boolean().default(false),
  material: z.boolean().default(false),
  materialDescription: z.string().optional(),
});

const rangeSchema = z.object({
  type: z.enum(RANGE_TYPES as unknown as [string, ...string[]]),
  distance: z.number().int().min(0).optional(),
});

const durationSchema = z.object({
  type: z.enum(DURATION_TYPES as unknown as [string, ...string[]]),
  value: z.number().int().min(0).optional(),
  unit: z.enum(DURATION_UNITS as unknown as [string, ...string[]]).optional(),
  concentration: z.boolean().default(false),
});

const higherLevelScalingSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(SCALING_TYPES as unknown as [string, ...string[]]).optional(),
});

const attackSaveSchema = z.object({
  kind: z.enum(['attack', 'save', 'none']).default('none'),
  attackType: z.enum(['melee', 'ranged']).optional(),
  saveAbility: z.enum(SAVE_ABILITIES as unknown as [string, ...string[]]).optional(),
  saveEffect: z.string().optional(),
});

const modifierSchema = z.object({
  id: z.string().min(1),
  type: z.enum(MODIFIER_TYPES as unknown as [string, ...string[]]),
  dice: diceSchema.optional(),
  fixedValue: z.number().int().optional(),
  damageType: z.string().optional(),
  atHigherLevels: z.string().optional(),
  notes: z.string().optional(),
});

const conditionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(CONDITION_ACTIONS as unknown as [string, ...string[]]),
  condition: z.string().min(1),
});

const higherLevelSchema = z.object({
  id: z.string().min(1),
  level: z.number().int().min(1).max(9),
  description: z.string().min(1),
});

const areaOfEffectSchema = z.object({
  shape: z.enum(AOE_SHAPES as unknown as [string, ...string[]]).default('none'),
  size: z.number().int().min(0).optional(),
  width: z.number().int().min(0).optional(),
});

/** The editable spell body, shared by create/update and importer validation. */
export const spellFieldsShape = {
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().min(1, 'Description is required'),
  imageUrl: z.string().url().optional(),
  level: z.number().int().min(0).max(9),
  school: z.enum(SPELL_SCHOOLS as unknown as [string, ...string[]]),
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
  school: z.enum(SPELL_SCHOOLS as unknown as [string, ...string[]]).optional(),
});

export const getSpellSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});
```

- [ ] **Step 2: Write `app/types/schemas/spells.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createSpellSchema, listSpellsSchema } from './spells';

const validSpell = {
  campaignId: 'c1',
  name: 'Fire Bolt',
  description: 'You hurl a mote of fire.',
  level: 0,
  school: 'evocation',
  castingTime: { value: 1, unit: 'action' },
  components: { verbal: true, somatic: true, material: false },
  range: { type: 'ranged', distance: 120 },
  duration: { type: 'instantaneous', concentration: false },
};

describe('createSpellSchema', () => {
  it('accepts a valid spell and applies array defaults', () => {
    const parsed = createSpellSchema.parse(validSpell);
    expect(parsed.modifiers).toEqual([]);
    expect(parsed.classes).toEqual([]);
    expect(parsed.ritual).toBe(false);
    expect(parsed.areaOfEffect).toEqual({ shape: 'none' });
  });

  it('rejects a missing name', () => {
    expect(() => createSpellSchema.parse({ ...validSpell, name: '' })).toThrow();
  });

  it('rejects an invalid school', () => {
    expect(() => createSpellSchema.parse({ ...validSpell, school: 'wizardry' })).toThrow();
  });

  it('rejects level above 9', () => {
    expect(() => createSpellSchema.parse({ ...validSpell, level: 10 })).toThrow();
  });
});

describe('listSpellsSchema', () => {
  it('accepts optional level/school filters', () => {
    const parsed = listSpellsSchema.parse({ campaignId: 'c1', level: 3, school: 'evocation' });
    expect(parsed.level).toBe(3);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- app/types/schemas/spells.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add app/types/schemas/spells.ts app/types/schemas/spells.test.ts
git commit -m "feat(spells): add zod schemas for spell CRUD"
```

---

## Task 3: Mongoose model

**Files:**

- Create: `app/server/db/models/Spell.ts`
- Test: `app/server/db/models/Spell.test.ts`

**Interfaces:**

- Consumes: `normalizeTags` from `~/server/utils/helpers`.
- Produces: the `Spell` Mongoose model with the full structured schema, tag-normalization hooks (copied from `Race.ts`), and indexes including `{campaignId, level}` and `{campaignId, school}`.

- [ ] **Step 1: Write `app/server/db/models/Spell.ts`**

```ts
import mongoose from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const diceSchema = new mongoose.Schema({ count: Number, sides: Number }, { _id: false });

const modifierSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    dice: { type: diceSchema, default: undefined },
    fixedValue: Number,
    damageType: String,
    atHigherLevels: String,
    notes: String,
  },
  { _id: false }
);

const conditionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    action: { type: String, required: true },
    condition: { type: String, required: true },
  },
  { _id: false }
);

const higherLevelSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    level: { type: Number, required: true },
    description: { type: String, required: true },
  },
  { _id: false }
);

const spellSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  source: { type: String, enum: ['srd', 'homebrew'], default: 'homebrew' },
  name: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String },
  level: { type: Number, required: true, min: 0, max: 9 },
  school: { type: String, required: true },
  version: { type: String },
  castingTime: {
    value: { type: Number, default: 1 },
    unit: { type: String, default: 'action' },
    reactionCondition: { type: String },
  },
  components: {
    verbal: { type: Boolean, default: false },
    somatic: { type: Boolean, default: false },
    material: { type: Boolean, default: false },
    materialDescription: { type: String },
  },
  range: {
    type: { type: String, default: 'self' },
    distance: { type: Number },
  },
  duration: {
    type: { type: String, default: 'instantaneous' },
    value: { type: Number },
    unit: { type: String },
    concentration: { type: Boolean, default: false },
  },
  ritual: { type: Boolean, default: false },
  higherLevelScaling: {
    enabled: { type: Boolean, default: false },
    type: { type: String },
  },
  classes: { type: [String], default: [] },
  attackSave: {
    kind: { type: String, default: 'none' },
    attackType: { type: String },
    saveAbility: { type: String },
    saveEffect: { type: String },
  },
  modifiers: { type: [modifierSchema], default: [] },
  conditions: { type: [conditionSchema], default: [] },
  higherLevels: { type: [higherLevelSchema], default: [] },
  areaOfEffect: {
    shape: { type: String, default: 'none' },
    size: { type: Number },
    width: { type: Number },
  },
  tags: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

spellSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags);
  }
  this.updatedAt = new Date();
});

spellSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate() as unknown;
  if (!update) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose update object
  const updateObj = update as Record<string, any>;
  if ('$set' in updateObj) {
    const set = (updateObj.$set ??= {});
    if (Array.isArray(set.tags)) {
      set.tags = normalizeTags(set.tags as string[]);
    }
    set.updatedAt = new Date();
  } else {
    if (Array.isArray(updateObj.tags)) {
      updateObj.tags = normalizeTags(updateObj.tags as string[]);
    }
    updateObj.updatedAt = new Date();
  }
});

// istanbul ignore next
if (typeof (spellSchema as { index?: unknown }).index === 'function') {
  spellSchema.index({ campaignId: 1 });
  spellSchema.index({ campaignId: 1, updatedAt: -1 });
  spellSchema.index({ campaignId: 1, level: 1 });
  spellSchema.index({ campaignId: 1, school: 1 });
  spellSchema.index({ createdBy: 1 });
  spellSchema.index({ tags: 1 });
  spellSchema.index({ name: 'text', description: 'text' });
}

export const Spell = mongoose.models.Spell || mongoose.model('Spell', spellSchema);
```

- [ ] **Step 2: Write `app/server/db/models/Spell.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Spell } from './Spell';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('Spell model', () => {
  it('normalizes tags and stamps updatedAt on save', async () => {
    const spell = new Spell({
      campaignId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(),
      name: 'Fire Bolt',
      description: 'A mote of fire.',
      level: 0,
      school: 'evocation',
      tags: ['#Damage', 'damage', 'Fire'],
    });
    await spell.save();
    expect(spell.tags).toEqual(['damage', 'fire']);
    expect(spell.updatedAt).toBeInstanceOf(Date);
  });

  it('persists nested modifiers with dice', async () => {
    const spell = await Spell.create({
      campaignId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(),
      name: 'Fireball',
      description: 'A bright streak.',
      level: 3,
      school: 'evocation',
      source: 'srd',
      modifiers: [{ id: 'm1', type: 'damage', dice: { count: 8, sides: 6 }, damageType: 'fire' }],
      areaOfEffect: { shape: 'sphere', size: 20 },
    });
    const found = await Spell.findById(spell._id).lean();
    expect(found.modifiers[0].dice).toEqual({ count: 8, sides: 6 });
    expect(found.areaOfEffect.shape).toBe('sphere');
    expect(found.source).toBe('srd');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- app/server/db/models/Spell.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add app/server/db/models/Spell.ts app/server/db/models/Spell.test.ts
git commit -m "feat(spells): add Spell mongoose model"
```

---

## Task 4: Server functions (CRUD + duplicate, SRD read-only protection)

**Files:**

- Create: `app/server/functions/spells.ts`
- Test: `app/server/functions/spells.test.ts`

**Interfaces:**

- Consumes: `requireCampaignMember`, `Spell` model, `normalizeTags`, `ensureTags` (from `./tags`), telemetry helpers, schemas from Task 2, types from Task 1.
- Produces: `createSpell`, `updateSpell`, `deleteSpell`, `duplicateSpell`, `listSpells`, `getSpell` — each `async ({ data }) => ...`. `canEdit === member.isGM && spell.source === 'homebrew'`. `updateSpell`/`deleteSpell` throw `'SRD spells are read-only'` when `source === 'srd'`.

- [ ] **Step 1: Write the failing test `app/server/functions/spells.test.ts`**

This test mocks `requireCampaignMember` (so no auth/session needed) and runs the real Mongoose logic against mongodb-memory-server.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const gmId = new mongoose.Types.ObjectId();
const campaignId = new mongoose.Types.ObjectId().toString();
let isGM = true;

vi.mock('../utils/requireCampaignMember', () => ({
  requireCampaignMember: vi.fn(async () => ({
    userId: gmId.toString(),
    sessionUserId: 'session-user',
    isGM,
  })),
}));
vi.mock('../utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('./tags', () => ({ ensureTags: vi.fn(async () => {}) }));

import {
  createSpell,
  updateSpell,
  deleteSpell,
  duplicateSpell,
  listSpells,
  getSpell,
} from './spells';
import { Spell } from '../db/models/Spell';

let mongod: MongoMemoryServer;

const baseSpell = {
  campaignId,
  name: 'Fire Bolt',
  description: 'A mote of fire.',
  level: 0,
  school: 'evocation' as const,
  castingTime: { value: 1, unit: 'action' as const },
  components: { verbal: true, somatic: true, material: false },
  range: { type: 'ranged' as const, distance: 120 },
  duration: { type: 'instantaneous' as const, concentration: false },
  ritual: false,
  higherLevelScaling: { enabled: false },
  classes: ['Wizard'],
  attackSave: { kind: 'attack' as const, attackType: 'ranged' as const },
  modifiers: [],
  conditions: [],
  higherLevels: [],
  areaOfEffect: { shape: 'none' as const },
  tags: ['fire'],
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  isGM = true;
  await Spell.deleteMany({});
});

describe('createSpell', () => {
  it('creates a homebrew spell for a GM and returns canEdit true', async () => {
    const spell = await createSpell({ data: baseSpell });
    expect(spell.source).toBe('homebrew');
    expect(spell.canEdit).toBe(true);
    expect(spell.name).toBe('Fire Bolt');
  });

  it('forbids a non-GM from creating', async () => {
    isGM = false;
    await expect(createSpell({ data: baseSpell })).rejects.toThrow('Forbidden');
  });
});

describe('updateSpell / deleteSpell SRD protection', () => {
  it('rejects updating an SRD spell', async () => {
    const doc = await Spell.create({ ...baseSpell, createdBy: gmId, source: 'srd' });
    await expect(
      updateSpell({ data: { ...baseSpell, id: doc._id.toString(), name: 'Hacked' } })
    ).rejects.toThrow('read-only');
  });

  it('rejects deleting an SRD spell', async () => {
    const doc = await Spell.create({ ...baseSpell, createdBy: gmId, source: 'srd' });
    await expect(deleteSpell({ data: { id: doc._id.toString(), campaignId } })).rejects.toThrow(
      'read-only'
    );
  });

  it('allows updating a homebrew spell', async () => {
    const created = await createSpell({ data: baseSpell });
    const updated = await updateSpell({ data: { ...baseSpell, id: created.id, name: 'New Name' } });
    expect(updated.name).toBe('New Name');
  });
});

describe('duplicateSpell', () => {
  it('copies an SRD spell into an editable homebrew copy', async () => {
    const doc = await Spell.create({ ...baseSpell, createdBy: gmId, source: 'srd' });
    const copy = await duplicateSpell({ data: { id: doc._id.toString(), campaignId } });
    expect(copy.source).toBe('homebrew');
    expect(copy.canEdit).toBe(true);
    expect(copy.name).toContain('Copy');
    expect(copy.id).not.toBe(doc._id.toString());
  });

  it('forbids a non-GM from duplicating', async () => {
    const doc = await Spell.create({ ...baseSpell, createdBy: gmId, source: 'srd' });
    isGM = false;
    await expect(duplicateSpell({ data: { id: doc._id.toString(), campaignId } })).rejects.toThrow(
      'Forbidden'
    );
  });
});

describe('listSpells', () => {
  it('filters by level and school and sets canEdit per source for a GM', async () => {
    await Spell.create({ ...baseSpell, createdBy: gmId, source: 'srd' });
    await Spell.create({ ...baseSpell, createdBy: gmId, source: 'homebrew', level: 3 });
    const level0 = await listSpells({ data: { campaignId, level: 0 } });
    expect(level0).toHaveLength(1);
    expect(level0[0].canEdit).toBe(false); // srd, even for GM
    const all = await listSpells({ data: { campaignId } });
    const homebrew = all.find((s) => s.level === 3);
    expect(homebrew?.canEdit).toBe(true);
  });

  it('gives players canEdit false everywhere', async () => {
    await Spell.create({ ...baseSpell, createdBy: gmId, source: 'homebrew' });
    isGM = false;
    const list = await listSpells({ data: { campaignId } });
    expect(list[0].canEdit).toBe(false);
  });
});

describe('getSpell', () => {
  it('returns the full spell with canEdit', async () => {
    const created = await createSpell({ data: baseSpell });
    const fetched = await getSpell({ data: { id: created.id, campaignId } });
    expect(fetched?.description).toBe('A mote of fire.');
    expect(fetched?.canEdit).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- app/server/functions/spells.test.ts`
Expected: FAIL — `Cannot find module './spells'`.

- [ ] **Step 3: Write `app/server/functions/spells.ts`**

```ts
import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Spell } from '../db/models/Spell';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { normalizeTags } from '../utils/helpers';
import { ensureTags as ensureTagsFn } from './tags';
import type { SpellData, SpellListItem, SpellSource } from '~/types/spell';
import {
  createSpellSchema,
  updateSpellSchema,
  deleteSpellSchema,
  duplicateSpellSchema,
  listSpellsSchema,
  getSpellSchema,
} from '~/types/schemas/spells';

// Fields copied verbatim from a stored doc into a serialized payload.
const STRUCTURED_FIELDS = [
  'name',
  'description',
  'imageUrl',
  'level',
  'school',
  'version',
  'castingTime',
  'components',
  'range',
  'duration',
  'ritual',
  'higherLevelScaling',
  'classes',
  'attackSave',
  'modifiers',
  'conditions',
  'higherLevels',
  'areaOfEffect',
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose lean/doc
function serializeSpell(s: any): Omit<SpellData, 'canEdit'> {
  const out: Record<string, unknown> = {
    id: String(s._id),
    campaignId: String(s.campaignId),
    createdBy: String(s.createdBy),
    source: (s.source ?? 'homebrew') as SpellSource,
    tags: s.tags ?? [],
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : '',
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : '',
  };
  for (const f of STRUCTURED_FIELDS) {
    out[f] = s[f];
  }
  return out as unknown as Omit<SpellData, 'canEdit'>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mongoose lean/doc
function serializeSpellListItem(s: any): Omit<SpellListItem, 'canEdit'> {
  return {
    id: String(s._id),
    campaignId: String(s.campaignId),
    createdBy: String(s.createdBy),
    source: (s.source ?? 'homebrew') as SpellSource,
    name: s.name ?? '',
    level: s.level ?? 0,
    school: s.school,
    tags: s.tags ?? [],
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : '',
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- data body
function structuredBody(data: any) {
  const body: Record<string, unknown> = {};
  for (const f of STRUCTURED_FIELDS) {
    if (data[f] !== undefined) body[f] = data[f];
  }
  return body;
}

export { createSpellSchema };
export const createSpell = async ({ data }: { data: z.infer<typeof createSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const finalTags = normalizeTags(data.tags ?? []);
    const spell = new Spell({
      ...structuredBody(data),
      campaignId: data.campaignId,
      createdBy: member.userId,
      source: 'homebrew',
      tags: finalTags,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await spell.save();

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }

    serverCaptureEvent(sessionUserId!, 'spell_created', {
      campaign_id: data.campaignId,
      spell_id: String(spell._id),
    });

    return { ...serializeSpell(spell), canEdit: true } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'createSpell' });
    throw e;
  }
};

export { updateSpellSchema };
export const updateSpell = async ({ data }: { data: z.infer<typeof updateSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const existing = await Spell.findOne({ _id: data.id, campaignId: data.campaignId });
    if (!existing) throw new Error('Spell not found');
    if (existing.source === 'srd') throw new Error('SRD spells are read-only');

    const finalTags = normalizeTags(data.tags ?? []);
    const spell = await Spell.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      { $set: { ...structuredBody(data), tags: finalTags, updatedAt: new Date() } },
      { new: true }
    );
    if (!spell) throw new Error('Spell not found');

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }

    serverCaptureEvent(sessionUserId!, 'spell_updated', {
      campaign_id: data.campaignId,
      spell_id: data.id,
    });

    return { ...serializeSpell(spell), canEdit: true } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updateSpell' });
    throw e;
  }
};

export { deleteSpellSchema };
export const deleteSpell = async ({ data }: { data: z.infer<typeof deleteSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const spell = await Spell.findOne({ _id: data.id, campaignId: data.campaignId });
    if (!spell) throw new Error('Spell not found');
    if (spell.source === 'srd') throw new Error('SRD spells are read-only');

    await spell.deleteOne();

    serverCaptureEvent(sessionUserId!, 'spell_deleted', {
      campaign_id: data.campaignId,
      spell_id: data.id,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deleteSpell' });
    throw e;
  }
};

export { duplicateSpellSchema };
export const duplicateSpell = async ({ data }: { data: z.infer<typeof duplicateSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const source = await Spell.findOne({ _id: data.id, campaignId: data.campaignId }).lean();
    if (!source) throw new Error('Spell not found');

    const body = structuredBody(source);
    const copy = new Spell({
      ...body,
      name: `${source.name} (Copy)`,
      campaignId: data.campaignId,
      createdBy: member.userId,
      source: 'homebrew',
      tags: source.tags ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await copy.save();

    serverCaptureEvent(sessionUserId!, 'spell_duplicated', {
      campaign_id: data.campaignId,
      source_spell_id: data.id,
      spell_id: String(copy._id),
    });

    return { ...serializeSpell(copy), canEdit: true } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'duplicateSpell' });
    throw e;
  }
};

export { listSpellsSchema };
export const listSpells = async ({ data }: { data: z.infer<typeof listSpellsSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const filter: Record<string, unknown> = { campaignId: data.campaignId };
    if (data.search) filter.$text = { $search: data.search };
    if (typeof data.level === 'number') filter.level = data.level;
    if (data.school) filter.school = data.school;
    if (data.tags && data.tags.length > 0) {
      const normalizedTags = [...new Set(normalizeTags(data.tags))];
      if (normalizedTags.length > 0) filter.tags = { $all: normalizedTags };
    }

    const spells = await Spell.find(filter)
      .select('name level school source tags campaignId createdBy createdAt updatedAt')
      .sort({ level: 1, name: 1 })
      .lean();

    return spells.map((s) => ({
      ...serializeSpellListItem(s),
      canEdit: member.isGM && (s.source ?? 'homebrew') === 'homebrew',
    })) as SpellListItem[];
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listSpells' });
    throw e;
  }
};

export { getSpellSchema };
export const getSpell = async ({ data }: { data: z.infer<typeof getSpellSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const spell = await Spell.findOne({ _id: data.id, campaignId: data.campaignId }).lean();
    if (!spell) return null;

    return {
      ...serializeSpell(spell),
      canEdit: member.isGM && (spell.source ?? 'homebrew') === 'homebrew',
    } as SpellData;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getSpell' });
    throw e;
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/server/functions/spells.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean (no new warnings).

```bash
git add app/server/functions/spells.ts app/server/functions/spells.test.ts
git commit -m "feat(spells): add CRUD + duplicate server functions with SRD read-only protection"
```

---

## Task 5: Client query hook + query keys

**Files:**

- Modify: `app/utils/queryKeys.ts` (add `spells` block after the `races` block, ~line 91)
- Create: `app/hooks/useSpells.ts`

**Interfaces:**

- Consumes: schemas from Task 2, types from Task 1, server functions from Task 4.
- Produces: `useSpells(campaignId, filters?)`, `useSpell(id, campaignId)`, `useCreateSpell()`, `useUpdateSpell()`, `useDeleteSpell()`, `useDuplicateSpell()`. Filters interface: `{ search?, tags?, level?, school?, enabled? }`. Mutation wrappers return the payload or `null` on failure (`create`, `update`, `remove`, `duplicate`).

- [ ] **Step 1: Add the `spells` block to `app/utils/queryKeys.ts`**

Insert immediately after the `races: { ... },` block (which ends at line 91):

```ts
  spells: {
    all: ['spells'] as const,
    list: (
      campaignId: string,
      search?: string,
      tags?: string[],
      level?: number,
      school?: string
    ) => ['spells', 'list', campaignId, search ?? '', tags ?? [], level ?? null, school ?? ''] as const,
    detail: (id: string, campaignId?: string) =>
      ['spells', 'detail', campaignId ?? '', id] as const,
  },
```

- [ ] **Step 2: Write `app/hooks/useSpells.ts`**

```ts
import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SpellData, SpellListItem } from '~/types/spell';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listSpellsSchema,
  getSpellSchema,
  createSpellSchema,
  updateSpellSchema,
  deleteSpellSchema,
  duplicateSpellSchema,
} from '~/types/schemas/spells';

const listSpellsFn = createServerFn({ method: 'GET' })
  .inputValidator(listSpellsSchema)
  .handler(async ({ data }) => {
    const { listSpells } = await import('~/server/functions/spells');
    return listSpells({ data });
  });

const getSpellFn = createServerFn({ method: 'GET' })
  .inputValidator(getSpellSchema)
  .handler(async ({ data }) => {
    const { getSpell } = await import('~/server/functions/spells');
    return getSpell({ data });
  });

const createSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(createSpellSchema)
  .handler(async ({ data }) => {
    const { createSpell } = await import('~/server/functions/spells');
    return createSpell({ data });
  });

const updateSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSpellSchema)
  .handler(async ({ data }) => {
    const { updateSpell } = await import('~/server/functions/spells');
    return updateSpell({ data });
  });

const deleteSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteSpellSchema)
  .handler(async ({ data }) => {
    const { deleteSpell } = await import('~/server/functions/spells');
    return deleteSpell({ data });
  });

const duplicateSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(duplicateSpellSchema)
  .handler(async ({ data }) => {
    const { duplicateSpell } = await import('~/server/functions/spells');
    return duplicateSpell({ data });
  });

interface ListSpellsFilters {
  search?: string;
  tags?: string[];
  level?: number;
  school?: string;
  enabled?: boolean;
}

export function useSpells(campaignId: string, filters?: ListSpellsFilters) {
  const { search, tags, level, school } = filters ?? {};
  const {
    data: spells = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.spells.list(campaignId, search, tags, level, school),
    queryFn: () => listSpellsFn({ data: { campaignId, search, tags, level, school } }),
    enabled: (filters?.enabled ?? true) && !!campaignId,
  });
  return {
    spells: spells as SpellListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useSpell(id: string, campaignId: string) {
  const {
    data: spell = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.spells.detail(id, campaignId),
    queryFn: () => getSpellFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });
  return {
    spell: spell as SpellData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- server fn input type is broad
type CreateSpellInput = Parameters<typeof createSpellFn>[0]['data'];
type UpdateSpellInput = Parameters<typeof updateSpellFn>[0]['data'];

function errString(e: unknown): string | null {
  return e instanceof Error ? e.message : e ? String(e) : null;
}

export function useCreateSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateSpellInput) => createSpellFn({ data: input }),
    onSuccess: (_d, { campaignId }) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', campaignId], exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => captureException(e, { action: 'createSpell' }),
  });
  const create = async (input: CreateSpellInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { create, isLoading: mutation.isPending, error: errString(mutation.error) };
}

export function useUpdateSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: UpdateSpellInput) => updateSpellFn({ data: input }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', v.campaignId], exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.spells.detail(v.id, v.campaignId) });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(v.campaignId) });
    },
    onError: (e, v) => captureException(e, { action: 'updateSpell', spellId: v.id }),
  });
  const update = async (input: UpdateSpellInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { update, isLoading: mutation.isPending, error: errString(mutation.error) };
}

export function useDeleteSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { id: string; campaignId: string }) => deleteSpellFn({ data: input }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', v.campaignId], exact: false });
      qc.removeQueries({ queryKey: queryKeys.spells.detail(v.id, v.campaignId) });
    },
    onError: (e, v) => captureException(e, { action: 'deleteSpell', spellId: v.id }),
  });
  const remove = async (input: { id: string; campaignId: string }) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { remove, isLoading: mutation.isPending, error: errString(mutation.error) };
}

export function useDuplicateSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { id: string; campaignId: string }) =>
      duplicateSpellFn({ data: input }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', v.campaignId], exact: false });
    },
    onError: (e, v) => captureException(e, { action: 'duplicateSpell', spellId: v.id }),
  });
  const duplicate = async (input: { id: string; campaignId: string }) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { duplicate, isLoading: mutation.isPending, error: errString(mutation.error) };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. (No dedicated unit test — this is thin RPC wiring exercised by the e2e in Part C. The `Parameters<...>` types ensure the hook input matches the schemas.)

- [ ] **Step 4: Lint and commit**

Run: `npm run lint`
Expected: clean.

```bash
git add app/utils/queryKeys.ts app/hooks/useSpells.ts
git commit -m "feat(spells): add useSpells query/mutation hooks and query keys"
```

---

## Part A Self-Review Gate

- [ ] Run the full unit suite: `npm test` — expected: green, including the three new spell test files.
- [ ] Run `npm run typecheck && npm run lint` — expected: clean, no new warnings.
- [ ] Confirm `canEdit` logic is consistent across `listSpells`/`getSpell` (both `isGM && source === 'homebrew'`) and that `createSpell`/`updateSpell`/`duplicateSpell` return `canEdit: true`.

**End of Part A.** Part A delivers a fully tested spells backend (model, schemas, server functions, hook) with SRD read-only protection and duplicate. Parts B and C follow.
