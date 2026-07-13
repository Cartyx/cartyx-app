import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/utils/diceRollerBridge', () => ({
  requestDiceBroadcast: vi.fn(),
}));

import { requestDiceBroadcast } from '~/utils/diceRollerBridge';
import {
  stepsForCast,
  scaledDice,
  buildPool,
  rollSpellModifier,
} from '~/components/wiki/spells/spellDice';
import type { SpellData, SpellModifier } from '~/types/spell';

const mockRequestDiceBroadcast = vi.mocked(requestDiceBroadcast);

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
    expect(mockRequestDiceBroadcast).toHaveBeenCalledTimes(1);
    const arg = mockRequestDiceBroadcast.mock.calls[0][0];
    expect(arg.roll.title).toBe('Fireball · Fire');
    expect(typeof arg.requestId).toBe('string');
  });

  it('returns the outcome for local display', () => {
    const outcome = rollSpellModifier({
      spell: spell(),
      modifier: fireballMod,
      castLevel: 5,
      crit: false,
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.title).toBe('Fireball · Fire');
    // Fireball at slot 5 = 10d6 → total between 10 and 60.
    expect(outcome!.total).toBeGreaterThanOrEqual(10);
    expect(outcome!.total).toBeLessThanOrEqual(60);
    expect(outcome!.formula).toContain('10d6');
  });
});
