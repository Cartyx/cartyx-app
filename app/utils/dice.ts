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
