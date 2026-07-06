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
