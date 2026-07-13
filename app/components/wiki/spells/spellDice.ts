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

export interface SpellRollOutcome {
  title: string;
  formula: string;
  total: number;
}

/**
 * Roll one modifier at the given cast level. Broadcasts to the session dice log
 * (delivered only when in an active session) AND returns the outcome so the
 * caller can always show a local result — mirroring how the dice roller shows a
 * local roll independent of the broadcast. Returns null if the modifier has no
 * dice.
 */
export function rollSpellModifier(args: {
  spell: SpellData;
  modifier: SpellModifier;
  castLevel: number;
  crit: boolean;
}): SpellRollOutcome | null {
  const dice = scaledDice(args.modifier, args.spell, args.castLevel);
  if (!dice) return null;
  const result = rollDice({ pool: buildPool(dice, args.crit), mode: 'normal', modifier: 0 });
  const title = modifierLabel(args.spell, args.modifier);
  const roll = toParsedDiceRoll(result, { title });
  requestDiceBroadcast({ requestId: crypto.randomUUID(), roll });
  return { title, formula: result.formula, total: result.total };
}
