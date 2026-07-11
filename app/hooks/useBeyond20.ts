import { useEffect, useState, useRef } from 'react';
import { captureEvent } from '~/utils/telemetry-client';

interface Beyond20Roll {
  action: string;
  request: {
    type: string;
  };
  title: string;
  character: string;
  source: string;
  description?: string;
  whisper: number;
  attack_rolls: Array<{
    total: number;
    formula?: string;
    parts?: unknown[];
    'critical-success'?: boolean;
    'critical-failure'?: boolean;
    discarded?: boolean;
  }>;
  damage_rolls: Array<
    [
      string,
      {
        total: number;
        formula?: string;
        parts?: unknown[];
        dice?: Array<{ faces: number; value: number }>;
      },
      number,
    ]
  >;
  total_damages: Record<string, { total: number; formula?: string }>;
  roll_info: Array<[string, string]>;
}

export interface ParsedDiceRoll {
  character: string;
  title: string;
  rollType: string;
  attackRolls: Array<{
    roll: number;
    type: 'hit' | 'crit' | 'miss' | 'crit-fail';
    total: number;
    formula: string;
    discarded: boolean;
    dice: number[];
  }>;
  damageRolls: Array<{
    damageType: string;
    dice: number[];
    total: number;
    flags: number;
    formula: string;
  }>;
  totalDamages: Record<string, number>;
  rollInfo: Array<[string, string]>;
  description: string;
  channel: 'general' | 'gm';
}

export interface ParsedSpellCard {
  character: string;
  title: string;
  source: string;
  description: string;
  properties: Record<string, string>;
  channel: 'general' | 'gm';
}

function mapWhisperToChannel(whisper: number): 'general' | 'gm' {
  return whisper === 1 || whisper === 3 ? 'gm' : 'general';
}

// NOTE: 'miss' is retained in the type union for future use. Beyond 20 does not
// provide a separate miss flag — hit/miss determination requires AC comparison
// which the extension doesn't have access to. Currently this always returns 'hit'
// as the default (non-crit, non-crit-fail) case.
function classifyAttackRoll(
  roll: Beyond20Roll['attack_rolls'][number]
): 'hit' | 'crit' | 'miss' | 'crit-fail' {
  if (roll['critical-success']) return 'crit';
  if (roll['critical-failure']) return 'crit-fail';
  return 'hit';
}

function parseDiceRoll(raw: Beyond20Roll): ParsedDiceRoll {
  // Include all rolls (even discarded) so players see both advantage/disadvantage rolls
  const attackRolls = raw.attack_rolls.map((r) => {
    // Extract individual dice values from parts[].rolls[].roll (e.g., both d20s for advantage)
    let dice: number[] = [];
    if (r.parts && Array.isArray(r.parts)) {
      for (const part of r.parts as Array<{ rolls?: Array<{ roll: number }> }>) {
        if (part.rolls) {
          dice = dice.concat(part.rolls.map((pr) => pr.roll));
        }
      }
    }
    return {
      roll: r.total,
      type: classifyAttackRoll(r),
      total: r.total,
      formula: r.formula ?? '',
      discarded: r.discarded ?? false,
      dice,
    };
  });

  const damageRolls = raw.damage_rolls.map(([damageType, roll, flags]) => {
    // Beyond20 stores individual dice in parts[].rolls[].roll
    let dice: number[] = [];
    if (roll.parts && Array.isArray(roll.parts)) {
      for (const part of roll.parts as Array<{ rolls?: Array<{ roll: number }> }>) {
        if (part.rolls) {
          dice = dice.concat(part.rolls.map((r) => r.roll));
        }
      }
    }
    // Fallback to roll.dice if parts isn't available
    if (dice.length === 0 && roll.dice) {
      dice = roll.dice.map((d) => d.value);
    }
    return {
      damageType,
      dice,
      total: roll.total,
      flags: flags ?? 1,
      formula: roll.formula ?? '',
    };
  });

  const totalDamages: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw.total_damages)) {
    totalDamages[key] = val.total;
  }

  return {
    character: raw.character,
    title: raw.title,
    rollType: raw.request.type,
    attackRolls,
    damageRolls,
    totalDamages,
    rollInfo: raw.roll_info ?? [],
    description: raw.description ?? '',
    channel: mapWhisperToChannel(raw.whisper),
  };
}

function parseSpellCard(raw: Beyond20Roll): ParsedSpellCard {
  const properties: Record<string, string> = {};
  if (raw.roll_info) {
    for (const [key, value] of raw.roll_info) {
      properties[key] = value;
    }
  }

  return {
    character: raw.character,
    title: raw.title,
    source: raw.source ?? '',
    description: raw.description ?? '',
    properties,
    channel: mapWhisperToChannel(raw.whisper),
  };
}

function hasDiceResults(raw: Beyond20Roll): boolean {
  return (raw.attack_rolls?.length ?? 0) > 0 || (raw.damage_rolls?.length ?? 0) > 0;
}

export function useBeyond20(
  onDiceRoll: (roll: ParsedDiceRoll) => void,
  onSpellCard: (card: ParsedSpellCard) => void
) {
  const [isConnected, setIsConnected] = useState(false);

  const onDiceRollRef = useRef(onDiceRoll);
  onDiceRollRef.current = onDiceRoll;
  const onSpellCardRef = useRef(onSpellCard);
  onSpellCardRef.current = onSpellCard;

  useEffect(() => {
    function handleLoaded() {
      console.info('[Beyond20] Loaded');
      setIsConnected(true);
      captureEvent('party.beyond20_connected', {});
    }

    function handleRenderedRoll(evt: Event) {
      // Mark as connected on first roll if we missed the Loaded event (race condition)
      setIsConnected(true);

      const detail = (evt as CustomEvent).detail;
      const raw: Beyond20Roll = Array.isArray(detail) ? detail[0] : detail;

      if (!raw) return;

      if (hasDiceResults(raw)) {
        console.debug(
          `[Beyond20] Routed to dice type=${raw.request?.type} character=${raw.character} title=${raw.title}`
        );
        onDiceRollRef.current(parseDiceRoll(raw));
      } else {
        console.debug(
          `[Beyond20] Routed to chat type=${raw.request?.type} character=${raw.character} title=${raw.title}`
        );
        onSpellCardRef.current(parseSpellCard(raw));
      }
    }

    document.addEventListener('Beyond20_Loaded', handleLoaded);
    document.addEventListener('Beyond20_RenderedRoll', handleRenderedRoll);

    return () => {
      document.removeEventListener('Beyond20_Loaded', handleLoaded);
      document.removeEventListener('Beyond20_RenderedRoll', handleRenderedRoll);
    };
  }, []);

  return { isConnected };
}
