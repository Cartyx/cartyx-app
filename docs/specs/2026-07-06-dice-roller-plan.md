# Virtual Dice Roller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive dice roller opened from the tabletop toolbar's dice icon: build a pool of d100/d20/d12/d10/d8/d6/d4, roll normal/advantage/disadvantage with a modifier, keep it private or broadcast to the session Dice feed.

**Architecture:** A pure rolling engine (`app/utils/dice.ts`) feeds a self-contained `DiceRollerPanel` rendered in an ephemeral per-user `ManagedWindow` inside `TabletopView`. Public rolls travel over a window-event bridge to `InspectorSidebar` (which owns the PartyKit socket) and out through the **existing** `DICE` wire type — no new parties, wire types, or server schema changes. Spec: `docs/specs/2026-07-06-dice-roller-design.md`.

**Tech Stack:** React 19 + TanStack Start, PartyKit (`party/index.ts` `main` party), Vitest (`tests/**`, happy-dom, globals on), Testing Library, Storybook, Playwright (`e2e/`).

## Global Constraints

- Branch: `virtual-dice`. **PR targets `dev`, not `main`.**
- Feature gated behind `VITE_PUBLIC_FF_DICE` (PostHog flag name `cartyx-dice-dev` in dev/e2e). The e2e PostHog mock (`e2e/fixtures/network-mocks.ts`) already enables `cartyx-dice-dev` — do not add it again.
- **Zero new npm dependencies.**
- No changes to `party/index.ts`, `partykit.json`, or `app/types/schemas/*` — the existing `DICE` message type and `saveDiceRollSchema` are reused as-is.
- Unit tests live under `tests/` mirroring `app/` (vitest `unit` project, happy-dom, globals: `describe/it/expect` need no import but the codebase imports them from `vitest` — follow that).
- Commands: `npm run test` (all unit), `npx vitest run --project unit <path>` (one file), `npm run typecheck`, `npm run lint`, `npx playwright test <path>`.
- Commit after every green task. Conventional commits (`feat:`, `test:`, `docs:`, `ci:`). End commit messages with the Claude co-author trailer used in this repo.

## Key existing interfaces (read-only context)

- `ParsedDiceRoll` (`app/hooks/useBeyond20.ts:38`): `{ character, title, rollType, attackRolls: Array<{roll, type: 'hit'|'crit'|'miss'|'crit-fail', total, formula, discarded, dice: number[]}>, damageRolls, totalDamages, rollInfo: Array<[string,string]>, description, channel: 'general'|'gm' }`.
- `useDiceRolls(sessionId, campaignId, isActiveSession)` (`app/hooks/useDiceRolls.ts:62`) returns `sendDiceRoll(roll: ParsedDiceRoll, socket)` which stamps id/seq/session/campaign/timestamp, sends `{...msg, type:'DICE'}`, and persists to Mongo when the party echoes it back.
- `ManagedWindow` (`app/components/mainview/FloatingWindowManager.tsx:10`): `{ id, title, content, contentKey?, iconKey?, titleIcon?, titleSuffix?, position?, size?, state: 'normal'|'minimized'|..., zIndex, className? }`.
- `saveDiceRollSchema` (`app/types/schemas/diceRolls.ts:9`): requires `character: min(1)`, `seq: positive int`, `rollType: min(1)`.
- `useOptionalFeatureFlag(flagName)` (`app/utils/featureFlags.tsx:47`) → `{ isEnabled, isLoading }`; empty flag name ⇒ disabled.
- `TabletopView` (`app/components/mainview/tabletop/TabletopView.tsx`) owns `localWindows: ManagedWindow[]`; **its server-sync effect (line ~273) rebuilds `localWindows` from `activeScreen.windows` and drops anything else** — the dice window therefore lives in its own state slot and is merged at render time, never stored in `localWindows`.

---

### Task 1: Pure dice engine

**Files:**

- Create: `app/utils/dice.ts`
- Test: `tests/utils/dice.test.ts`

**Interfaces:**

- Consumes: nothing (pure module).
- Produces (used by Tasks 2, 5):
  - `type DieSides = 4|6|8|10|12|20|100`
  - `const DIE_SIDES_DESC: readonly DieSides[]` — `[100, 20, 12, 10, 8, 6, 4]`
  - `type RollMode = 'normal'|'advantage'|'disadvantage'`
  - `interface DicePoolEntry { sides: DieSides; count: number }`
  - `interface RollSet { dice: {sides: DieSides; value: number}[]; subtotal: number; total: number; discarded: boolean }`
  - `interface DiceRollResult { pool; mode; modifier; sets: RollSet[]; keptIndex: number; total: number; formula: string }`
  - `const MODIFIER_MIN = -99`, `const MODIFIER_MAX = 99`
  - `rollDie(sides: DieSides, rng?: () => number): number`
  - `formatPool(pool: DicePoolEntry[], modifier: number): string`
  - `rollDice(input: { pool: DicePoolEntry[]; mode: RollMode; modifier: number; rng?: () => number }): DiceRollResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/utils/dice.test.ts
import { describe, it, expect } from 'vitest';
import {
  DIE_SIDES_DESC,
  formatPool,
  rollDice,
  rollDie,
  type DicePoolEntry,
  type DieSides,
} from '~/utils/dice';

/** Deterministic rng that returns queued values in order (each in [0,1)). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('rollDie', () => {
  it.each(DIE_SIDES_DESC.map((s) => [s] as [DieSides]))(
    'd%i stays within 1..sides over 500 crypto rolls',
    (sides) => {
      for (let i = 0; i < 500; i++) {
        const v = rollDie(sides);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(sides);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  );

  it('maps an injected rng deterministically (floor(r * sides) + 1)', () => {
    expect(rollDie(20, () => 0)).toBe(1);
    expect(rollDie(20, () => 0.999999)).toBe(20);
    expect(rollDie(6, () => 0.5)).toBe(4);
  });
});

describe('formatPool', () => {
  it('formats multi-die pools with a positive modifier', () => {
    const pool: DicePoolEntry[] = [
      { sides: 6, count: 3 },
      { sides: 8, count: 1 },
    ];
    expect(formatPool(pool, 3)).toBe('3d6 + 1d8 + 3');
  });

  it('formats a negative modifier with a minus sign', () => {
    expect(formatPool([{ sides: 20, count: 1 }], -2)).toBe('1d20 - 2');
  });

  it('omits a zero modifier', () => {
    expect(formatPool([{ sides: 4, count: 2 }], 0)).toBe('2d4');
  });
});

describe('rollDice', () => {
  const d20: DicePoolEntry[] = [{ sides: 20, count: 1 }];

  it('rolls one set in normal mode and sums dice + modifier', () => {
    // 3d6 with rng yielding values -> 4, 3, 6
    const rng = seqRng([0.5, 0.4, 0.99]);
    const result = rollDice({ pool: [{ sides: 6, count: 3 }], mode: 'normal', modifier: 3, rng });
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0]!.dice.map((d) => d.value)).toEqual([4, 3, 6]);
    expect(result.sets[0]!.subtotal).toBe(13);
    expect(result.total).toBe(16);
    expect(result.keptIndex).toBe(0);
    expect(result.formula).toBe('3d6 + 3');
    expect(result.sets[0]!.discarded).toBe(false);
  });

  it('advantage rolls the pool twice and keeps the higher total', () => {
    // set A -> 5, set B -> 15
    const rng = seqRng([0.2, 0.7]);
    const result = rollDice({ pool: d20, mode: 'advantage', modifier: 0, rng });
    expect(result.sets).toHaveLength(2);
    expect(result.keptIndex).toBe(1);
    expect(result.total).toBe(15);
    expect(result.sets[0]!.discarded).toBe(true);
    expect(result.sets[1]!.discarded).toBe(false);
  });

  it('disadvantage keeps the lower total', () => {
    const rng = seqRng([0.2, 0.7]);
    const result = rollDice({ pool: d20, mode: 'disadvantage', modifier: 0, rng });
    expect(result.keptIndex).toBe(0);
    expect(result.total).toBe(5);
    expect(result.sets[1]!.discarded).toBe(true);
  });

  it('applies the modifier to every set total', () => {
    const rng = seqRng([0.2, 0.7]);
    const result = rollDice({ pool: d20, mode: 'advantage', modifier: -2, rng });
    expect(result.sets[0]!.total).toBe(3);
    expect(result.sets[1]!.total).toBe(13);
    expect(result.total).toBe(13);
  });

  it('allows totals below 1 with negative modifiers', () => {
    const result = rollDice({ pool: d20, mode: 'normal', modifier: -25, rng: () => 0 });
    expect(result.total).toBe(-24);
  });

  it('throws on an empty pool', () => {
    expect(() => rollDice({ pool: [], mode: 'normal', modifier: 0 })).toThrow(/empty/i);
  });

  it('throws on invalid counts and non-integer modifiers', () => {
    expect(() => rollDice({ pool: [{ sides: 6, count: 0 }], mode: 'normal', modifier: 0 })).toThrow(
      /count/i
    );
    expect(() => rollDice({ pool: d20, mode: 'normal', modifier: 1.5 })).toThrow(/integer/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/utils/dice.test.ts`
Expected: FAIL — `Cannot find module '~/utils/dice'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

```ts
// app/utils/dice.ts
export type DieSides = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export const DIE_SIDES_DESC: readonly DieSides[] = [100, 20, 12, 10, 8, 6, 4];

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface DicePoolEntry {
  sides: DieSides;
  count: number;
}

export interface RolledDie {
  sides: DieSides;
  value: number;
}

export interface RollSet {
  dice: RolledDie[];
  subtotal: number;
  /** subtotal + modifier */
  total: number;
  discarded: boolean;
}

export interface DiceRollResult {
  pool: DicePoolEntry[];
  mode: RollMode;
  modifier: number;
  sets: RollSet[];
  keptIndex: number;
  total: number;
  formula: string;
}

export const MODIFIER_MIN = -99;
export const MODIFIER_MAX = 99;

/**
 * Uniform integer in [1, sides]. Without an injected rng, uses
 * crypto.getRandomValues with rejection sampling so no face is favored
 * (2^32 is not divisible by most die sizes).
 */
export function rollDie(sides: DieSides, rng?: () => number): number {
  if (rng) return Math.floor(rng() * sides) + 1;
  const range = 0x1_0000_0000; // 2^32
  const limit = range - (range % sides);
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);
  return (x % sides) + 1;
}

export function formatPool(pool: DicePoolEntry[], modifier: number): string {
  const dice = pool.map((p) => `${p.count}d${p.sides}`).join(' + ');
  if (modifier > 0) return `${dice} + ${modifier}`;
  if (modifier < 0) return `${dice} - ${Math.abs(modifier)}`;
  return dice;
}

function rollSet(pool: DicePoolEntry[], modifier: number, rng?: () => number): RollSet {
  const dice: RolledDie[] = [];
  for (const { sides, count } of pool) {
    for (let i = 0; i < count; i++) dice.push({ sides, value: rollDie(sides, rng) });
  }
  const subtotal = dice.reduce((sum, d) => sum + d.value, 0);
  return { dice, subtotal, total: subtotal + modifier, discarded: false };
}

export function rollDice(input: {
  pool: DicePoolEntry[];
  mode: RollMode;
  modifier: number;
  rng?: () => number;
}): DiceRollResult {
  const { pool, mode, modifier, rng } = input;
  if (pool.length === 0) throw new Error('Cannot roll an empty dice pool');
  for (const entry of pool) {
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      throw new Error(`Invalid die count: ${entry.count}`);
    }
    if (!DIE_SIDES_DESC.includes(entry.sides)) {
      throw new Error(`Invalid die: d${entry.sides}`);
    }
  }
  if (!Number.isInteger(modifier)) throw new Error(`Modifier must be an integer: ${modifier}`);

  const sets =
    mode === 'normal'
      ? [rollSet(pool, modifier, rng)]
      : [rollSet(pool, modifier, rng), rollSet(pool, modifier, rng)];

  let keptIndex = 0;
  if (sets.length === 2) {
    const [a, b] = sets as [RollSet, RollSet];
    keptIndex = mode === 'advantage' ? (b.total > a.total ? 1 : 0) : b.total < a.total ? 1 : 0;
    sets[1 - keptIndex]!.discarded = true;
  }

  return {
    pool,
    mode,
    modifier,
    sets,
    keptIndex,
    total: sets[keptIndex]!.total,
    formula: formatPool(pool, modifier),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/utils/dice.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/dice.ts tests/utils/dice.test.ts
git commit -m "feat(dice): add pure dice rolling engine with adv/dis and modifiers"
```

---

### Task 2: Map roll results to the Beyond20-compatible wire shape

**Files:**

- Modify: `app/utils/dice.ts` (append one function)
- Test: `tests/utils/dice.test.ts` (append a describe block)

**Interfaces:**

- Consumes: `DiceRollResult` (Task 1); `ParsedDiceRoll` type from `~/hooks/useBeyond20` (type-only import).
- Produces (used by Tasks 5, 8): `toParsedDiceRoll(result: DiceRollResult): ParsedDiceRoll` — `character` left `''` (the broadcast consumer fills it), `rollType: 'custom'`, `channel: 'general'`, one `attackRolls` entry per roll set carrying every individual die value.

- [ ] **Step 1: Write the failing test** (append to `tests/utils/dice.test.ts`)

```ts
import { toParsedDiceRoll } from '~/utils/dice';
import { saveDiceRollSchema } from '~/types/schemas/diceRolls';

describe('toParsedDiceRoll', () => {
  it('maps a normal roll to one non-discarded attackRoll with all die values', () => {
    const rng = seqRng([0.5, 0.4, 0.99]); // 3d6 -> 4, 3, 6
    const result = rollDice({ pool: [{ sides: 6, count: 3 }], mode: 'normal', modifier: 3, rng });
    const parsed = toParsedDiceRoll(result);
    expect(parsed.rollType).toBe('custom');
    expect(parsed.channel).toBe('general');
    expect(parsed.title).toBe('3d6 + 3');
    expect(parsed.attackRolls).toHaveLength(1);
    expect(parsed.attackRolls[0]).toEqual({
      roll: 16,
      type: 'hit',
      total: 16,
      formula: '3d6 + 3',
      discarded: false,
      dice: [4, 3, 6],
    });
    expect(parsed.damageRolls).toEqual([]);
    expect(parsed.rollInfo).toEqual([]);
  });

  it('maps advantage to two attackRolls with the loser discarded and a Mode chip', () => {
    const rng = seqRng([0.2, 0.7]); // d20 -> 5, then 15
    const result = rollDice({
      pool: [{ sides: 20, count: 1 }],
      mode: 'advantage',
      modifier: 0,
      rng,
    });
    const parsed = toParsedDiceRoll(result);
    expect(parsed.attackRolls).toHaveLength(2);
    expect(parsed.attackRolls[0]!.discarded).toBe(true);
    expect(parsed.attackRolls[1]!.discarded).toBe(false);
    expect(parsed.rollInfo).toEqual([['Mode', 'Advantage']]);
  });

  it('produces a payload the Mongo save schema accepts once identity fields are added', () => {
    const result = rollDice({
      pool: [{ sides: 8, count: 2 }],
      mode: 'disadvantage',
      modifier: -1,
      rng: seqRng([0.1, 0.9]),
    });
    const parsed = toParsedDiceRoll(result);
    const candidate = {
      ...parsed,
      character: 'Tester',
      id: 'roll-1',
      seq: 1,
      sessionId: 's1',
      campaignId: 'c1',
      timestamp: 1720000000000,
    };
    // channel is part of both shapes; schema must parse cleanly
    expect(() => saveDiceRollSchema.parse(candidate)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/utils/dice.test.ts`
Expected: FAIL — `toParsedDiceRoll` is not exported.

- [ ] **Step 3: Write the implementation** (append to `app/utils/dice.ts`)

```ts
import type { ParsedDiceRoll } from '~/hooks/useBeyond20';

/**
 * Map an interactive roll onto the existing Beyond20-compatible DICE wire
 * shape so it renders in the Dice feed via DiceRollCard with zero server
 * changes. `character` is intentionally blank — the broadcast consumer
 * (InspectorSidebar) fills in the authenticated user's name.
 */
export function toParsedDiceRoll(result: DiceRollResult): ParsedDiceRoll {
  return {
    character: '',
    title: result.formula,
    rollType: 'custom',
    attackRolls: result.sets.map((set) => ({
      roll: set.total,
      type: 'hit' as const,
      total: set.total,
      formula: result.formula,
      discarded: set.discarded,
      dice: set.dice.map((d) => d.value),
    })),
    damageRolls: [],
    totalDamages: {},
    rollInfo:
      result.mode === 'normal'
        ? []
        : [['Mode', result.mode === 'advantage' ? 'Advantage' : 'Disadvantage']],
    description: '',
    channel: 'general',
  };
}
```

Move the `import type { ParsedDiceRoll }` line to the top of the file with the other imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/utils/dice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/dice.ts tests/utils/dice.test.ts
git commit -m "feat(dice): map roll results to the Beyond20-compatible DICE wire shape"
```

---

### Task 3: Window-event broadcast bridge

`DiceRollerPanel` (rendered inside `TabletopView`) and the PartyKit socket (owned by `InspectorSidebar`, a sibling subtree) can't share props. The repo precedent for this is `useBeyond20` — rolls arrive as window events and `InspectorSidebar` relays them to the socket. The bridge mirrors that.

**Files:**

- Create: `app/utils/diceRollerBridge.ts`
- Test: `tests/utils/diceRollerBridge.test.ts`

**Interfaces:**

- Consumes: `ParsedDiceRoll` type.
- Produces (used by Tasks 5, 8):
  - `interface DiceBroadcastRequest { requestId: string; roll: ParsedDiceRoll }`
  - `interface DiceDeliveryReport { requestId: string; delivered: boolean }`
  - `requestDiceBroadcast(detail: DiceBroadcastRequest): void`
  - `onDiceBroadcastRequest(cb: (d: DiceBroadcastRequest) => void): () => void` (returns unsubscribe)
  - `reportDiceDelivery(detail: DiceDeliveryReport): void`
  - `onDiceDelivery(cb: (d: DiceDeliveryReport) => void): () => void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/utils/diceRollerBridge.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  onDiceBroadcastRequest,
  onDiceDelivery,
  reportDiceDelivery,
  requestDiceBroadcast,
  type DiceBroadcastRequest,
} from '~/utils/diceRollerBridge';

const roll: DiceBroadcastRequest['roll'] = {
  character: '',
  title: '1d20',
  rollType: 'custom',
  attackRolls: [
    { roll: 11, type: 'hit', total: 11, formula: '1d20', discarded: false, dice: [11] },
  ],
  damageRolls: [],
  totalDamages: {},
  rollInfo: [],
  description: '',
  channel: 'general',
};

describe('diceRollerBridge', () => {
  it('delivers broadcast requests to subscribers', () => {
    const cb = vi.fn();
    const unsubscribe = onDiceBroadcastRequest(cb);
    requestDiceBroadcast({ requestId: 'r1', roll });
    expect(cb).toHaveBeenCalledExactlyOnceWith({ requestId: 'r1', roll });
    unsubscribe();
  });

  it('stops delivering after unsubscribe', () => {
    const cb = vi.fn();
    const unsubscribe = onDiceBroadcastRequest(cb);
    unsubscribe();
    requestDiceBroadcast({ requestId: 'r2', roll });
    expect(cb).not.toHaveBeenCalled();
  });

  it('delivers delivery reports to subscribers', () => {
    const cb = vi.fn();
    const unsubscribe = onDiceDelivery(cb);
    reportDiceDelivery({ requestId: 'r3', delivered: false });
    expect(cb).toHaveBeenCalledExactlyOnceWith({ requestId: 'r3', delivered: false });
    unsubscribe();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/utils/diceRollerBridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// app/utils/diceRollerBridge.ts
import type { ParsedDiceRoll } from '~/hooks/useBeyond20';

export interface DiceBroadcastRequest {
  requestId: string;
  roll: ParsedDiceRoll;
}

export interface DiceDeliveryReport {
  requestId: string;
  delivered: boolean;
}

// Window events bridge the dice roller window (TabletopView subtree) to the
// PartyKit socket owner (InspectorSidebar subtree) — same pattern useBeyond20
// uses to relay extension rolls.
const BROADCAST_EVENT = 'cartyx:dice-broadcast-request';
const DELIVERY_EVENT = 'cartyx:dice-delivery-report';

export function requestDiceBroadcast(detail: DiceBroadcastRequest): void {
  window.dispatchEvent(new CustomEvent(BROADCAST_EVENT, { detail }));
}

export function onDiceBroadcastRequest(cb: (d: DiceBroadcastRequest) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<DiceBroadcastRequest>).detail);
  window.addEventListener(BROADCAST_EVENT, handler);
  return () => window.removeEventListener(BROADCAST_EVENT, handler);
}

export function reportDiceDelivery(detail: DiceDeliveryReport): void {
  window.dispatchEvent(new CustomEvent(DELIVERY_EVENT, { detail }));
}

export function onDiceDelivery(cb: (d: DiceDeliveryReport) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<DiceDeliveryReport>).detail);
  window.addEventListener(DELIVERY_EVENT, handler);
  return () => window.removeEventListener(DELIVERY_EVENT, handler);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/utils/diceRollerBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/diceRollerBridge.ts tests/utils/diceRollerBridge.test.ts
git commit -m "feat(dice): add window-event bridge between roller window and socket owner"
```

---

### Task 4: `DiceRollCard` export + `custom` render variant

Custom rolls must show **every** die value (trust requirement) and shouldn't say "To Hit". Beyond20 cards must render byte-identically to today, so the changes are opt-in via a `variant` derived from `rollType`.

**Files:**

- Modify: `app/components/mainview/DicePanel.tsx` (export `DiceRollCard`; add `variant` to `RollBreakdown`)
- Test: Create `tests/components/mainview/DicePanel.test.tsx`

**Interfaces:**

- Consumes: `DiceRollMessage` from `~/hooks/useDiceRolls`.
- Produces (used by Task 5): `export function DiceRollCard({ roll }: { roll: DiceRollMessage })`. Behavior: when `roll.rollType === 'custom'`, the attack-roll label reads **Result** (not "To Hit") and the per-roll breakdown line lists **all** dice (`(4 + 3 + 6) + 3 = 16`); otherwise rendering is unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/mainview/DicePanel.test.tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiceRollCard } from '~/components/mainview/DicePanel';
import type { DiceRollMessage } from '~/hooks/useDiceRolls';

function makeRoll(overrides: Partial<DiceRollMessage>): DiceRollMessage {
  return {
    id: 'm1',
    seq: 1,
    sessionId: 's1',
    campaignId: 'c1',
    channel: 'general',
    character: 'Tester',
    title: '3d6 + 3',
    rollType: 'custom',
    attackRolls: [],
    damageRolls: [],
    totalDamages: {},
    rollInfo: [],
    description: '',
    timestamp: 1720000000000,
    ...overrides,
  };
}

describe('DiceRollCard', () => {
  it('labels custom rolls "Result" and lists every die value', () => {
    render(
      <DiceRollCard
        roll={makeRoll({
          attackRolls: [
            {
              roll: 16,
              type: 'hit',
              total: 16,
              formula: '3d6 + 3',
              discarded: false,
              dice: [4, 3, 6],
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.queryByText(/To Hit/)).not.toBeInTheDocument();
    expect(screen.getByText(/\(4 \+ 3 \+ 6\)/)).toBeInTheDocument();
  });

  it('keeps Beyond20 rolls unchanged: "To Hit" label and first-die-only breakdown', () => {
    render(
      <DiceRollCard
        roll={makeRoll({
          rollType: 'to-hit',
          attackRolls: [
            {
              roll: 20,
              type: 'hit',
              total: 20,
              formula: '1d20 + 3',
              discarded: false,
              dice: [17],
            },
          ],
        })}
      />
    );
    expect(screen.getByText(/To Hit/)).toBeInTheDocument();
    expect(screen.getByText(/\(17\)/)).toBeInTheDocument();
  });

  it('shows the ADV badge and strikes through the discarded custom set', () => {
    render(
      <DiceRollCard
        roll={makeRoll({
          rollInfo: [['Mode', 'Advantage']],
          attackRolls: [
            { roll: 5, type: 'hit', total: 5, formula: '1d20', discarded: true, dice: [5] },
            { roll: 15, type: 'hit', total: 15, formula: '1d20', discarded: false, dice: [15] },
          ],
        })}
      />
    );
    expect(screen.getByText('ADV')).toBeInTheDocument();
    expect(screen.getByText('Mode: Advantage')).toBeInTheDocument();
    expect(screen.getByText('5')).toHaveClass('line-through');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/mainview/DicePanel.test.tsx`
Expected: FAIL — `DiceRollCard` is not exported from DicePanel.

- [ ] **Step 3: Modify `app/components/mainview/DicePanel.tsx`**

Three edits:

1. `RollBreakdown` signature gains a variant (default preserves current behavior):

```tsx
function RollBreakdown({
  attackRolls,
  damageRolls,
  rollInfo,
  variant = 'beyond20',
}: {
  attackRolls: DiceRollMessage['attackRolls'];
  damageRolls: DiceRollMessage['damageRolls'];
  rollInfo: DiceRollMessage['rollInfo'];
  variant?: 'beyond20' | 'custom';
}) {
```

2. Inside the `attackRolls.map` body, replace the hardcoded label and first-die-only line:

```tsx
<span className="font-sans text-[11px] text-slate-500">
  {variant === 'custom' ? 'Result' : 'To Hit'}
  {isDiscarded ? ' (dropped)' : ''}
</span>
```

and

```tsx
{
  dice.length > 0 && !isDiscarded && (
    <div className="pl-2 font-mono text-[10px] text-slate-500">
      ({variant === 'custom' ? dice.join(' + ') : dice[0]})
      {bonus !== 0 && ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}`} = {roll.total}
    </div>
  );
}
```

3. Export the card and derive the variant (change `function DiceRollCard` to `export function DiceRollCard`, and pass the variant):

```tsx
<RollBreakdown
  attackRolls={roll.attackRolls}
  damageRolls={roll.damageRolls}
  rollInfo={roll.rollInfo}
  variant={roll.rollType === 'custom' ? 'custom' : 'beyond20'}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/components/mainview/DicePanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/DicePanel.tsx tests/components/mainview/DicePanel.test.tsx
git commit -m "feat(dice): add custom-roll render variant to DiceRollCard and export it"
```

---

### Task 5: `DiceRollerPanel` component

**Files:**

- Create: `app/components/mainview/DiceRollerPanel.tsx`
- Create: `app/components/mainview/DiceRollerPanel.stories.tsx`
- Test: `tests/components/mainview/DiceRollerPanel.test.tsx`

**Interfaces:**

- Consumes: Task 1/2 engine, Task 3 bridge, Task 4 `DiceRollCard`.
- Produces (used by Task 7): `export function DiceRollerPanel()` — no props; fully self-contained.
- Test ids produced (used by unit tests here and e2e in Task 9): `dice-roller-panel`, `dice-roller-die-<sides>`, `dice-roller-count-<sides>`, `dice-roller-reset`, `dice-roller-modifier-dec`, `dice-roller-modifier-value`, `dice-roller-modifier-inc`, `dice-roller-mode-<normal|advantage|disadvantage>`, `dice-roller-privacy-<public|private>`, `dice-roller-roll`, `dice-roller-result`, `dice-roller-notice`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/mainview/DiceRollerPanel.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiceRollerPanel } from '~/components/mainview/DiceRollerPanel';
import { onDiceBroadcastRequest, reportDiceDelivery } from '~/utils/diceRollerBridge';

describe('DiceRollerPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all seven dice and disables Roll while the pool is empty', () => {
    render(<DiceRollerPanel />);
    for (const sides of [100, 20, 12, 10, 8, 6, 4]) {
      expect(screen.getByTestId(`dice-roller-die-${sides}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('dice-roller-roll')).toBeDisabled();
  });

  it('queues dice with count badges and clears them with Reset', async () => {
    const user = userEvent.setup();
    render(<DiceRollerPanel />);
    await user.click(screen.getByTestId('dice-roller-die-6'));
    await user.click(screen.getByTestId('dice-roller-die-6'));
    await user.click(screen.getByTestId('dice-roller-die-8'));
    expect(screen.getByTestId('dice-roller-count-6')).toHaveTextContent('2');
    expect(screen.getByTestId('dice-roller-count-8')).toHaveTextContent('1');
    expect(screen.getByTestId('dice-roller-roll')).toBeEnabled();

    // Badge click removes one die of that type
    await user.click(screen.getByTestId('dice-roller-count-6'));
    expect(screen.getByTestId('dice-roller-count-6')).toHaveTextContent('1');

    await user.click(screen.getByTestId('dice-roller-reset'));
    expect(screen.queryByTestId('dice-roller-count-6')).not.toBeInTheDocument();
    expect(screen.getByTestId('dice-roller-roll')).toBeDisabled();
  });

  it('steps and clamps the modifier', async () => {
    const user = userEvent.setup();
    render(<DiceRollerPanel />);
    await user.click(screen.getByTestId('dice-roller-modifier-inc'));
    await user.click(screen.getByTestId('dice-roller-modifier-inc'));
    expect(screen.getByTestId('dice-roller-modifier-value')).toHaveTextContent('+2');
    for (let i = 0; i < 5; i++) await user.click(screen.getByTestId('dice-roller-modifier-dec'));
    expect(screen.getByTestId('dice-roller-modifier-value')).toHaveTextContent('-3');
  });

  it('shows the result with every die value after a private roll and does not broadcast', async () => {
    const user = userEvent.setup();
    const broadcasts = vi.fn();
    const unsubscribe = onDiceBroadcastRequest(broadcasts);
    // 3d6 -> deterministic values 3, 3, 3: the no-rng path is rejection
    // sampling + modulo, so 2^31 % 6 = 2 -> die value 3.
    const cryptoSpy = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
        if (buf instanceof Uint32Array) buf[0] = 2147483648;
        return buf;
      });

    render(<DiceRollerPanel />);
    await user.click(screen.getByTestId('dice-roller-privacy-private'));
    for (let i = 0; i < 3; i++) await user.click(screen.getByTestId('dice-roller-die-6'));
    await user.click(screen.getByTestId('dice-roller-roll'));

    const result = screen.getByTestId('dice-roller-result');
    expect(result).toHaveTextContent('3d6');
    expect(result).toHaveTextContent('(3 + 3 + 3)');
    expect(broadcasts).not.toHaveBeenCalled();

    cryptoSpy.mockRestore();
    unsubscribe();
  });

  it('broadcasts public rolls and shows a notice when delivery fails', async () => {
    const user = userEvent.setup();
    let captured: { requestId: string } | null = null;
    const unsubscribe = onDiceBroadcastRequest((d) => {
      captured = d;
    });

    render(<DiceRollerPanel />);
    // Public is the default — no privacy click needed
    await user.click(screen.getByTestId('dice-roller-die-20'));
    await user.click(screen.getByTestId('dice-roller-roll'));

    expect(captured).not.toBeNull();
    expect(screen.queryByTestId('dice-roller-notice')).not.toBeInTheDocument();

    reportDiceDelivery({ requestId: captured!.requestId, delivered: false });
    expect(await screen.findByTestId('dice-roller-notice')).toHaveTextContent(/not connected/i);
    unsubscribe();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/mainview/DiceRollerPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// app/components/mainview/DiceRollerPanel.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import {
  DIE_SIDES_DESC,
  MODIFIER_MAX,
  MODIFIER_MIN,
  rollDice,
  toParsedDiceRoll,
  type DieSides,
  type RollMode,
} from '~/utils/dice';
import { onDiceDelivery, requestDiceBroadcast } from '~/utils/diceRollerBridge';
import { DiceRollCard } from './DicePanel';
import type { DiceRollMessage } from '~/hooks/useDiceRolls';

const MODES: { id: RollMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'advantage', label: 'Adv' },
  { id: 'disadvantage', label: 'Dis' },
];

export function DiceRollerPanel() {
  const [counts, setCounts] = useState<Partial<Record<DieSides, number>>>({});
  const [modifier, setModifier] = useState(0);
  const [mode, setMode] = useState<RollMode>('normal');
  const [isPublic, setIsPublic] = useState(true);
  const [lastRoll, setLastRoll] = useState<DiceRollMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingRequestId = useRef<string | null>(null);

  useEffect(
    () =>
      onDiceDelivery(({ requestId, delivered }) => {
        if (requestId !== pendingRequestId.current) return;
        pendingRequestId.current = null;
        if (!delivered) {
          setNotice("Couldn't broadcast — not connected. The roll stayed on your screen.");
        }
      }),
    []
  );

  const pool = DIE_SIDES_DESC.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({
    sides: s,
    count: counts[s]!,
  }));

  const addDie = (sides: DieSides) =>
    setCounts((c) => ({ ...c, [sides]: Math.min((c[sides] ?? 0) + 1, 99) }));
  const removeDie = (sides: DieSides) =>
    setCounts((c) => ({ ...c, [sides]: Math.max((c[sides] ?? 0) - 1, 0) }));

  function handleRoll() {
    if (pool.length === 0) return;
    setNotice(null);
    const result = rollDice({ pool, mode, modifier });
    const parsed = toParsedDiceRoll(result);
    setLastRoll({
      ...parsed,
      id: crypto.randomUUID(),
      seq: 0,
      sessionId: '',
      campaignId: '',
      character: 'You',
      timestamp: Date.now(),
    });
    if (isPublic) {
      const requestId = crypto.randomUUID();
      pendingRequestId.current = requestId;
      requestDiceBroadcast({ requestId, roll: parsed });
    }
  }

  return (
    <div
      data-testid="dice-roller-panel"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-[#0D1117] p-3"
    >
      {/* Dice grid */}
      <div className="grid grid-cols-4 gap-2">
        {DIE_SIDES_DESC.map((sides) => {
          const count = counts[sides] ?? 0;
          return (
            <div key={sides} className="relative">
              <button
                type="button"
                data-testid={`dice-roller-die-${sides}`}
                aria-label={`Add d${sides}`}
                onClick={() => addDie(sides)}
                className={[
                  'flex h-12 w-full items-center justify-center rounded border font-mono text-sm transition-colors',
                  count > 0
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                    : 'border-white/[0.07] bg-[#080A12] text-slate-300 hover:bg-white/5',
                ].join(' ')}
              >
                d{sides}
              </button>
              {count > 0 && (
                <button
                  type="button"
                  data-testid={`dice-roller-count-${sides}`}
                  aria-label={`Remove one d${sides} (${count} queued)`}
                  onClick={() => removeDie(sides)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 font-mono text-[10px] font-bold text-white hover:bg-red-600"
                >
                  {count}
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          data-testid="dice-roller-reset"
          aria-label="Reset dice pool"
          onClick={() => setCounts({})}
          className="flex h-12 w-full items-center justify-center gap-1 rounded border border-white/[0.07] bg-[#080A12] font-sans text-[11px] text-slate-400 hover:bg-white/5"
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </div>

      {/* Modifier stepper */}
      <div className="flex items-center justify-between rounded border border-white/[0.07] bg-[#080A12] px-3 py-2">
        <span className="font-sans text-[11px] text-slate-500">Modifier</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="dice-roller-modifier-dec"
            aria-label="Decrease modifier"
            onClick={() => setModifier((m) => Math.max(m - 1, MODIFIER_MIN))}
            className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-slate-300 hover:bg-white/10"
          >
            <Minus size={12} />
          </button>
          <span
            data-testid="dice-roller-modifier-value"
            className="w-10 text-center font-mono text-sm text-white"
          >
            {modifier > 0 ? `+${modifier}` : modifier}
          </span>
          <button
            type="button"
            data-testid="dice-roller-modifier-inc"
            aria-label="Increase modifier"
            onClick={() => setModifier((m) => Math.min(m + 1, MODIFIER_MAX))}
            className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-slate-300 hover:bg-white/10"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Roll mode */}
      <div
        role="group"
        aria-label="Roll mode"
        className="flex rounded border border-white/[0.07] bg-[#080A12] p-0.5"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            data-testid={`dice-roller-mode-${m.id}`}
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
            className={[
              'flex-1 rounded px-2 py-1.5 font-sans text-[11px] transition-colors',
              mode === m.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
            ].join(' ')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Privacy */}
      <div
        role="group"
        aria-label="Roll visibility"
        className="flex rounded border border-white/[0.07] bg-[#080A12] p-0.5"
      >
        <button
          type="button"
          data-testid="dice-roller-privacy-public"
          aria-pressed={isPublic}
          onClick={() => setIsPublic(true)}
          className={[
            'flex-1 rounded px-2 py-1.5 font-sans text-[11px] transition-colors',
            isPublic ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
          ].join(' ')}
        >
          Public
        </button>
        <button
          type="button"
          data-testid="dice-roller-privacy-private"
          aria-pressed={!isPublic}
          onClick={() => setIsPublic(false)}
          className={[
            'flex-1 rounded px-2 py-1.5 font-sans text-[11px] transition-colors',
            !isPublic ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
          ].join(' ')}
        >
          Private
        </button>
      </div>

      {/* Roll */}
      <button
        type="button"
        data-testid="dice-roller-roll"
        disabled={pool.length === 0}
        onClick={handleRoll}
        className="rounded bg-[#2563EB] px-3 py-2 font-sans text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
      >
        Roll{pool.length > 0 ? ` ${pool.map((p) => `${p.count}d${p.sides}`).join(' + ')}` : ''}
      </button>

      {/* Delivery notice */}
      {notice && (
        <div
          data-testid="dice-roller-notice"
          className="rounded border border-amber-800/30 bg-amber-900/20 px-3 py-2 font-sans text-[11px] text-amber-300"
        >
          {notice}
        </div>
      )}

      {/* Last result */}
      {lastRoll && (
        <div data-testid="dice-roller-result">
          <DiceRollCard roll={lastRoll} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/components/mainview/DiceRollerPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the Storybook story**

```tsx
// app/components/mainview/DiceRollerPanel.stories.tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DiceRollerPanel } from './DiceRollerPanel';

const meta: Meta<typeof DiceRollerPanel> = {
  title: 'Components/DiceRollerPanel',
  component: DiceRollerPanel,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="h-[520px] w-[340px] border border-white/[0.07]">
      <DiceRollerPanel />
    </div>
  ),
};
```

Run: `npm run test:storybook`
Expected: PASS (story renders; requires Playwright browsers installed — if the storybook project fails for pre-existing environmental reasons, note it and continue).

- [ ] **Step 6: Commit**

```bash
git add app/components/mainview/DiceRollerPanel.tsx app/components/mainview/DiceRollerPanel.stories.tsx tests/components/mainview/DiceRollerPanel.test.tsx
git commit -m "feat(dice): add interactive DiceRollerPanel component"
```

---

### Task 6: Gate the toolbar dice tool behind the feature flag

**Files:**

- Modify: `app/components/mainview/ToolBar.tsx`
- Test: `tests/components/mainview/ToolBar.test.tsx` (add mock + tests)

**Interfaces:**

- Consumes: `useOptionalFeatureFlag` from `~/utils/featureFlags`; env var `VITE_PUBLIC_FF_DICE`.
- Produces: no API change — `ToolBarProps` unchanged; the `dice` button (`data-testid="tool-dice"`) renders only when the flag resolves enabled.

- [ ] **Step 1: Write the failing test** — add to `tests/components/mainview/ToolBar.test.tsx`. At the top of the file (after existing imports), add the feature-flag mock following the InspectorSidebar.test convention:

```tsx
let diceFlagEnabled = false;
vi.mock('~/utils/featureFlags', () => ({
  useOptionalFeatureFlag: (flag: string) => ({
    isEnabled: Boolean(flag) && diceFlagEnabled,
    isLoading: false,
  }),
}));
```

Set the env var per test with `vi.stubEnv` and add a describe block (reuse the file's existing render helper/props if one exists; otherwise render with the minimal required props shown here):

```tsx
describe('dice tool feature flag', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PUBLIC_FF_DICE', 'cartyx-dice-dev');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hides the dice tool when the flag is disabled', () => {
    diceFlagEnabled = false;
    render(
      <ToolBar
        activeTool="pointer"
        onToolChange={() => {}}
        collapsed={false}
        onToggleCollapse={() => {}}
      />
    );
    expect(screen.queryByTestId('tool-dice')).not.toBeInTheDocument();
  });

  it('shows the dice tool when the flag is enabled', () => {
    diceFlagEnabled = true;
    render(
      <ToolBar
        activeTool="pointer"
        onToolChange={() => {}}
        collapsed={false}
        onToggleCollapse={() => {}}
      />
    );
    expect(screen.getByTestId('tool-dice')).toBeInTheDocument();
  });
});
```

Note: adding this `vi.mock` may require updating existing tests in the file that assert on the full tool list (they will now see no dice button since `diceFlagEnabled` starts `false`). Set `diceFlagEnabled = true` in the file-level `beforeEach` if existing assertions expect the dice button.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/mainview/ToolBar.test.tsx`
Expected: the new "hides the dice tool" test FAILS (dice button always renders today).

- [ ] **Step 3: Implement in `app/components/mainview/ToolBar.tsx`**

Add the import:

```tsx
import { useOptionalFeatureFlag } from '~/utils/featureFlags';
```

Inside the `ToolBar` function body, replace the `visibleTools` line:

```tsx
// The interactive dice roller ships behind the same flag as the Dice feed tab.
const diceFlag = useOptionalFeatureFlag(import.meta.env.VITE_PUBLIC_FF_DICE ?? '');
const visibleTools = tools.filter(
  (t) => (!t.gmOnly || isGM) && (t.id !== 'dice' || diceFlag.isEnabled)
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/components/mainview/ToolBar.test.tsx`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/ToolBar.tsx tests/components/mainview/ToolBar.test.tsx
git commit -m "feat(dice): gate toolbar dice tool behind VITE_PUBLIC_FF_DICE"
```

---

### Task 7: Open the dice roller window from the toolbar in `TabletopView`

The dice window is **not** stored in `localWindows` (the server-sync effect would wipe it); it lives in its own state slot and is merged at render.

**Files:**

- Modify: `app/components/mainview/tabletop/TabletopView.tsx`
- Test: `tests/components/mainview/TabletopView.test.tsx`

**Interfaces:**

- Consumes: `DiceRollerPanel` (Task 5), existing `ManagedWindow`/`FloatingWindowManager`, existing props `activeTool`/`onToolChange`.
- Produces: selecting the `dice` tool opens/focuses a singleton window `id: 'dice-roller'`, then immediately reverts the active tool to the previously selected tool. Closing/minimizing/moving the dice window works through the normal `FloatingWindowManager` callbacks.

- [ ] **Step 1: Write the failing tests** — in `tests/components/mainview/TabletopView.test.tsx`:

First upgrade the `FloatingWindowManager` mock so window titles are observable (replace the existing mock):

```tsx
vi.mock('~/components/mainview/FloatingWindowManager', () => ({
  FloatingWindowManager: ({ windows }: { windows: Array<{ id: string; title: string }> }) => (
    <div data-testid="floating-window-manager">
      {windows.map((w) => (
        <div key={w.id} data-testid={`fwm-window-${w.id}`}>
          {w.title}
        </div>
      ))}
    </div>
  ),
}));
```

Then add the new tests (the `DiceRollerPanel` renders inside the mocked manager, so no extra mocks are needed):

```tsx
it('opens the dice roller window when the dice tool is selected and reverts the tool', () => {
  const onToolChange = vi.fn();
  const { rerender } = render(
    <TabletopView
      campaignId="c1"
      isGM={true}
      currentUserId={null}
      getToken={mockGetToken}
      sessionId={null}
      activeTool="ruler"
      onToolChange={onToolChange}
    />,
    { wrapper: Wrapper }
  );
  expect(screen.queryByTestId('fwm-window-dice-roller')).not.toBeInTheDocument();

  rerender(
    <TabletopView
      campaignId="c1"
      isGM={true}
      currentUserId={null}
      getToken={mockGetToken}
      sessionId={null}
      activeTool="dice"
      onToolChange={onToolChange}
    />
  );
  expect(screen.getByTestId('fwm-window-dice-roller')).toHaveTextContent('Dice Roller');
  expect(onToolChange).toHaveBeenCalledWith('ruler');
});

it('keeps the dice window a singleton across repeated dice-tool selections', () => {
  const onToolChange = vi.fn();
  const props = {
    campaignId: 'c1',
    isGM: true,
    currentUserId: null,
    getToken: mockGetToken,
    sessionId: null,
    onToolChange,
  };
  const { rerender } = render(<TabletopView {...props} activeTool="pointer" />, {
    wrapper: Wrapper,
  });
  rerender(<TabletopView {...props} activeTool="dice" />);
  rerender(<TabletopView {...props} activeTool="pointer" />);
  rerender(<TabletopView {...props} activeTool="dice" />);
  expect(screen.getAllByTestId('fwm-window-dice-roller')).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/components/mainview/TabletopView.test.tsx`
Expected: new tests FAIL (`fwm-window-dice-roller` never appears); the three pre-existing tests still PASS.

- [ ] **Step 3: Implement in `app/components/mainview/tabletop/TabletopView.tsx`**

Add the import near the other component imports:

```tsx
import { DiceRollerPanel } from '~/components/mainview/DiceRollerPanel';
```

Add a module-level constant under the `DialogState` section:

```tsx
const DICE_ROLLER_WINDOW_ID = 'dice-roller';
```

Add state next to `localWindows` (line ~122):

```tsx
// The dice roller is a per-user ephemeral window: it lives outside
// localWindows because the server-sync effect rebuilds that array from
// activeScreen.windows and would drop it.
const [diceWindow, setDiceWindow] = useState<ManagedWindow | null>(null);
const prevToolRef = useRef<ToolType>('pointer');
```

Add the open/focus effect after the `localWindows` server-sync effect (after line ~465):

```tsx
// Selecting the dice tool acts as a button: open/focus the roller window,
// then hand the toolbar back to the previously active tool.
useEffect(() => {
  if (activeTool === 'dice') {
    setDiceWindow((w) => {
      const zTop = Math.max(0, ...localWindows.map((lw) => lw.zIndex), w?.zIndex ?? 0) + 1;
      if (w) return { ...w, state: 'normal', zIndex: zTop };
      return {
        id: DICE_ROLLER_WINDOW_ID,
        title: 'Dice Roller',
        content: <DiceRollerPanel />,
        position: { x: 80, y: 80 },
        size: { width: 340, height: 560 },
        state: 'normal',
        zIndex: zTop,
      };
    });
    onToolChange?.(prevToolRef.current);
  } else if (activeTool) {
    prevToolRef.current = activeTool;
  }
}, [activeTool, onToolChange, localWindows]);
```

Update `handleWindowsChange` (line ~468) to split the dice window back out:

```tsx
const handleWindowsChange = useCallback(
  (nextWindows: ManagedWindow[]) => {
    // The dice roller window is per-user state, never persisted server-side.
    const dice = nextWindows.find((w) => w.id === DICE_ROLLER_WINDOW_ID) ?? null;
    const rest = nextWindows.filter((w) => w.id !== DICE_ROLLER_WINDOW_ID);

    // Optimistically update local state immediately (handles minimize/restore/move/resize)
    setDiceWindow(dice);
    setLocalWindows(rest);

    if (!activeScreenId || !activeScreen) return;

    // Handle closes — fire close mutation for removed windows
    const nextIds = new Set(rest.map((w) => w.id));
    for (const w of activeScreen.windows) {
      if (!nextIds.has(w.id)) {
        mutations.closeWindow.mutate({ screenId: activeScreenId, windowId: w.id });
      }
    }
  },
  [activeScreenId, activeScreen, mutations]
);
```

Update the render (line ~605) to merge the dice window in:

```tsx
<FloatingWindowManager
  windows={diceWindow ? [...localWindows, diceWindow] : localWindows}
  onWindowsChange={handleWindowsChange}
/>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/components/mainview/TabletopView.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/tabletop/TabletopView.tsx tests/components/mainview/TabletopView.test.tsx
git commit -m "feat(dice): open dice roller floating window from the toolbar dice tool"
```

---

### Task 8: Relay public rolls through `InspectorSidebar`'s socket

**Files:**

- Modify: `app/components/mainview/InspectorSidebar.tsx`
- Test: `tests/components/mainview/InspectorSidebar.test.tsx`

**Interfaces:**

- Consumes: Task 3 bridge (`onDiceBroadcastRequest`, `reportDiceDelivery`), existing `sendDiceRoll`/`socket`/`user`.
- Produces: any `requestDiceBroadcast` fired anywhere in the app is relayed to the PartyKit `main` party as a `DICE` message with `character` defaulted to the signed-in user's name; a `DiceDeliveryReport` is always emitted back.

- [ ] **Step 1: Write the failing tests** — add to `tests/components/mainview/InspectorSidebar.test.tsx`. The file already mocks `~/hooks/useDiceRolls`, `~/hooks/usePartySession`, and `~/hooks/useAuth`; import the mocked modules and the bridge:

```tsx
import { useDiceRolls } from '~/hooks/useDiceRolls';
import { usePartySession } from '~/hooks/usePartySession';
import { requestDiceBroadcast, onDiceDelivery } from '~/utils/diceRollerBridge';
import { act } from '@testing-library/react';
```

New describe block (uses `sessions` with an active entry so the sidebar wires the socket path):

```tsx
describe('dice roller broadcast relay', () => {
  const activeSessions = [{ id: 'sess-1', name: 'One', number: 1, status: 'active' }];
  const parsedRoll = {
    character: '',
    title: '1d20',
    rollType: 'custom',
    attackRolls: [
      { roll: 11, type: 'hit' as const, total: 11, formula: '1d20', discarded: false, dice: [11] },
    ],
    damageRolls: [],
    totalDamages: {},
    rollInfo: [] as Array<[string, string]>,
    description: '',
    channel: 'general' as const,
  };

  it('relays public rolls to sendDiceRoll with the user name and reports delivery', () => {
    const sendDiceRoll = vi.fn();
    vi.mocked(useDiceRolls).mockReturnValue({
      rolls: [],
      sendDiceRoll,
      handlePartyMessage: vi.fn(),
      saveError: null,
      setSaveError: vi.fn(),
    });
    const fakeSocket = { send: vi.fn(), readyState: WebSocket.OPEN };
    vi.mocked(usePartySession).mockReturnValue(fakeSocket as never);

    const deliveries: Array<{ requestId: string; delivered: boolean }> = [];
    const unsubscribe = onDiceDelivery((d) => deliveries.push(d));

    render(<InspectorSidebar campaignId="c1" sessions={activeSessions} />);
    act(() => {
      requestDiceBroadcast({ requestId: 'req-1', roll: parsedRoll });
    });

    expect(sendDiceRoll).toHaveBeenCalledExactlyOnceWith(
      { ...parsedRoll, character: 'Test' },
      fakeSocket
    );
    expect(deliveries).toEqual([{ requestId: 'req-1', delivered: true }]);
    unsubscribe();
  });

  it('reports delivered=false without sending when the socket is not open', () => {
    const sendDiceRoll = vi.fn();
    vi.mocked(useDiceRolls).mockReturnValue({
      rolls: [],
      sendDiceRoll,
      handlePartyMessage: vi.fn(),
      saveError: null,
      setSaveError: vi.fn(),
    });
    vi.mocked(usePartySession).mockReturnValue(null as never);

    const deliveries: Array<{ requestId: string; delivered: boolean }> = [];
    const unsubscribe = onDiceDelivery((d) => deliveries.push(d));

    render(<InspectorSidebar campaignId="c1" sessions={activeSessions} />);
    act(() => {
      requestDiceBroadcast({ requestId: 'req-2', roll: parsedRoll });
    });

    expect(sendDiceRoll).not.toHaveBeenCalled();
    expect(deliveries).toEqual([{ requestId: 'req-2', delivered: false }]);
    unsubscribe();
  });
});
```

Note: `vi.mocked(useDiceRolls).mockReturnValue(...)` works because the module mock wraps the factory in `vi.fn()`. If the existing file-level mocks return fresh objects per call, `mockReturnValue` on the imported mock overrides them for these tests. Restore with `vi.mocked(...).mockRestore()` is unnecessary — `vi.clearAllMocks()` patterns in the file's `beforeEach` (if present) or re-mocking per test keeps isolation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/components/mainview/InspectorSidebar.test.tsx`
Expected: new tests FAIL (`sendDiceRoll` never called; no deliveries). Existing tests PASS.

- [ ] **Step 3: Implement in `app/components/mainview/InspectorSidebar.tsx`**

Add the import:

```tsx
import { onDiceBroadcastRequest, reportDiceDelivery } from '~/utils/diceRollerBridge';
```

After the `useBeyond20(...)` call (line ~169), add:

```tsx
// Relay interactive dice-roller rolls (DiceRollerPanel → window event) to the
// session socket, mirroring how Beyond20 extension rolls are relayed above.
useEffect(() => {
  return onDiceBroadcastRequest(({ requestId, roll }) => {
    const canSend =
      isViewingActive && !!activeSessionId && !!socket && socket.readyState === WebSocket.OPEN;
    if (canSend) {
      sendDiceRoll({ ...roll, character: roll.character || user?.name || 'Player' }, socket);
    }
    reportDiceDelivery({ requestId, delivered: canSend });
  });
}, [socket, sendDiceRoll, isViewingActive, activeSessionId, user?.name]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/components/mainview/InspectorSidebar.test.tsx`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full unit suite and typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS with no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/mainview/InspectorSidebar.tsx tests/components/mainview/InspectorSidebar.test.tsx
git commit -m "feat(dice): relay dice roller broadcasts through the session socket"
```

---

### Task 9: End-to-end test (Playwright)

The Playwright web server runs only `npm run dev` — **no PartyKit dev server**. The spec therefore mocks the `main` party WebSocket with `page.routeWebSocket`, acting as the server: send `HISTORY` on connect, echo `DICE` messages back with a valid `seq`. This exercises the full client pipeline (toolbar → window → roll → bridge → sidebar → socket → Dice tab render → Mongo save on echo).

**Files:**

- Modify: `.github/workflows/ci.yml` (e2e job env)
- Modify: `.env` (local only — gitignored, do not commit)
- Create: `e2e/tabletop/dice-roller.spec.ts`

**Interfaces:**

- Consumes: test ids from Tasks 5–7, `mockPostHog` from `e2e/fixtures/network-mocks.ts` (already includes `cartyx-dice-dev`), provisioning pattern from `e2e/tabletop/tabletop-monster-window.spec.ts`.
- Produces: green `npx playwright test e2e/tabletop/dice-roller.spec.ts`.

- [ ] **Step 1: Add the flag env var for the dev server**

Local (gitignored `.env` — add the line, do not commit):

```
VITE_PUBLIC_FF_DICE=cartyx-dice-dev
```

CI — in `.github/workflows/ci.yml`, add to the **e2e job's** `env:` block (alongside `SESSION_SECRET`/`MONGODB_URI`):

```yaml
# Dice roller e2e: the flag NAME must be present for the client to query
# PostHog; the e2e PostHog mock then reports it enabled.
VITE_PUBLIC_FF_DICE: cartyx-dice-dev
```

- [ ] **Step 2: Write the e2e spec**

```ts
// e2e/tabletop/dice-roller.spec.ts
/**
 * E2E: the toolbar dice tool opens the dice roller window; rolls show a
 * per-die breakdown; public rolls appear in the Inspector Dice tab.
 *
 * The PartyKit `main` party is mocked with routeWebSocket (the e2e web server
 * only runs `npm run dev`): we act as the server — HISTORY on connect, echo
 * DICE messages back with a server-assigned seq.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { decodeJwt } from 'jose';
import { mockPostHog } from '../fixtures/network-mocks';

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const CAMPAIGN_NAME = 'E2E Dice Roller';

let client: MongoClient;
let campaignId: string;

async function provision(db: Db): Promise<string> {
  const storage = JSON.parse(
    readFileSync(join(process.cwd(), 'e2e', '.auth', 'storageState.json'), 'utf-8')
  ) as { cookies: Array<{ name: string; value: string }> };
  const cookie = storage.cookies.find((c) => c.name === 'cartyx_session');
  if (!cookie) throw new Error('No cartyx_session cookie — globalSetup did not run?');
  const providerId = (decodeJwt(cookie.value) as { user?: { id?: string } }).user?.id;
  const gm = await db.collection('users').findOne({ providerId });
  if (!gm?._id) throw new Error('Session GM user not found');

  const stale = await db
    .collection('campaigns')
    .find({ name: CAMPAIGN_NAME }, { projection: { _id: 1 } })
    .toArray();
  if (stale.length) {
    const ids = stale.map((c) => c._id);
    await db.collection('tabletopscreen').deleteMany({ campaignId: { $in: ids } });
    await db.collection('sessions').deleteMany({ campaignId: { $in: ids } });
    await db.collection('dicerolls').deleteMany({ campaignId: { $in: ids.map(String) } });
    await db.collection('campaigns').deleteMany({ _id: { $in: ids } });
  }

  const now = new Date();
  const cid = (
    await db.collection('campaigns').insertOne({
      gameMasterId: gm._id,
      name: CAMPAIGN_NAME,
      description: 'E2E dice roller test.',
      status: 'active',
      inviteCode: 'e2e-' + Math.random().toString(36).slice(2, 12),
      maxPlayers: 6,
      members: [{ userId: gm._id, role: 'gm', joinedAt: now }],
      links: [],
      createdAt: now,
      updatedAt: now,
    })
  ).insertedId;

  // An ACTIVE session — the sidebar only opens a socket when one exists.
  await db.collection('sessions').insertOne({
    campaignId: cid,
    name: 'Dice Session',
    gm: gm._id,
    number: 1,
    startDate: now,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  // A tab with no active map keeps the workspace simple.
  await db.collection('tabletopscreen').insertOne({
    campaignId: cid,
    name: 'Main',
    tabOrder: 0,
    createdBy: gm._id,
    mode: 'grid',
    gridStyle: 'dark',
    gridSize: 50,
    gridVisible: true,
    gridScale: 5,
    locationId: null,
    battleMapImage: null,
    activeMapId: null,
    windows: [],
    createdAt: now,
    updatedAt: now,
  });

  return String(cid);
}

test.beforeAll(async () => {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* env may be set externally */
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  client = new MongoClient(uri);
  await client.connect();
  const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
  campaignId = await provision(db);
});

test.afterAll(async () => {
  if (!client) return;
  if (campaignId) {
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    const cid = new ObjectId(campaignId);
    await db.collection('tabletopscreen').deleteMany({ campaignId: cid });
    await db.collection('sessions').deleteMany({ campaignId: cid });
    await db.collection('dicerolls').deleteMany({ campaignId });
    await db.collection('campaigns').deleteMany({ _id: cid });
  }
  await client.close();
});

/** Mock the PartyKit `main` party: HISTORY on connect, echo DICE with a seq. */
async function mockMainParty(page: Page): Promise<void> {
  let seq = 0;
  await page.routeWebSocket(
    (url) => /\/parties\/main\//.test(url.href),
    (ws) => {
      ws.send(JSON.stringify({ type: 'HISTORY', messages: [] }));
      ws.onMessage((message) => {
        const msg = JSON.parse(message as string) as { type?: string };
        if (msg.type === 'DICE') {
          seq += 1;
          ws.send(JSON.stringify({ ...msg, seq }));
        }
      });
    }
  );
}

async function openRoller(page: Page): Promise<void> {
  await mockPostHog(page);
  await mockMainParty(page);
  await page.goto(`/campaigns/${campaignId}/play?tab=tabletop`);
  await expect(page.getByTestId('tabletop-workspace')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('tool-dice').click();
  await expect(page.getByTestId('dice-roller-panel')).toBeVisible();
}

test('private roll shows a verifiable per-die breakdown and stays out of the feed', async ({
  page,
}) => {
  await openRoller(page);

  await page.getByTestId('dice-roller-privacy-private').click();
  for (let i = 0; i < 3; i++) await page.getByTestId('dice-roller-die-6').click();
  for (let i = 0; i < 4; i++) await page.getByTestId('dice-roller-modifier-inc').click();
  await page.getByTestId('dice-roller-roll').click();

  const result = page.getByTestId('dice-roller-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('3d6 + 4');

  // Verify the math the way a suspicious player would: dice sum + modifier = total.
  const text = (await result.textContent()) ?? '';
  const breakdown = text.match(/\((\d+) \+ (\d+) \+ (\d+)\)\s*\+\s*4\s*=\s*(\d+)/);
  expect(breakdown, `no per-die breakdown in: ${text}`).not.toBeNull();
  const [, a, b, c, total] = breakdown!.map(Number) as unknown as number[];
  for (const die of [a!, b!, c!]) {
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(6);
  }
  expect(a! + b! + c! + 4).toBe(total);

  // Private: the Dice tab feed stays empty.
  await page.getByTestId('inspector-tab-dice').click();
  await expect(page.getByTestId('inspector-panel')).not.toContainText('3d6 + 4');
});

test('public roll appears in the Dice tab feed like a Beyond20 card', async ({ page }) => {
  await openRoller(page);

  await page.getByTestId('dice-roller-die-20').click();
  // Public is the default.
  await page.getByTestId('dice-roller-roll').click();
  await expect(page.getByTestId('dice-roller-result')).toBeVisible();
  await expect(page.getByTestId('dice-roller-notice')).toHaveCount(0);

  await page.getByTestId('inspector-tab-dice').click();
  const feed = page.getByTestId('inspector-panel');
  await expect(feed).toContainText('1d20');
  await expect(feed).toContainText('Result');
});

test('advantage rolls twice and strikes through the discarded set', async ({ page }) => {
  await openRoller(page);

  await page.getByTestId('dice-roller-die-20').click();
  await page.getByTestId('dice-roller-mode-advantage').click();
  await page.getByTestId('dice-roller-privacy-private').click();
  await page.getByTestId('dice-roller-roll').click();

  const result = page.getByTestId('dice-roller-result');
  await expect(result).toContainText('Mode: Advantage');
  await expect(result.locator('.line-through')).toHaveCount(1);
});
```

- [ ] **Step 3: Run the e2e spec**

Prereqs: MongoDB running and `.env` complete (`MONGODB_URI`, `SESSION_SECRET`, `VITE_PUBLIC_FF_DICE=cartyx-dice-dev`). Then:

Run: `npx playwright test e2e/tabletop/dice-roller.spec.ts`
Expected: 3 passed. If `tool-dice` is not found, the dev server was started without `VITE_PUBLIC_FF_DICE` — restart it (kill any reused dev server so Playwright boots a fresh one with the new env).

- [ ] **Step 4: Commit**

```bash
git add e2e/tabletop/dice-roller.spec.ts .github/workflows/ci.yml
git commit -m "test(dice): e2e coverage for dice roller window, privacy, and feed broadcast"
```

---

### Task 10: Feature documentation

**Files:**

- Create: `docs/tabletop/dice-roller.md`

- [ ] **Step 1: Write the doc**

```markdown
# Dice Roller

Interactive dice rolling from the tabletop toolbar (dice icon). Feature-flagged
by `VITE_PUBLIC_FF_DICE` (PostHog flag; dev name `cartyx-dice-dev`) — the same
flag that gates the Inspector Dice tab.

## Usage

1. On the Tabletop view, click the dice icon in the left toolbar. A floating
   "Dice Roller" window opens (per-user, not shared, not persisted).
2. Click dice tiles (d100/d20/d12/d10/d8/d6/d4) to build a pool — a badge shows
   the queued count; clicking the badge removes one. **Reset** clears the pool.
3. Optional: set a modifier (−99…+99) and a roll mode (Normal / Adv / Dis).
   Advantage rolls the entire pool twice and keeps the higher total;
   disadvantage keeps the lower. The discarded set stays visible, struck
   through.
4. Choose **Public** (default) or **Private**, then **Roll**. The result always
   shows every individual die value so totals are verifiable.

Private rolls render only inside the window. Public rolls also appear in the
Inspector **Dice** tab for everyone in the active session, rendered with the
same card style as Beyond20 rolls, and are persisted to session history.

## Architecture

- `app/utils/dice.ts` — pure engine (`rollDice`, `formatPool`,
  `toParsedDiceRoll`). Crypto RNG with rejection sampling; injectable `rng`
  for deterministic tests.
- `app/components/mainview/DiceRollerPanel.tsx` — the window content; owns
  pool/modifier/mode/privacy state; renders the last result via
  `DiceRollCard` (`rollType: 'custom'` variant shows all die values and a
  "Result" label).
- `app/components/mainview/tabletop/TabletopView.tsx` — selecting the `dice`
  tool opens a singleton ephemeral `ManagedWindow` (id `dice-roller`) kept
  outside `localWindows` (the server-sync effect would drop it), then reverts
  to the previously active tool.
- `app/utils/diceRollerBridge.ts` — window-event bridge. The panel emits
  `DiceBroadcastRequest`; `InspectorSidebar` (socket owner) relays it via the
  existing `useDiceRolls.sendDiceRoll` over the PartyKit `main` party `DICE`
  message and answers with a `DiceDeliveryReport`. On failure the panel shows
  an inline notice and the roll stays local.

No server changes: the existing `DICE` wire type (`party/index.ts`), Mongo
save path (`saveDiceRollSchema`), and 50-message room history are reused.

## Message flow (public roll)

DiceRollerPanel → rollDice() → toParsedDiceRoll() → requestDiceBroadcast()
→ InspectorSidebar onDiceBroadcastRequest → sendDiceRoll(socket) → PartyKit
`main` party (validates, assigns seq, broadcasts) → all clients' useDiceRolls
→ Dice tab DiceRollCard; the sender also persists the echoed roll to Mongo.

## Testing

- Unit: `tests/utils/dice.test.ts`, `tests/utils/diceRollerBridge.test.ts`,
  `tests/components/mainview/DiceRollerPanel.test.tsx` (+ DicePanel, ToolBar,
  TabletopView, InspectorSidebar extensions).
- E2E: `e2e/tabletop/dice-roller.spec.ts` — mocks the `main` party WebSocket
  (HISTORY + DICE echo) since the Playwright web server doesn't run PartyKit.
  Requires `VITE_PUBLIC_FF_DICE=cartyx-dice-dev` in the dev server env.
```

- [ ] **Step 2: Commit**

```bash
git add docs/tabletop/dice-roller.md
git commit -m "docs(dice): document the dice roller feature and message flow"
```

---

### Task 11: Full validation, manual smoke, PR to dev

- [ ] **Step 1: Full automated gate**

Run: `npm run test && npm run typecheck && npm run lint && npx playwright test e2e/tabletop/dice-roller.spec.ts`
Expected: all PASS. Fix anything that fails before proceeding.

- [ ] **Step 2: Manual smoke against the real PartyKit server**

1. Ensure `.env` has `VITE_PUBLIC_FF_DICE=cartyx-dice-dev`.
2. Terminal A: `npm run dev`. Terminal B: `npm run party:dev`.
3. Open a campaign with an **active session** → Tabletop tab.
4. Click the toolbar dice icon → window opens; queue `2d6 + 1d8 + 3`; roll
   Normal/Public → per-die breakdown in the window AND a "Result" card in the
   Dice tab.
5. Roll Private → window only; Dice tab unchanged.
6. Roll 1d20 Advantage → two totals, discarded one struck through, ADV badge
   in the Dice tab card.
7. Reload the page → the roller window is gone (ephemeral, by design); the
   public roll survives in the Dice tab (Mongo history).

Expected: all seven observations hold. If PartyKit rejects messages check that
`SESSION_SECRET` matches between the app env and the PartyKit dev env.

- [ ] **Step 3: Push and open the PR (targets `dev`)**

```bash
git push -u origin virtual-dice
gh pr create --base dev --title "feat: virtual dice roller" --body "$(cat <<'EOF'
## Summary
- Interactive dice roller opened from the tabletop toolbar dice icon (feature-flagged by VITE_PUBLIC_FF_DICE)
- Pool of d100/d20/d12/d10/d8/d6/d4 with count badges, modifier stepper, Normal/Advantage/Disadvantage, Public/Private
- Results always show every individual die value; public rolls broadcast over the existing DICE PartyKit message and render in the Dice tab like Beyond20 rolls (persisted to session history)
- No new dependencies; no PartyKit/server schema changes

Design spec: docs/specs/2026-07-06-dice-roller-design.md
Plan: docs/specs/2026-07-06-dice-roller-plan.md

## Test plan
- [ ] Unit: engine bounds/adv/dis/modifier, wire-shape mapping vs saveDiceRollSchema, bridge, panel, toolbar gating, TabletopView window, sidebar relay
- [ ] E2E: e2e/tabletop/dice-roller.spec.ts (window open, private breakdown math, public feed card, advantage strikethrough)
- [ ] Manual smoke with real PartyKit dev server

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `dev` and CI goes green (unit + e2e jobs).
