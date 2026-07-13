# Spells Phase 2 — Roll Damage from a Spell (Design)

**Date:** 2026-07-13
**Status:** Approved design, ready for implementation plan
**Depends on:** Phase 1 (spells wiki + SRD 5.2.1 data), merged/in PR #519

## Summary

Let a player roll a spell's damage (or healing) directly from the spell view. A
roll chip on each damage/healing modifier builds a dice pool from the spell's
structured `modifiers`, rolls it with the existing dice engine, and broadcasts
the result to the active session's dice log. Casting at a higher slot level (or,
for cantrips, at a higher character level) scales the dice; a crit toggle doubles
them.

The enabling work is **structuring the currently free-text higher-level scaling
into per-step dice**, plus capturing healing dice (a known Phase 1 gap).

## Decisions (locked)

1. **Trigger:** a "Roll" chip per damage/healing modifier on the spell display
   card (uses the structured modifiers; no free-text parsing at runtime).
2. **Scope:** damage + healing dice, **with higher-level slot scaling** and a
   crit toggle. **Not** in scope: d20 spell attack rolls and save DC (need the
   caster's stats / character-sheet wiring that doesn't exist yet).
3. **Result:** broadcast to the active session's dice log (same path as the dice
   roller), labeled with the spell.
4. **Crit toggle default off.** Cantrips use a **1–20 character-level selector**
   (default 1).

## 1. Data model + generator

### Model (`app/types/spell.ts`, `app/types/schemas/spells.ts`, `Spell.ts`)

Add an optional `scaling` to `SpellModifier`:

```ts
export interface SpellModifier {
  id: string;
  type: ModifierType; // 'damage' | 'healing' | …
  dice?: SpellDice; // base dice
  scaling?: { perStep: SpellDice }; // NEW: dice added per scaling step
  fixedValue?: number;
  damageType?: string;
  atHigherLevels?: string;
  notes?: string;
}
```

Scaling is interpreted with the existing `spell.higherLevelScaling.type`:

- `spell-scale` (leveled): a "step" is one slot level above the spell's base
  level.
- `character-level` (cantrip): a "step" is a reached breakpoint at levels 5, 11,
  17 (→ 1, 2, 3 steps).

`SpellDice.sides` stays constrained to the die faces the engine supports
(`4|6|8|10|12`; damage never uses d20/d100). Assume `perStep.sides === dice.sides`
(true across the SRD); the roll logic falls back to a separate pool entry if they
ever differ.

### Generator (`scripts/srd/generate-srd-data.ts`)

Two additions to the parser, then regenerate `app/server/data/srd/spells.json`:

1. **Healing capture** (closes the Phase 1 gap): parse healing dice into a
   `type: 'healing'` modifier — e.g. `/(\d+)d(\d+)\s+(?:hit points|hp)/i` and the
   "regains … *X*d*Y*" phrasing. QA against a sample (Cure Wounds, Healing Word,
   Mass Cure Wounds, Prayer of Healing).
2. **Scaling `perStep`** from the "Using a Higher-Level Spell Slot" /
   "Cantrip Upgrade" text already captured in `higherLevels`:
   - slot: `/increases by (\d+)d(\d+) (?:for each|per) (?:spell )?slot level/i`
   - cantrip: `/increases by (\d+)d(\d+) when you reach/i`
     Attach `perStep` to the primary damage (or healing) modifier. QA against
     Fireball (+1d6/slot), Fire Bolt (cantrip +1d10 at 5/11/17), Cure Wounds
     (+2d8/slot), Scorching Ray (special — may not fit; leave unscaled if no match).

Unmatched spells simply have no `scaling` and roll their base dice. Regeneration
count stays ~339 spells; the importer and `dev_seed` read the same JSON, so after
regenerating, **re-run the dev reset** (`npm run dev:clear -- --force` then
`npm run dev:seed`, per the `resetting-dev-data` skill) so dev has the new fields.

## 2. Client dice logic (pure, unit-tested)

New `app/components/wiki/spells/spellDice.ts`:

- `stepsForCast(spell, castLevel): number`
  - `!spell.higherLevelScaling.enabled` → 0
  - `spell-scale` → `max(0, castLevel - spell.level)`
  - `character-level` → count of `[5, 11, 17]` that are `<= castLevel`
- `scaledDice(modifier, spell, castLevel): SpellDice | null`
  - no `dice` → null; no `scaling` → base `dice`
  - else `{ count: dice.count + steps * perStep.count, sides: dice.sides }`
- `buildPool(dice, crit): DicePoolEntry[]` → `[{ sides, count: crit ? count*2 : count }]`
- `rollSpellModifier({ spell, modifier, castLevel, crit })`:
  `rollDice({ pool, mode: 'normal', modifier: 0 })` → `toParsedDiceRoll(result, {
title })` → `requestDiceBroadcast({ requestId, roll })`, where
  `title = \`${spell.name} · ${modifier.damageType ?? (modifier.type === 'healing' ? 'Healing' : 'Damage')}\``and`requestId` uses the same id source the dice roller uses (`crypto.randomUUID()`).

## 3. Broadcast (`app/utils/dice.ts`)

Extend `toParsedDiceRoll` with an optional title override so spell rolls read as
the spell, not the raw formula:

```ts
export function toParsedDiceRoll(
  result: DiceRollResult,
  opts?: { title?: string }
): ParsedDiceRoll {
  return { /* …existing… */, title: opts?.title ?? result.formula };
}
```

Reuse `requestDiceBroadcast` unchanged; `InspectorSidebar` already relays it to
the session socket, so the roll appears in the shared dice log
(`Fireball · Fire: 27`). When there is no active session the behavior matches the
existing dice roller (no session relay) — no special-casing here.

## 4. UI (`SpellWindow.tsx`)

A "Cast & Roll" block below the header grid (renders in both the player
`SpellViewModal` and the read-only SRD `SpellModal`):

- One **roll chip per damage/healing modifier** that has `dice`, showing the
  currently-scaled dice + type — e.g. `⚄ 8d6 Fire`. Clicking rolls that modifier
  and broadcasts.
- When `higherLevelScaling.enabled`, a **cast-level selector** above the chips:
  - `spell-scale` → "Slot level" `[spell.level … 9]` (default = `spell.level`)
  - `character-level` → "Character level" `[1 … 20]` (default 1)
    Changing it re-computes the dice shown on the chips.
- A **Crit** toggle (default off) that doubles the damage dice shown/rolled.
- Spells with no rollable modifier (no `dice`) show no block.

Local component state: `castLevel`, `crit`. No server calls — rolling is
client-side + broadcast.

## 5. Out of scope

- d20 spell attack rolls and save DC (need caster spell-attack bonus / DC → a
  character-sheet ↔ spell link that doesn't exist yet).
- Non-dice / narrative effects.
- Scaling for spells whose increase doesn't fit the two regexes (e.g. Scorching
  Ray's extra rays) — they roll base dice; a follow-up can special-case them.

## 6. Testing

- **`spellDice.ts` unit tests:** `stepsForCast` (leveled slot math + cantrip
  5/11/17 breakpoints), `scaledDice` (Fireball at slots 3/5/9, Fire Bolt at
  levels 1/5/11/17), `buildPool` crit doubling.
- **Generator tests:** healing capture (Cure Wounds → healing modifier) and
  `perStep` extraction (Fireball slot, Fire Bolt cantrip) in
  `tests/srd/generate-srd-data.test.ts`.
- **`toParsedDiceRoll`:** title override applied.
- **Component test:** clicking a roll chip calls `requestDiceBroadcast` with a
  spell-titled `ParsedDiceRoll` (mock the bridge); changing the cast-level
  selector changes the rolled pool.
- Gates: `npm test`, `npm run typecheck`, `npm run lint` clean.

## Phase 3 (unchanged, still deferred)

Drawing `areaOfEffect` on the tabletop `spell-fx` layer — greenfield, separate
spec.
