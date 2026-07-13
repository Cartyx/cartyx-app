/**
 * Typed loaders for the committed, generated SRD 5.2.1 data. These JSON files
 * are produced by `npm run srd:generate` from the CC-BY sources under docs/srd/
 * and are bundled into the server build (the runtime never reads docs/).
 */
import spellsJson from './spells.json';
import racesJson from './races.json';
import rulesJson from './rules.json';

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
