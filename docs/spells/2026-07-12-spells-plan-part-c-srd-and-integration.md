# Spells Feature — Plan Part C: SRD Data, Importer, Campaign Checkbox, Licensing, Seed, e2e

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Continue from Parts A and B. Steps use `- [ ]`.

**Prerequisites:** Parts A (backend) and B (UI) merged.

**Goal:** Generate committed SRD 5.2.1 spell/race/rule JSON, build a deploy-safe in-app importer, wire a "Load SRD data" checkbox into campaign creation, add an SRD Licensing screen under Settings, update the Python dev seed, and add e2e coverage.

## Global Constraints (inherited)

- `npm test` / `npm run typecheck` / `npm run lint` clean; no new lint warnings.
- No new npm dependencies.
- SRD attribution wording is exact (Task 12) — SRD 5.2.1, CC-BY-4.0.
- The Node server must NOT read `docs/` at runtime; SRD data is imported as bundled JSON modules under `app/server/data/srd/`.
- Ensure `tsconfig` has `"resolveJsonModule": true` (verify in Task 12 Step 6; it is required to `import` the generated JSON).

---

## Task 12: SRD attribution constant, data generation script, generated JSON, typed loader

**Files:**

- Create: `app/server/data/srd/attribution.ts`
- Create: `docs/srd/spells/spells-5.2.1.md` (committed CC-BY source — see Step 2)
- Create: `scripts/srd/generate-srd-data.ts`
- Create: `scripts/srd/generate-srd-data.test.ts`
- Create: `app/server/data/srd/spells.json`, `races.json`, `rules.json` (generated output, committed)
- Create: `app/server/data/srd/index.ts`
- Modify: `package.json` (add `"srd:generate"` script)

**Interfaces:**

- Produces: `SRD_ATTRIBUTION`, `SRD_LICENSE_URL`, `SRD_SOURCE_URL` constants; `parseSpellMarkdown(md: string): GeneratedSpell[]` (pure, tested); `getSrdSpells()`, `getSrdRaces()`, `getSrdRules()` typed loaders returning the parsed JSON.

- [ ] **Step 1: Write `app/server/data/srd/attribution.ts`** (exact wording from SRD 5.2.1 page 1)

```ts
/** Required CC-BY-4.0 attribution for SRD 5.2.1 content. Wording is exact — do not paraphrase. */
export const SRD_ATTRIBUTION =
  'This work includes material from the System Reference Document 5.2.1 ' +
  '(“SRD 5.2.1”) by Wizards of the Coast LLC, available at ' +
  'https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative ' +
  'Commons Attribution 4.0 International License, available at ' +
  'https://creativecommons.org/licenses/by/4.0/legalcode.';

export const SRD_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/legalcode';
export const SRD_SOURCE_URL = 'https://www.dndbeyond.com/srd';
/** Public path where the bundled SRD PDF is served (see Task 15). */
export const SRD_PDF_PATH = '/srd/srd-5.2.1.pdf';
```

- [ ] **Step 2: Acquire and commit the CC-BY 5.2.1 spell source**

The SRD 5.2.1 spell content is published as CC-BY-4.0 markdown. Obtain the `spells.md` file from the CC-BY 5.2.1 markdown release (e.g. the `downfallx/dnd-5e-srd-markdown` repository — verify its README states "SRD 5.2.1 … CC-BY-4.0" before use) and save it verbatim as `docs/srd/spells/spells-5.2.1.md`. Each spell is a `### Spell Name` heading followed by an italic level/school line, bold stat labels, and description paragraphs. Commit this source file. (This is the same 5.2.1 content as `docs/srd/srd.pdf` pages 107–175; the markdown is used because its linear per-spell structure parses reliably.)

If the obtained file uses markdown tables instead of bold labels for the stat block, first normalize it to the bold-label format the parser below expects (`**Casting Time:** …` etc.) — a one-time text transform.

- [ ] **Step 3: Write `scripts/srd/generate-srd-data.ts`**

```ts
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'app', 'server', 'data', 'srd');

const SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
];

export interface GeneratedSpell {
  name: string;
  description: string;
  level: number;
  school: string;
  castingTime: { value: number; unit: string; reactionCondition?: string };
  components: {
    verbal: boolean;
    somatic: boolean;
    material: boolean;
    materialDescription?: string;
  };
  range: { type: string; distance?: number };
  duration: { type: string; value?: number; unit?: string; concentration: boolean };
  ritual: boolean;
  higherLevelScaling: { enabled: boolean; type?: string };
  classes: string[];
  attackSave: { kind: string; attackType?: string; saveAbility?: string };
  modifiers: Array<{
    id: string;
    type: string;
    dice?: { count: number; sides: number };
    damageType?: string;
  }>;
  conditions: Array<{ id: string; action: string; condition: string }>;
  higherLevels: Array<{ id: string; level: number; description: string }>;
  areaOfEffect: { shape: string; size?: number; width?: number };
  tags: string[];
}

const SAVE_MAP: Record<string, string> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

function parseCastingTime(raw: string): GeneratedSpell['castingTime'] {
  const m = raw.match(/^(\d+)?\s*(Action|Bonus Action|Reaction|Minute|Hour)/i);
  if (!m) return { value: 1, unit: 'action' };
  const value = m[1] ? parseInt(m[1], 10) : 1;
  const unit = m[2].toLowerCase().includes('bonus')
    ? 'bonus'
    : m[2].toLowerCase().includes('reaction')
      ? 'reaction'
      : m[2].toLowerCase().startsWith('minute')
        ? 'minute'
        : m[2].toLowerCase().startsWith('hour')
          ? 'hour'
          : 'action';
  const reaction =
    unit === 'reaction' ? raw.replace(/^[^,]*,?\s*/, '').trim() || undefined : undefined;
  return { value, unit, reactionCondition: reaction };
}

function parseRange(raw: string): GeneratedSpell['range'] {
  const lower = raw.toLowerCase();
  if (lower.startsWith('self')) return { type: 'self' };
  if (lower.startsWith('touch')) return { type: 'touch' };
  if (lower.startsWith('sight')) return { type: 'sight' };
  if (lower.startsWith('unlimited')) return { type: 'unlimited' };
  const m = raw.match(/(\d+)\s*(?:feet|foot|ft)/i);
  return m ? { type: 'ranged', distance: parseInt(m[1], 10) } : { type: 'ranged' };
}

function parseComponents(raw: string): GeneratedSpell['components'] {
  const verbal = /\bV\b/.test(raw);
  const somatic = /\bS\b/.test(raw);
  const material = /\bM\b/.test(raw);
  const mat = raw.match(/M\s*\(([^)]*)\)/);
  return {
    verbal,
    somatic,
    material,
    materialDescription: mat ? mat[1].trim() : undefined,
  };
}

function parseDuration(raw: string): GeneratedSpell['duration'] {
  const lower = raw.toLowerCase();
  const concentration = lower.includes('concentration');
  if (lower.includes('instantaneous')) return { type: 'instantaneous', concentration: false };
  if (lower.includes('until dispelled')) return { type: 'until-dispelled', concentration };
  const m = raw.match(/(\d+)\s*(round|minute|hour|day)/i);
  if (m) {
    return {
      type: concentration ? 'concentration' : 'timed',
      value: parseInt(m[1], 10),
      unit: m[2].toLowerCase() as GeneratedSpell['duration']['unit'],
      concentration,
    };
  }
  return { type: concentration ? 'concentration' : 'special', concentration };
}

function parseDamage(desc: string): GeneratedSpell['modifiers'] {
  const modifiers: GeneratedSpell['modifiers'] = [];
  const re = /(\d+)d(\d+)\s+(\w+)\s+damage/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(desc)) !== null) {
    modifiers.push({
      id: `m${i++}`,
      type: 'damage',
      dice: { count: parseInt(m[1], 10), sides: parseInt(m[2], 10) },
      damageType: m[3].toLowerCase(),
    });
  }
  return modifiers;
}

function parseAttackSave(desc: string): GeneratedSpell['attackSave'] {
  const save = desc.match(
    /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i
  );
  if (save) return { kind: 'save', saveAbility: SAVE_MAP[save[1].toLowerCase()] };
  const attack = desc.match(/(melee|ranged)\s+spell attack/i);
  if (attack) return { kind: 'attack', attackType: attack[1].toLowerCase() };
  return { kind: 'none' };
}

function parseAoe(desc: string): GeneratedSpell['areaOfEffect'] {
  const m = desc.match(/(\d+)[- ]foot(?:[- ]radius)?\s+(Sphere|Cone|Cube|Line|Cylinder)/i);
  if (!m) return { shape: 'none' };
  return { shape: m[2].toLowerCase(), size: parseInt(m[1], 10) };
}

export function parseSpellMarkdown(md: string): GeneratedSpell[] {
  const blocks = md.split(/^###\s+/m).slice(1);
  const spells: GeneratedSpell[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const name = lines[0].trim();
    if (!name) continue;

    const levelLine = lines.find((l) => /^\*.*\*$/.test(l.trim())) ?? '';
    const levelText = levelLine.replace(/\*/g, '').trim().toLowerCase();
    const ritual = levelText.includes('ritual');
    let level = 0;
    let school = 'evocation';
    const lvlMatch = levelText.match(/level\s+(\d)/);
    if (lvlMatch) level = parseInt(lvlMatch[1], 10);
    for (const s of SCHOOLS) if (levelText.includes(s)) school = s;

    const label = (name2: string) => {
      const re = new RegExp(`\\*\\*${name2}:\\*\\*\\s*(.+)`, 'i');
      const m = block.match(re);
      return m ? m[1].trim() : '';
    };

    const description = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('**') && !/^\*.*\*$/.test(l.trim()) && l.trim() !== name)
      .join('\n')
      .trim();

    const higherLevels: GeneratedSpell['higherLevels'] = [];
    const hlMatch = block.match(
      /\*\*\*(?:Using a Higher-Level Spell Slot|Cantrip Upgrade)\.\*\*\*\s*(.+)/i
    );
    if (hlMatch) {
      higherLevels.push({ id: 'h0', level: level + 1, description: hlMatch[1].trim() });
    }

    spells.push({
      name,
      description: description || name,
      level,
      school,
      castingTime: parseCastingTime(label('Casting Time')),
      components: parseComponents(label('Components')),
      range: parseRange(label('Range')),
      duration: parseDuration(label('Duration')),
      ritual,
      higherLevelScaling: { enabled: higherLevels.length > 0, type: 'spell-scale' },
      classes: [],
      attackSave: parseAttackSave(description),
      modifiers: parseDamage(description),
      conditions: [],
      higherLevels,
      areaOfEffect: parseAoe(description),
      tags: ['srd', school, level === 0 ? 'cantrip' : `level-${level}`],
    });
  }
  return spells;
}

interface GeneratedDoc {
  title: string;
  content: string;
  tags: string[];
}

function generateDocsFromDir(dir: string, extraTags: (file: string) => string[]): GeneratedDoc[] {
  if (!fs.existsSync(dir)) return [];
  const out: GeneratedDoc[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const title = entry.name
          .replace(/\.md$/, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        out.push({ title, content, tags: extraTags(full) });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const spellsMd = fs.readFileSync(
    path.join(REPO_ROOT, 'docs', 'srd', 'spells', 'spells-5.2.1.md'),
    'utf-8'
  );
  const spells = parseSpellMarkdown(spellsMd);
  fs.writeFileSync(path.join(OUT_DIR, 'spells.json'), JSON.stringify(spells, null, 2) + '\n');

  const races = generateDocsFromDir(path.join(REPO_ROOT, 'docs', 'srd', 'races'), () => ['srd']);
  fs.writeFileSync(path.join(OUT_DIR, 'races.json'), JSON.stringify(races, null, 2) + '\n');

  const rules = generateDocsFromDir(path.join(REPO_ROOT, 'docs', 'srd', 'rules'), (f) => [
    'srd',
    path.basename(path.dirname(f)),
  ]);
  fs.writeFileSync(path.join(OUT_DIR, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');

  console.log(`Generated ${spells.length} spells, ${races.length} races, ${rules.length} rules.`);
}

// Only run main when executed directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('generate-srd-data.ts')) {
  main();
}
```

- [ ] **Step 4: Write `scripts/srd/generate-srd-data.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseSpellMarkdown } from './generate-srd-data';

const SAMPLE = `
### Fire Bolt
*Evocation Cantrip*
**Casting Time:** 1 Action
**Range:** 120 feet
**Components:** V, S
**Duration:** Instantaneous

You hurl a mote of fire at a creature or an object within range. Make a ranged spell attack against the target. On a hit, the target takes 1d10 Fire damage.

***Cantrip Upgrade.*** The damage increases by 1d10 when you reach levels 5, 11, and 17.

### Fireball
*Level 3 Evocation*
**Casting Time:** 1 Action
**Range:** 150 feet
**Components:** V, S, M (a ball of bat guano and sulfur)
**Duration:** Instantaneous

Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save.

***Using a Higher-Level Spell Slot.*** The damage increases by 1d6 for each spell slot level above 3.
`;

describe('parseSpellMarkdown', () => {
  const spells = parseSpellMarkdown(SAMPLE);

  it('parses both spells', () => {
    expect(spells).toHaveLength(2);
    expect(spells.map((s) => s.name)).toEqual(['Fire Bolt', 'Fireball']);
  });

  it('parses cantrip level and school', () => {
    const bolt = spells[0];
    expect(bolt.level).toBe(0);
    expect(bolt.school).toBe('evocation');
    expect(bolt.range).toEqual({ type: 'ranged', distance: 120 });
    expect(bolt.attackSave).toEqual({ kind: 'attack', attackType: 'ranged' });
    expect(bolt.modifiers[0].dice).toEqual({ count: 1, sides: 10 });
    expect(bolt.modifiers[0].damageType).toBe('fire');
  });

  it('parses leveled spell with material, save, aoe, higher levels', () => {
    const ball = spells[1];
    expect(ball.level).toBe(3);
    expect(ball.components.material).toBe(true);
    expect(ball.components.materialDescription).toBe('a ball of bat guano and sulfur');
    expect(ball.attackSave).toEqual({ kind: 'save', saveAbility: 'dex' });
    expect(ball.areaOfEffect).toEqual({ shape: 'sphere', size: 20 });
    expect(ball.higherLevels).toHaveLength(1);
    expect(ball.modifiers[0].dice).toEqual({ count: 8, sides: 6 });
  });
});
```

- [ ] **Step 5: Run the parser test**

Run: `npm test -- scripts/srd/generate-srd-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify `resolveJsonModule`, add npm script, run the generator**

Confirm `tsconfig.json` (or the referenced base config) has `"resolveJsonModule": true`. If absent, add it.

Add to `package.json` scripts:

```json
    "srd:generate": "tsx scripts/srd/generate-srd-data.ts",
```

Run: `npm run srd:generate`
Expected: prints counts; writes `app/server/data/srd/spells.json`, `races.json`, `rules.json`.

- [ ] **Step 7: MANUAL QA GATE (required before commit)**

Spot-check the generated `spells.json` against `docs/srd/srd.pdf`:

1. Pick 10 spells across levels/schools (include a cone spell like Burning Hands, a line spell like Lightning Bolt, a healing spell like Cure Wounds, a ritual like Detect Magic).
2. Verify `level`, `school`, `castingTime`, `range`, `components` (incl. material text), `duration.concentration`, `modifiers` dice+type, `attackSave`, `areaOfEffect.shape/size`.
3. Fix parser edge cases in `generate-srd-data.ts`, re-run `npm run srd:generate`, re-run the parser test, and re-check until the sample is correct.
4. Confirm total spell count is plausible (SRD 5.2.1 has ~300+ spells).

Note in the commit message any known gaps (e.g. `classes` left empty — populated in a follow-up class-list pass; log this so it's not mistaken for complete coverage).

- [ ] **Step 8: Write `app/server/data/srd/index.ts`**

```ts
import spellsJson from './spells.json';
import racesJson from './races.json';
import rulesJson from './rules.json';
import type { GeneratedSpell } from '../../../../scripts/srd/generate-srd-data';

export interface GeneratedDoc {
  title: string;
  content: string;
  tags: string[];
}

export function getSrdSpells(): GeneratedSpell[] {
  return spellsJson as GeneratedSpell[];
}
export function getSrdRaces(): GeneratedDoc[] {
  return racesJson as GeneratedDoc[];
}
export function getSrdRules(): GeneratedDoc[] {
  return rulesJson as GeneratedDoc[];
}
```

> If importing the `GeneratedSpell` type across the `scripts/` boundary trips lint's import rules, copy the `GeneratedSpell` interface into `app/server/data/srd/index.ts` instead of importing it (the shape is stable and small).

- [ ] **Step 9: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npm test -- scripts/srd/generate-srd-data.test.ts`
Expected: clean + PASS.

```bash
git add app/server/data/srd/ docs/srd/spells/spells-5.2.1.md scripts/srd/generate-srd-data.ts scripts/srd/generate-srd-data.test.ts package.json
git commit -m "feat(spells): generate committed SRD 5.2.1 spell/race/rule data + loaders"
```

---

## Task 13: In-app SRD importer

**Files:**

- Create: `app/server/functions/srdImport.ts`
- Test: `app/server/functions/srdImport.test.ts`

**Interfaces:**

- Consumes: `getSrdSpells`/`getSrdRaces`/`getSrdRules` (Task 12), `Spell` model, `Race` model, `Rule` model.
- Produces: `importSrdContent({ campaignId, gmId, session? }): Promise<{ spells: number; races: number; rules: number }>` — bulk-inserts SRD spells (`source: 'srd'`), races, and rules scoped to the campaign, within the optional Mongo session.

- [ ] **Step 1: Write the failing test `app/server/functions/srdImport.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

vi.mock('../data/srd', () => ({
  getSrdSpells: () => [
    {
      name: 'Fire Bolt',
      description: 'A mote of fire.',
      level: 0,
      school: 'evocation',
      castingTime: { value: 1, unit: 'action' },
      components: { verbal: true, somatic: true, material: false },
      range: { type: 'ranged', distance: 120 },
      duration: { type: 'instantaneous', concentration: false },
      ritual: false,
      higherLevelScaling: { enabled: false },
      classes: [],
      attackSave: { kind: 'attack', attackType: 'ranged' },
      modifiers: [{ id: 'm0', type: 'damage', dice: { count: 1, sides: 10 }, damageType: 'fire' }],
      conditions: [],
      higherLevels: [],
      areaOfEffect: { shape: 'none' },
      tags: ['srd', 'evocation', 'cantrip'],
    },
  ],
  getSrdRaces: () => [{ title: 'Elf', content: '# Elf', tags: ['srd'] }],
  getSrdRules: () => [{ title: 'Cover', content: '# Cover', tags: ['srd', 'combat'] }],
}));

import { importSrdContent } from './srdImport';
import { Spell } from '../db/models/Spell';
import { Race } from '../db/models/Race';
import { Rule } from '../db/models/Rule';

let mongod: MongoMemoryServer;
const campaignId = new mongoose.Types.ObjectId().toString();
const gmId = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await Promise.all([Spell.deleteMany({}), Race.deleteMany({}), Rule.deleteMany({})]);
});

describe('importSrdContent', () => {
  it('inserts srd spells, races, and rules scoped to the campaign', async () => {
    const result = await importSrdContent({ campaignId, gmId });
    expect(result).toEqual({ spells: 1, races: 1, rules: 1 });

    const spell = await Spell.findOne({ campaignId });
    expect(spell?.source).toBe('srd');
    expect(spell?.name).toBe('Fire Bolt');
    expect(String(spell?.createdBy)).toBe(gmId);

    expect(await Race.countDocuments({ campaignId })).toBe(1);
    expect(await Rule.countDocuments({ campaignId })).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- app/server/functions/srdImport.test.ts`
Expected: FAIL — `Cannot find module './srdImport'`.

- [ ] **Step 3: Write `app/server/functions/srdImport.ts`**

```ts
import type { ClientSession } from 'mongoose';
import { Spell } from '../db/models/Spell';
import { Race } from '../db/models/Race';
import { Rule } from '../db/models/Rule';
import { getSrdSpells, getSrdRaces, getSrdRules } from '../data/srd';

interface ImportArgs {
  campaignId: string;
  gmId: string;
  session?: ClientSession;
}

/**
 * Insert all bundled SRD content (spells, races, rules) into a campaign.
 * Spells are marked source:'srd' (read-only); races/rules match the dev-seed shape.
 * Runs inside the caller's Mongo session when provided so it commits atomically.
 */
export async function importSrdContent({ campaignId, gmId, session }: ImportArgs) {
  const now = new Date();
  const opts = session ? { session } : {};

  const spellDocs = getSrdSpells().map((s) => ({
    ...s,
    source: 'srd' as const,
    campaignId,
    createdBy: gmId,
    createdAt: now,
    updatedAt: now,
  }));
  const raceDocs = getSrdRaces().map((r) => ({
    ...r,
    campaignId,
    createdBy: gmId,
    createdAt: now,
    updatedAt: now,
  }));
  const ruleDocs = getSrdRules().map((r) => ({
    ...r,
    isPublic: true,
    campaignId,
    createdBy: gmId,
    createdAt: now,
    updatedAt: now,
  }));

  if (spellDocs.length) await Spell.insertMany(spellDocs, opts);
  if (raceDocs.length) await Race.insertMany(raceDocs, opts);
  if (ruleDocs.length) await Rule.insertMany(ruleDocs, opts);

  return { spells: spellDocs.length, races: raceDocs.length, rules: ruleDocs.length };
}
```

> Verify the `Rule` model path/shape: confirm `app/server/db/models/Rule.ts` exists with `title`, `content`, `tags`, `isPublic`, `campaignId`, `createdBy` (it is used by `scripts/dev_seed.py:import_srd_rules`). If the field names differ, adjust `ruleDocs` accordingly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/server/functions/srdImport.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add app/server/functions/srdImport.ts app/server/functions/srdImport.test.ts
git commit -m "feat(spells): add in-app SRD importer (spells + races + rules)"
```

---

## Task 14: "Load SRD data" checkbox on campaign creation

**Files:**

- Modify: `app/types/schemas/campaigns.ts` (add `loadSrdData` to `campaignInputShape`)
- Modify: `app/hooks/useCampaigns.ts` (thread through `CreateCampaignInput` + `mutationFn`)
- Modify: `app/routes/campaigns/new.tsx` (checkbox in Step 4 + Review + submit)
- Modify: `app/server/functions/campaigns.ts` (call importer in the transaction)
- Test: `app/server/functions/campaigns.srd.test.ts`

**Interfaces:**

- Consumes: `importSrdContent` (Task 13).
- Produces: campaign creation optionally seeds SRD content when `loadSrdData` is true.

- [ ] **Step 1: Add `loadSrdData` to `app/types/schemas/campaigns.ts`**

In `campaignInputShape` (after `imageName`, before the closing `} as const`):

```ts
  loadSrdData: z.boolean().optional().default(false),
```

- [ ] **Step 2: Thread through `app/hooks/useCampaigns.ts`**

Add to `CreateCampaignInput` (after `imageFile?: File | null;`):

```ts
  loadSrdData?: boolean;
```

Add to the `createCampaignFn({ data: { ... } })` object in `useCreateCampaign`'s `mutationFn` (alongside `maxPlayers`):

```ts
          loadSrdData: input.loadSrdData,
```

- [ ] **Step 3: Add the checkbox to `app/routes/campaigns/new.tsx`**

Add state (near line 47, after `maxPlayers`):

```tsx
const [loadSrdData, setLoadSrdData] = useState(true);
```

Add the checkbox inside the Step 4 `<fieldset>` (after the max-player note `<p>`, before `</fieldset>` at ~line 379):

```tsx
<label className="mt-6 flex items-start gap-3 cursor-pointer">
  <input
    type="checkbox"
    checked={loadSrdData}
    onChange={(e) => setLoadSrdData(e.target.checked)}
    className="mt-0.5 h-4 w-4 accent-blue-600"
  />
  <span>
    <span className="block text-sm font-medium text-slate-300">Load SRD content</span>
    <span className="block text-xs text-slate-600">
      Adds the SRD 5.2.1 spells, races, and rules to this campaign. You can edit or remove your own
      copies later.
    </span>
  </span>
</label>
```

Add a Review row — in the `THE ROSTER` review section (line 414) change `rows` to include SRD:

```tsx
                    { title: 'THE ROSTER', rows: [
                      ['Max Players', `${maxPlayers} players`],
                      ['SRD Content', loadSrdData ? 'Loaded' : 'Not loaded'],
                    ] },
```

Pass it into `create(...)` in `handleSubmit` (line 98-108, add after `maxPlayers`):

```tsx
      loadSrdData,
```

- [ ] **Step 4: Call the importer in `app/server/functions/campaigns.ts`**

In `createCampaign`, destructure `loadSrdData` from `data` (line 321-334 block, add `loadSrdData,`). Inside the transaction, after the `Promise.all([...])` that creates Session 0 + GMScreen (after line 458) and before the `User.updateOne` sync, add:

```ts
if (loadSrdData) {
  const { importSrdContent } = await import('./srdImport');
  await importSrdContent({
    campaignId: String(campaign._id),
    gmId: String(dbUser._id),
    session: mongoSession,
  });
}
```

- [ ] **Step 5: Write `app/server/functions/campaigns.srd.test.ts`**

This test verifies the wiring calls the importer with the new campaign id when `loadSrdData` is true. It mocks the importer and session/auth dependencies.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const importSrdContent = vi.fn(async () => ({ spells: 1, races: 1, rules: 1 }));
vi.mock('./srdImport', () => ({ importSrdContent }));

// Minimal mocks so createCampaign reaches the importer branch without a real DB.
vi.mock('../session', () => ({ getSession: vi.fn(async () => ({ id: 'sess', role: 'gm' })) }));
vi.mock('../db/connection', () => ({
  connectDB: vi.fn(async () => {}),
  isDBConnected: () => true,
}));
const fakeCampaign = { _id: 'camp1', name: 'Test', inviteCode: 'AAAA-BBBB' };
vi.mock('../db/models/User', () => ({
  User: { findOne: vi.fn(async () => ({ _id: 'gm1' })), updateOne: vi.fn(async () => {}) },
}));
vi.mock('../db/models/Campaign', () => ({
  Campaign: {
    exists: vi.fn(async () => false),
    create: vi.fn(async () => [fakeCampaign]),
  },
}));
vi.mock('../db/models/Session', () => ({ Session: { create: vi.fn(async () => {}) } }));
vi.mock('../db/models/GMScreen', () => ({ GMScreen: { create: vi.fn(async () => {}) } }));
vi.mock('../utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('mongoose', async (orig) => {
  const actual = await orig<typeof import('mongoose')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      startSession: vi.fn(async () => ({
        withTransaction: async (fn: () => Promise<unknown>) => fn(),
        endSession: async () => {},
      })),
    },
  };
});

import { createCampaign } from './campaigns';

beforeEach(() => importSrdContent.mockClear());

describe('createCampaign loadSrdData', () => {
  const base = {
    name: 'Test',
    description: '',
    links: [],
    loadSrdData: true,
  } as unknown as Parameters<typeof createCampaign>[0]['data'];

  it('imports SRD content when loadSrdData is true', async () => {
    await createCampaign({ data: base });
    expect(importSrdContent).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp1', gmId: 'gm1' })
    );
  });

  it('does not import when loadSrdData is false', async () => {
    await createCampaign({ data: { ...base, loadSrdData: false } });
    expect(importSrdContent).not.toHaveBeenCalled();
  });
});
```

> If `createCampaign`'s exact internal mock surface differs (e.g. additional models referenced before the importer branch), extend the mocks until both cases run. The assertion that matters: importer called with the new campaign id iff `loadSrdData`.

- [ ] **Step 6: Run the test**

Run: `npm test -- app/server/functions/campaigns.srd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add app/types/schemas/campaigns.ts app/hooks/useCampaigns.ts app/routes/campaigns/new.tsx app/server/functions/campaigns.ts app/server/functions/campaigns.srd.test.ts
git commit -m "feat(spells): add Load SRD data checkbox to campaign creation"
```

---

## Task 15: SRD Licensing screen + served PDF

**Files:**

- Create: `public/srd/srd-5.2.1.pdf` (copy of `docs/srd/srd.pdf`)
- Create: `app/components/mainview/settings/SrdLicensingModal.tsx`
- Modify: `app/components/mainview/SettingsPanel.tsx`

**Interfaces:**

- Consumes: `SRD_ATTRIBUTION`, `SRD_LICENSE_URL`, `SRD_SOURCE_URL`, `SRD_PDF_PATH` (Task 12).
- Produces: an SRD Licensing settings category visible to all users, opening `SrdLicensingModal`.

- [ ] **Step 1: Copy the PDF into public assets**

```bash
mkdir -p public/srd
cp docs/srd/srd.pdf public/srd/srd-5.2.1.pdf
```

- [ ] **Step 2: Write `app/components/mainview/settings/SrdLicensingModal.tsx`**

```tsx
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  SRD_ATTRIBUTION,
  SRD_LICENSE_URL,
  SRD_SOURCE_URL,
  SRD_PDF_PATH,
} from '~/server/data/srd/attribution';

interface SrdLicensingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SrdLicensingModal({ isOpen, onClose }: SrdLicensingModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="srd-licensing-title"
        className="w-full max-w-lg max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="srd-licensing-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            SRD Licensing
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
          <p className="text-xs text-slate-400 leading-relaxed">
            Cartyx includes Dungeons &amp; Dragons content from the System Reference Document 5.2.1
            under the Creative Commons Attribution 4.0 International License. Required attribution:
          </p>
          <blockquote className="text-xs text-slate-300 leading-relaxed border-l-2 border-blue-500/40 pl-3 italic">
            {SRD_ATTRIBUTION}
          </blockquote>
          <div className="flex flex-col gap-2 pt-2">
            <a
              href={SRD_SOURCE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-semibold text-blue-400 hover:text-blue-300"
            >
              Official SRD 5.2.1 →
            </a>
            <a
              href={SRD_LICENSE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-semibold text-blue-400 hover:text-blue-300"
            >
              CC-BY-4.0 License →
            </a>
            <a
              href={SRD_PDF_PATH}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-semibold text-blue-400 hover:text-blue-300"
            >
              View the SRD 5.2.1 PDF →
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 3: Register the category in `app/components/mainview/SettingsPanel.tsx`**

Change the `SettingsCategoryId` type (line 7):

```tsx
type SettingsCategoryId = 'game-settings' | 'srd-licensing';
```

Add the import (after the `GameSettingsModal` import):

```tsx
import { SrdLicensingModal } from './settings/SrdLicensingModal';
import { ScrollText } from 'lucide-react';
```

Add to `SETTINGS_CATEGORIES` (line 16-18):

```tsx
  { id: 'srd-licensing', label: 'SRD Licensing', icon: ScrollText, gmOnly: false },
```

Render the modal (after the `GameSettingsModal` block, before the closing `</div>` at line 66) — note this is OUTSIDE the `isGM &&` guard so players can open it:

```tsx
<SrdLicensingModal
  isOpen={openCategory === 'srd-licensing'}
  onClose={() => setOpenCategory(null)}
/>
```

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add public/srd/srd-5.2.1.pdf app/components/mainview/settings/SrdLicensingModal.tsx app/components/mainview/SettingsPanel.tsx
git commit -m "feat(spells): add SRD licensing screen under settings"
```

---

## Task 16: Update the Python dev seed

**Files:**

- Modify: `scripts/dev_seed.py` (add `import_srd_spells`, read generated JSON, call in `bulk_test_campaign` block)

**Interfaces:**

- Consumes: the generated `app/server/data/srd/spells.json`.
- Produces: bulk-test campaigns get SRD spells seeded alongside races/rules.

- [ ] **Step 1: Add `import_srd_spells` after `import_srd_rules` (after line 88)**

```python
import json


def import_srd_spells(db, *, campaign_id, gm_id, now) -> int:
    """Insert every spell from the generated spells.json as a Spell document."""
    spells_json = REPO_ROOT / "app" / "server" / "data" / "srd" / "spells.json"
    if not spells_json.exists():
        return 0
    spells = json.loads(spells_json.read_text(encoding="utf-8"))
    docs = []
    for s in spells:
        docs.append({
            **s,
            "source": "srd",
            "campaignId": campaign_id,
            "createdBy": gm_id,
            "createdAt": now,
            "updatedAt": now,
        })
    if docs:
        db.spells.insert_many(docs)
    return len(docs)
```

- [ ] **Step 2: Call it in the `bulk_test_campaign` block (near lines 1483-1490)**

Add after the `n_rules = import_srd_rules(...)` call:

```python
            n_spells = import_srd_spells(db, campaign_id=campaign_id, gm_id=gm_id, now=now)
            print(f"    Imported {n_spells} SRD spells")
```

- [ ] **Step 3: Verify seed against an ephemeral Mongo (per the seed-testing rule)**

Do NOT run against the dev Atlas DB. Start a throwaway `mongodb-memory-server` (or a local disposable mongod), point `MONGODB_URI` at it, and run:

```bash
npm run srd:generate   # ensure spells.json exists
npm run dev:seed
```

Expected: output includes "Imported N SRD spells"; a query on `db.spells` for a bulk-test campaign returns N docs with `source: 'srd'`.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev_seed.py
git commit -m "feat(spells): seed SRD spells into bulk-test campaigns"
```

---

## Task 17: e2e coverage + final gates

**Files:**

- Create: `e2e/spells.spec.ts` (follow the existing e2e patterns/fixtures used by other wiki specs)
- Test: the full gate suite.

**Interfaces:**

- Consumes: the whole feature.

- [ ] **Step 1: Write `e2e/spells.spec.ts`**

Model it on the existing wiki e2e specs (find one, e.g. a races or rules spec, and copy its campaign/login fixture setup). The test must:

1. Log in as the GM of a campaign that has SRD spells (seeded).
2. Open the inspector Wiki tab → Spells category.
3. Assert the Spells list renders and shows a known SRD spell (e.g. "Fire Bolt").
4. Open it and assert the read-only SRD modal shows a "Duplicate to Homebrew" button.
5. Open Settings → SRD Licensing and assert the attribution text is visible.

```ts
import { test, expect } from '@playwright/test';
// Reuse the shared login/campaign fixture from the existing e2e suite.
// import { loginAsGM, openCampaign } from './fixtures';  // adjust to the real helper names

test.describe('Spells wiki', () => {
  test('GM can browse SRD spells and see licensing', async ({ page }) => {
    // await loginAsGM(page);
    // await openCampaign(page, { withSrd: true });

    await page.getByRole('button', { name: 'Wiki' }).click();
    await page.getByRole('button', { name: 'Spells' }).click();
    await expect(page.getByText('Fire Bolt')).toBeVisible();

    await page.getByText('Fire Bolt').click();
    await expect(page.getByRole('button', { name: /Duplicate to Homebrew/i })).toBeVisible();
    await page.getByRole('button', { name: 'Close modal' }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'SRD Licensing' }).click();
    await expect(page.getByText(/System Reference Document 5\.2\.1/)).toBeVisible();
  });
});
```

> Adjust selectors/fixtures to match the real e2e harness (tab buttons, login helper, campaign seeding). The assertions above are the contract; the wiring follows the repo's existing e2e conventions.

- [ ] **Step 2: Run e2e**

Run: `npm run e2e -- spells`
Expected: PASS.

- [ ] **Step 3: Full gate suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green; 0 lint errors; no new warnings beyond the ~24 baseline.

- [ ] **Step 4: Commit**

```bash
git add e2e/spells.spec.ts
git commit -m "test(spells): add e2e coverage for spells wiki and licensing"
```

---

## Part C Self-Review Gate & Feature Wrap

- [ ] **Spec coverage:** every design-doc requirement maps to a task —
  - structured model → Part A Task 3; full parity fields → Parts A/B.
  - SRD read-only + duplicate → Part A Task 4; SRD source flag → Task 3.
  - generated SRD 5.2.1 JSON + attribution → Part C Task 12.
  - in-app importer + "Load SRD data" checkbox (spells + races + rules) → Tasks 13–14.
  - SRD Licensing screen (all users, PDF link) → Task 15.
  - level/school/tag filters → Part B Task 11.
  - dev seed → Task 16; tests + e2e → throughout + Task 17.
- [ ] **Type consistency:** `GeneratedSpell` (Task 12) ⊇ the fields `importSrdContent` (Task 13) spreads into `Spell` (Part A Task 3) with `source: 'srd'` added; `loadSrdData` name identical across schema/hook/route/server (Task 14).
- [ ] **No new npm deps** were added.
- [ ] Open a PR against **`dev`** (never `main`).

**Out of scope (deferred, per the design doc):** rolling dice from a spell (Phase 2), drawing spells on the map (Phase 3), importing SRD into pre-existing campaigns, "show spell card on tabletop"/GM-screen embedding, spell image upload, populating `classes[]` from the per-class SRD spell lists (a follow-up extraction pass — log the empty `classes` in Task 12 so coverage isn't overstated).
