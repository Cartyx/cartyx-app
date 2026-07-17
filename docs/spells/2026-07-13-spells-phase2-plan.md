# Spells Phase 2 Implementation Plan — Roll Damage from a Spell

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Roll a spell's damage/healing from the spell view (roll chip per modifier), with higher-level slot + cantrip scaling and a crit toggle, broadcast to the session dice log.

**Architecture:** Add structured `scaling` (per-step dice) to spell modifiers and capture healing dice in the generator; a pure client dice module computes the scaled pool; `SpellWindow` renders roll chips + a cast-level selector + crit toggle that call the existing `rollDice → toParsedDiceRoll → requestDiceBroadcast` path.

**Tech Stack:** TanStack Start (React 19), TypeScript, Mongoose, Zod, Vitest, existing dice engine (`app/utils/dice.ts`, `app/utils/diceRollerBridge.ts`).

**Spec:** `docs/spells/2026-07-13-spells-phase2-dice-design.md`

## Global Constraints

- Tests live under `tests/` mirroring app paths (`~/` imports). Mongoose is globally mocked (`tests/setup.ts`) — NO mongodb-memory-server. Model tests are existence-level; the pattern for server logic is `tests/server/functions/rules.test.ts`.
- `npm test` (`vitest run --project unit`), `npm run typecheck`, `npm run lint` all clean; lint baseline is 0 errors + 24 warnings — add no new warnings.
- No new npm dependencies.
- Dice sides are constrained to `4|6|8|10|12|20|100` (`DieSides`); spell dice use `4|6|8|10|12`.
- `scaling.perStep.sides === dice.sides` for all SRD spells; the roll logic merges them into one pool entry on that assumption (documented in `spellDice.ts`).
- The generator (`scripts/`) is eslint-ignored; its logic is covered by `tests/srd/generate-srd-data.test.ts`.
- After regenerating `spells.json`, dev must be reset via the `resetting-dev-data` skill (`npm run dev:clear -- --force` then `npm run dev:seed`) — Task 6.

---

## Task 1: Add `scaling` to the spell modifier (types, Zod, model)

**Files:**

- Modify: `app/types/spell.ts` (add `scaling` to `SpellModifier`)
- Modify: `app/types/schemas/spells.ts` (add `scaling` to `modifierSchema`)
- Modify: `app/server/db/models/Spell.ts` (add `scaling` to `modifierSchema`)
- Test: `tests/types/schemas/spells.test.ts` (extend)

**Interfaces:**

- Produces: `SpellModifier.scaling?: { perStep: SpellDice }`, accepted by `createSpellSchema`/`updateSpellSchema` and persisted by the model. Consumed by Tasks 2 (generator), 4 (spellDice), 5 (UI).

- [ ] **Step 1: Add the type** — in `app/types/spell.ts`, add `scaling` to `SpellModifier` (after `dice`):

```ts
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
```

- [ ] **Step 2: Add to the Zod modifier schema** — in `app/types/schemas/spells.ts`, add to `modifierSchema` (after `dice: diceSchema.optional(),`):

```ts
  scaling: z.object({ perStep: diceSchema }).optional(),
```

- [ ] **Step 3: Add to the Mongoose modifier schema** — in `app/server/db/models/Spell.ts`, add to `modifierSchema` (after the `dice` line):

```ts
    scaling: {
      perStep: { type: diceSchema, default: undefined },
    },
```

- [ ] **Step 4: Extend the schema test** — in `tests/types/schemas/spells.test.ts`, add a case asserting a modifier with `scaling` parses:

```ts
it('accepts a damage modifier with scaling', () => {
  const parsed = createSpellSchema.parse({
    ...validSpell,
    modifiers: [
      {
        id: 'm0',
        type: 'damage',
        dice: { count: 8, sides: 6 },
        scaling: { perStep: { count: 1, sides: 6 } },
      },
    ],
  });
  expect(parsed.modifiers[0].scaling).toEqual({ perStep: { count: 1, sides: 6 } });
});
```

- [ ] **Step 5: Run + commit**

Run: `npm test -- tests/types/schemas/spells.test.ts` (PASS), then `npm run typecheck && npm run lint` (clean).

```bash
git add app/types/spell.ts app/types/schemas/spells.ts app/server/db/models/Spell.ts tests/types/schemas/spells.test.ts
git commit -m "feat(spells): add scaling (per-step dice) to spell modifiers"
```

---

## Task 2: Generator — capture healing dice + extract scaling

**Files:**

- Modify: `scripts/srd/generate-srd-data.ts`
- Modify: `tests/srd/generate-srd-data.test.ts`
- Regenerate: `app/server/data/srd/spells.json` (via `npm run srd:generate`)

**Interfaces:**

- Consumes: nothing new. Produces: each SRD spell may now have a `type:'healing'` modifier and/or a `modifiers[i].scaling.perStep`. `GeneratedSpell.modifiers[]` entries gain an optional `scaling`.

- [ ] **Step 1: Extend `GeneratedSpell.modifiers` type** — in `scripts/srd/generate-srd-data.ts` (and the mirror in `app/server/data/srd/index.ts`), add `scaling?: { perStep: { count: number; sides: number } }` to the modifier element type.

- [ ] **Step 2: Add healing + scaling parsers** — after `parseDamage`, add:

```ts
function parseHealing(desc: string): GeneratedSpell['modifiers'] {
  // e.g. "regains a number of Hit Points equal to 2d8 …", "regains Hit Points equal to 2d4"
  const m = desc.match(/(?:regains?|restores?)[^.]*?(\d+)d(\d+)/i);
  if (!m) return [];
  return [
    { id: 'h0', type: 'healing', dice: { count: parseInt(m[1], 10), sides: parseInt(m[2], 10) } },
  ];
}

// Per-step scaling dice, from the higher-level/cantrip-upgrade sentence. Both
// "increases by 1d6 for each spell slot level above 3" and "increases by 1d10
// when you reach levels 5, 11, and 17" start with "increases by NdM".
function parseScalingPerStep(text: string): { count: number; sides: number } | null {
  const m = text.match(/increases by (\d+)d(\d+)/i);
  return m ? { count: parseInt(m[1], 10), sides: parseInt(m[2], 10) } : null;
}
```

- [ ] **Step 3: Wire them into the spell build** — in `parseSpellMarkdown`, where `modifiers` and `higherLevels` are built, replace the plain `modifiers: parseDamage(description)` with damage+healing and attach scaling:

```ts
const modifiers = [...parseDamage(description), ...parseHealing(description)];
const perStep = higherLevels.length ? parseScalingPerStep(higherLevels[0].description) : null;
if (perStep && modifiers.length) {
  modifiers[0] = { ...modifiers[0], scaling: { perStep } };
}
```

Then set `modifiers` on the pushed spell object (replace the existing `modifiers: parseDamage(description),` field with `modifiers,`).

- [ ] **Step 4: Add generator tests** — in `tests/srd/generate-srd-data.test.ts`, extend the SAMPLE with a healing spell and assert healing + scaling:

```ts
// add to SAMPLE (before the closing backtick):
`#### Cure Wounds

_Level 1 Abjuration (Bard, Cleric, Druid, Paladin, Ranger)_

**Casting Time:** Action
**Range:** Touch
**Components:** V, S
**Duration:** Instantaneous

A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier.

_Using a Higher-Level Spell Slot._ The healing increases by 2d8 for each spell slot level above 1.
`;
```

```ts
it('captures healing dice and slot scaling', () => {
  const cure = byName('Cure Wounds');
  const heal = cure.modifiers.find((m) => m.type === 'healing')!;
  expect(heal.dice).toEqual({ count: 2, sides: 8 });
  expect(heal.scaling).toEqual({ perStep: { count: 2, sides: 8 } });
});

it('attaches cantrip scaling to Fire Bolt damage', () => {
  const bolt = byName('Fire Bolt');
  expect(bolt.modifiers[0].scaling).toEqual({ perStep: { count: 1, sides: 10 } });
});

it('attaches slot scaling to Fireball damage', () => {
  const ball = byName('Fireball');
  expect(ball.modifiers[0].scaling).toEqual({ perStep: { count: 1, sides: 6 } });
});
```

> The existing SAMPLE's Fire Bolt has a "_Cantrip Upgrade._ The damage increases by 1d10 …" line and Fireball has "_Using a Higher-Level Spell Slot._ The damage increases by 1d6 …" — so those two assertions work against the current SAMPLE once scaling is wired.

- [ ] **Step 5: Run parser tests + regenerate**

Run: `npm test -- tests/srd/generate-srd-data.test.ts` (PASS), then `npm run srd:generate`.

- [ ] **Step 6: MANUAL QA GATE (required before commit)**

```bash
node -e '
const s = require("./app/server/data/srd/spells.json");
const p = n => s.find(x=>x.name===n);
for (const n of ["Fire Bolt","Fireball","Cure Wounds","Healing Word","Scorching Ray","Chromatic Orb"]) {
  const x = p(n); if (!x) { console.log(n,"MISSING"); continue; }
  console.log(n, JSON.stringify(x.modifiers));
}
console.log("healing modifiers:", s.filter(x=>x.modifiers.some(m=>m.type==="healing")).length);
console.log("scaled modifiers:", s.filter(x=>x.modifiers.some(m=>m.scaling)).length);
'
```

Verify: Fire Bolt/ Fireball scale correctly; Cure Wounds/Healing Word have a healing modifier with scaling; no obvious false-positive healing on damage spells. Fix parser edge cases and re-run `srd:generate` until the sample is right. Log the healing/scaled counts in the commit message.

- [ ] **Step 7: Commit**

```bash
git add scripts/srd/generate-srd-data.ts app/server/data/srd/index.ts tests/srd/generate-srd-data.test.ts app/server/data/srd/spells.json
git commit -m "feat(spells): capture healing dice and per-step scaling in the SRD generator"
```

---

## Task 3: `toParsedDiceRoll` title override

**Files:**

- Modify: `app/utils/dice.ts`
- Test: `tests/utils/dice.test.ts` (extend if present; else create)

**Interfaces:**

- Produces: `toParsedDiceRoll(result, opts?: { title?: string })`. Consumed by Task 4.

- [ ] **Step 1: Add the optional `opts`** — change the signature and the `title` line only; leave everything else identical:

```ts
export function toParsedDiceRoll(
  result: DiceRollResult,
  opts?: { title?: string }
): ParsedDiceRoll {
  return {
    character: '',
    title: opts?.title ?? result.formula,
    // …rest unchanged…
  };
}
```

- [ ] **Step 2: Test** — add to the dice tests (find the existing dice test file; if none, create `tests/utils/dice.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { rollDice, toParsedDiceRoll } from '~/utils/dice';

describe('toParsedDiceRoll title override', () => {
  it('uses the provided title, falling back to the formula', () => {
    const result = rollDice({ pool: [{ sides: 6, count: 8 }], mode: 'normal', modifier: 0 });
    expect(toParsedDiceRoll(result).title).toBe(result.formula);
    expect(toParsedDiceRoll(result, { title: 'Fireball · Fire' }).title).toBe('Fireball · Fire');
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `npm test -- tests/utils/dice.test.ts` (PASS), `npm run typecheck` (clean — existing `toParsedDiceRoll(result)` callers still compile since `opts` is optional).

```bash
git add app/utils/dice.ts tests/utils/dice.test.ts
git commit -m "feat(dice): optional title override on toParsedDiceRoll"
```

---

## Task 4: `spellDice.ts` — scaling math + roll trigger (pure logic)

**Files:**

- Create: `app/components/wiki/spells/spellDice.ts`
- Test: `tests/components/wiki/spells/spellDice.test.ts`

**Interfaces:**

- Consumes: `SpellData`/`SpellModifier`/`SpellDice` (types), `rollDice`/`toParsedDiceRoll` (`~/utils/dice`), `requestDiceBroadcast` (`~/utils/diceRollerBridge`), `DicePoolEntry`/`DieSides` (`~/utils/dice`).
- Produces: `stepsForCast`, `scaledDice`, `buildPool`, `rollSpellModifier`, `CANTRIP_BREAKPOINTS`. Consumed by Task 5.

- [ ] **Step 1: Write `app/components/wiki/spells/spellDice.ts`**

```ts
import type { SpellData, SpellModifier, SpellDice } from '~/types/spell';
import { rollDice, toParsedDiceRoll, type DicePoolEntry, type DieSides } from '~/utils/dice';
import { requestDiceBroadcast } from '~/utils/diceRollerBridge';

export const CANTRIP_BREAKPOINTS = [5, 11, 17] as const;

/** How many scaling "steps" apply when casting at `castLevel`. */
export function stepsForCast(spell: SpellData, castLevel: number): number {
  if (!spell.higherLevelScaling.enabled) return 0;
  if (spell.higherLevelScaling.type === 'character-level') {
    return CANTRIP_BREAKPOINTS.filter((b) => castLevel >= b).length;
  }
  // spell-scale (leveled): one step per slot level above the spell's base level
  return Math.max(0, castLevel - spell.level);
}

/** Base dice scaled to `castLevel` (base + steps × perStep). Null if no dice. */
export function scaledDice(
  modifier: SpellModifier,
  spell: SpellData,
  castLevel: number
): SpellDice | null {
  if (!modifier.dice) return null;
  if (!modifier.scaling) return modifier.dice;
  const steps = stepsForCast(spell, castLevel);
  return {
    count: modifier.dice.count + steps * modifier.scaling.perStep.count,
    sides: modifier.dice.sides,
  };
}

/** Build a dice pool; a crit doubles the dice count (5e). */
export function buildPool(dice: SpellDice, crit: boolean): DicePoolEntry[] {
  return [{ sides: dice.sides as DieSides, count: crit ? dice.count * 2 : dice.count }];
}

function modifierLabel(spell: SpellData, modifier: SpellModifier): string {
  const kind = modifier.damageType
    ? modifier.damageType.charAt(0).toUpperCase() + modifier.damageType.slice(1)
    : modifier.type === 'healing'
      ? 'Healing'
      : 'Damage';
  return `${spell.name} · ${kind}`;
}

/** Roll one modifier at the given cast level and broadcast it to the session. */
export function rollSpellModifier(args: {
  spell: SpellData;
  modifier: SpellModifier;
  castLevel: number;
  crit: boolean;
}): void {
  const dice = scaledDice(args.modifier, args.spell, args.castLevel);
  if (!dice) return;
  const result = rollDice({ pool: buildPool(dice, args.crit), mode: 'normal', modifier: 0 });
  const roll = toParsedDiceRoll(result, { title: modifierLabel(args.spell, args.modifier) });
  requestDiceBroadcast({ requestId: crypto.randomUUID(), roll });
}
```

- [ ] **Step 2: Write `tests/components/wiki/spells/spellDice.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestDiceBroadcast = vi.fn();
vi.mock('~/utils/diceRollerBridge', () => ({ requestDiceBroadcast }));

import {
  stepsForCast,
  scaledDice,
  buildPool,
  rollSpellModifier,
} from '~/components/wiki/spells/spellDice';
import type { SpellData, SpellModifier } from '~/types/spell';

function spell(overrides: Partial<SpellData> = {}): SpellData {
  return {
    id: 's',
    campaignId: 'c',
    createdBy: 'u',
    source: 'srd',
    name: 'Fireball',
    description: '',
    level: 3,
    school: 'evocation',
    castingTime: { value: 1, unit: 'action' },
    components: { verbal: true, somatic: true, material: false },
    range: { type: 'ranged', distance: 150 },
    duration: { type: 'instantaneous', concentration: false },
    ritual: false,
    higherLevelScaling: { enabled: true, type: 'spell-scale' },
    classes: [],
    attackSave: { kind: 'save', saveAbility: 'dex' },
    modifiers: [],
    conditions: [],
    higherLevels: [],
    areaOfEffect: { shape: 'sphere', size: 20 },
    tags: [],
    canEdit: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}
const fireballMod: SpellModifier = {
  id: 'm0',
  type: 'damage',
  dice: { count: 8, sides: 6 },
  damageType: 'fire',
  scaling: { perStep: { count: 1, sides: 6 } },
};
const cantrip = spell({
  name: 'Fire Bolt',
  level: 0,
  higherLevelScaling: { enabled: true, type: 'character-level' },
});
const boltMod: SpellModifier = {
  id: 'm0',
  type: 'damage',
  dice: { count: 1, sides: 10 },
  damageType: 'fire',
  scaling: { perStep: { count: 1, sides: 10 } },
};

beforeEach(() => vi.clearAllMocks());

describe('stepsForCast', () => {
  it('counts slot levels above base for leveled spells', () => {
    expect(stepsForCast(spell(), 3)).toBe(0);
    expect(stepsForCast(spell(), 5)).toBe(2);
    expect(stepsForCast(spell(), 9)).toBe(6);
  });
  it('counts cantrip breakpoints reached', () => {
    expect(stepsForCast(cantrip, 1)).toBe(0);
    expect(stepsForCast(cantrip, 5)).toBe(1);
    expect(stepsForCast(cantrip, 11)).toBe(2);
    expect(stepsForCast(cantrip, 17)).toBe(3);
  });
  it('returns 0 when scaling disabled', () => {
    expect(stepsForCast(spell({ higherLevelScaling: { enabled: false } }), 9)).toBe(0);
  });
});

describe('scaledDice + buildPool', () => {
  it('scales Fireball by slot', () => {
    expect(scaledDice(fireballMod, spell(), 5)).toEqual({ count: 10, sides: 6 });
  });
  it('scales Fire Bolt by character level', () => {
    expect(scaledDice(boltMod, cantrip, 11)).toEqual({ count: 3, sides: 10 });
  });
  it('doubles dice on a crit', () => {
    expect(buildPool({ count: 8, sides: 6 }, true)).toEqual([{ sides: 6, count: 16 }]);
    expect(buildPool({ count: 8, sides: 6 }, false)).toEqual([{ sides: 6, count: 8 }]);
  });
});

describe('rollSpellModifier', () => {
  it('broadcasts a roll titled with the spell + damage type', () => {
    rollSpellModifier({ spell: spell(), modifier: fireballMod, castLevel: 5, crit: false });
    expect(requestDiceBroadcast).toHaveBeenCalledTimes(1);
    const arg = requestDiceBroadcast.mock.calls[0][0];
    expect(arg.roll.title).toBe('Fireball · Fire');
    expect(typeof arg.requestId).toBe('string');
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `npm test -- tests/components/wiki/spells/spellDice.test.ts` (PASS), `npm run typecheck && npm run lint` (clean).

```bash
git add app/components/wiki/spells/spellDice.ts tests/components/wiki/spells/spellDice.test.ts
git commit -m "feat(spells): add spell dice scaling + roll-and-broadcast logic"
```

---

## Task 5: UI — "Cast & Roll" block in `SpellWindow`

**Files:**

- Modify: `app/components/wiki/spells/SpellWindow.tsx`
- Test: `tests/components/wiki/spells/SpellWindow.test.tsx` (new)

**Interfaces:**

- Consumes: `spellDice.ts` (Task 4), `formatSpellLevel` etc.
- Produces: rollable UI inside `SpellWindow` (renders in `SpellViewModal` and the read-only `SpellModal`).

- [ ] **Step 1: Add the Cast & Roll block** — in `SpellWindow.tsx`, add local state and a block rendered after the header grid, before the description. Only render for modifiers that have `dice`.

```tsx
// add imports
import { useState } from 'react';
import { scaledDice, rollSpellModifier } from './spellDice';
// …

// inside SpellWindow, after computing header cells:
const rollable = spell.modifiers.filter((m) => m.dice);
const scaling = spell.higherLevelScaling;
const [castLevel, setCastLevel] = useState(scaling.type === 'character-level' ? 1 : spell.level);
const [crit, setCrit] = useState(false);

const levelOptions =
  scaling.type === 'character-level'
    ? Array.from({ length: 20 }, (_, i) => i + 1)
    : Array.from({ length: 10 - spell.level }, (_, i) => spell.level + i);
```

```tsx
{
  rollable.length > 0 && (
    <div className="px-4 py-3 border-b border-white/[0.05] shrink-0 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {scaling.enabled && (
          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
            {scaling.type === 'character-level' ? 'Character level' : 'Slot level'}
            <select
              value={castLevel}
              onChange={(e) => setCastLevel(Number(e.target.value))}
              className="bg-[#080A12] border border-white/[0.07] rounded px-2 py-1 text-xs text-white"
            >
              {levelOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
          <input
            type="checkbox"
            checked={crit}
            onChange={(e) => setCrit(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          Crit
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {rollable.map((m) => {
          const dice = scaledDice(m, spell, castLevel);
          if (!dice) return null;
          const label = `${crit ? dice.count * 2 : dice.count}d${dice.sides}${
            m.damageType ? ` ${m.damageType}` : m.type === 'healing' ? ' healing' : ''
          }`;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => rollSpellModifier({ spell, modifier: m, castLevel, crit })}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-semibold hover:bg-blue-500/20 transition-colors"
              data-testid={`roll-${m.id}`}
            >
              <span aria-hidden>⚄</span> {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `tests/components/wiki/spells/SpellWindow.test.tsx`**

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const requestDiceBroadcast = vi.fn();
vi.mock('~/utils/diceRollerBridge', () => ({ requestDiceBroadcast }));

import { SpellWindow } from '~/components/wiki/spells/SpellWindow';
import type { SpellData } from '~/types/spell';

function fireball(): SpellData {
  return {
    id: 's',
    campaignId: 'c',
    createdBy: 'u',
    source: 'srd',
    name: 'Fireball',
    description: 'A bright streak.',
    level: 3,
    school: 'evocation',
    castingTime: { value: 1, unit: 'action' },
    components: { verbal: true, somatic: true, material: false },
    range: { type: 'ranged', distance: 150 },
    duration: { type: 'instantaneous', concentration: false },
    ritual: false,
    higherLevelScaling: { enabled: true, type: 'spell-scale' },
    classes: ['Wizard'],
    attackSave: { kind: 'save', saveAbility: 'dex' },
    modifiers: [
      {
        id: 'm0',
        type: 'damage',
        dice: { count: 8, sides: 6 },
        damageType: 'fire',
        scaling: { perStep: { count: 1, sides: 6 } },
      },
    ],
    conditions: [],
    higherLevels: [],
    areaOfEffect: { shape: 'sphere', size: 20 },
    tags: [],
    canEdit: false,
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('SpellWindow roll chips', () => {
  it('rolls base dice and broadcasts', async () => {
    const user = userEvent.setup();
    render(<SpellWindow spell={fireball()} />);
    expect(screen.getByTestId('roll-m0')).toHaveTextContent('8d6 fire');
    await user.click(screen.getByTestId('roll-m0'));
    expect(requestDiceBroadcast).toHaveBeenCalledTimes(1);
    expect(requestDiceBroadcast.mock.calls[0][0].roll.title).toBe('Fireball · Fire');
  });

  it('scales the chip when the slot level changes', async () => {
    const user = userEvent.setup();
    render(<SpellWindow spell={fireball()} />);
    await user.selectOptions(screen.getByRole('combobox'), '5');
    expect(screen.getByTestId('roll-m0')).toHaveTextContent('10d6 fire');
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `npm test -- tests/components/wiki/spells/SpellWindow.test.tsx` (PASS), `npm run typecheck && npm run lint` (clean).

```bash
git add app/components/wiki/spells/SpellWindow.tsx tests/components/wiki/spells/SpellWindow.test.tsx
git commit -m "feat(spells): roll chips + cast-level/crit controls on the spell card"
```

---

## Task 6: Regenerate data, reset dev, final gates

**Files:** none (operational).

- [ ] **Step 1: Ensure data is current** — `npm run srd:generate` (already committed in Task 2; re-run to confirm no diff).

- [ ] **Step 2: Reset dev so it has the new fields** — per the `resetting-dev-data` skill:

```bash
npm run dev:clear -- --force
npm run dev:seed
```

Then spot-check in the app: open "The Lost Mines of Phandelver" → Wiki → Spells → Fireball; confirm the `8d6 Fire` chip, the slot-level selector scales it (5 → `10d6`), the Crit toggle doubles it, and clicking broadcasts to the dice log.

- [ ] **Step 3: Full gates**

Run: `npm test` (green), `npm run typecheck` (clean), `npm run lint` (0 errors, no new warnings).

- [ ] **Step 4: Open PR to `dev`** (never `main`). This builds on Phase 1 — base the branch on Phase 1 once it merges, or stack on the spells branch.

## Self-Review (author checklist)

- [ ] **Spec coverage:** scaling model (Task 1), healing+scaling extraction (Task 2), title override (Task 3), scaling math + roll/broadcast (Task 4), roll chips + selector + crit (Task 5), regen+reset (Task 6). Out-of-scope items (attack/save rolls) intentionally absent.
- [ ] **Type consistency:** `scaling: { perStep: SpellDice }` identical across types/Zod/model/generator/spellDice; `stepsForCast`/`scaledDice`/`buildPool`/`rollSpellModifier` signatures match between Task 4 and Task 5.
- [ ] **No new deps**, tests under `tests/`, `crypto.randomUUID()` matches the dice roller's existing pattern.

## Out of scope (this plan)

- d20 spell attack rolls + save DC (character-sheet wiring).
- Special-case scaling that doesn't fit "increases by NdM" (e.g. Scorching Ray) — rolls base dice.
- Phase 3 (map overlays).
