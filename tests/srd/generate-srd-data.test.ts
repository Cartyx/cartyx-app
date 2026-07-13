import { describe, it, expect } from 'vitest';
import { parseSpellMarkdown } from '../../scripts/srd/generate-srd-data';

// Mirrors the real docs/srd/spells/spells-5.2.1.md structure: `#### Name`
// entries under a "## Spell Descriptions" section, an underscore-italic
// level/school/classes line, bold stat labels, and an underscore scaling note.
const SAMPLE = `# Spells

## Spell Descriptions

#### Fire Bolt

_Evocation Cantrip (Sorcerer, Wizard)_

**Casting Time:** Action
**Range:** 120 feet
**Components:** V, S
**Duration:** Instantaneous

You hurl a mote of fire at a creature or an object within range. Make a ranged spell attack against the target. On a hit, the target takes 1d10 Fire damage.

_Cantrip Upgrade._ The damage increases by 1d10 when you reach levels 5 (2d10), 11 (3d10), and 17 (4d10).

#### Fireball

_Level 3 Evocation (Sorcerer, Wizard)_

**Casting Time:** Action
**Range:** 150 feet
**Components:** V, S, M (a ball of bat guano and sulfur)
**Duration:** Instantaneous

Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save.

_Using a Higher-Level Spell Slot._ The damage increases by 1d6 for each spell slot level above 3.

#### Detect Magic

_Level 1 Divination (Bard, Cleric, Wizard)_

**Casting Time:** Action or Ritual
**Range:** Self
**Components:** V, S
**Duration:** Concentration, up to 10 minutes

You sense the presence of magic within 30 feet of you.

#### Lightning Bolt

_Level 3 Evocation (Sorcerer, Wizard)_

**Casting Time:** Action
**Range:** Self
**Components:** V, S, M (a bit of fur and a crystal rod)
**Duration:** Instantaneous

A 100-foot-long, 5-foot-wide Line blasts out from you. Each creature in the Line makes a Dexterity saving throw, taking 8d6 Lightning damage.
`;

describe('parseSpellMarkdown', () => {
  const spells = parseSpellMarkdown(SAMPLE);
  const byName = (n: string) => spells.find((s) => s.name === n)!;

  it('parses all four spell entries', () => {
    expect(spells.map((s) => s.name)).toEqual([
      'Fire Bolt',
      'Fireball',
      'Detect Magic',
      'Lightning Bolt',
    ]);
  });

  it('parses a cantrip with attack, damage dice, classes, and scaling', () => {
    const bolt = byName('Fire Bolt');
    expect(bolt.level).toBe(0);
    expect(bolt.school).toBe('evocation');
    expect(bolt.range).toEqual({ type: 'ranged', distance: 120 });
    expect(bolt.attackSave).toEqual({ kind: 'attack', attackType: 'ranged' });
    expect(bolt.modifiers[0].dice).toEqual({ count: 1, sides: 10 });
    expect(bolt.modifiers[0].damageType).toBe('fire');
    expect(bolt.classes).toEqual(['Sorcerer', 'Wizard']);
    expect(bolt.higherLevels).toHaveLength(1);
  });

  it('parses a leveled save spell with material + sphere AoE', () => {
    const ball = byName('Fireball');
    expect(ball.level).toBe(3);
    expect(ball.components).toEqual({
      verbal: true,
      somatic: true,
      material: true,
      materialDescription: 'a ball of bat guano and sulfur',
    });
    expect(ball.attackSave).toEqual({ kind: 'save', saveAbility: 'dex' });
    expect(ball.areaOfEffect).toEqual({ shape: 'sphere', size: 20 });
    expect(ball.higherLevels).toHaveLength(1);
  });

  it('detects ritual from the casting time and concentration duration', () => {
    const dm = byName('Detect Magic');
    expect(dm.ritual).toBe(true);
    expect(dm.duration).toEqual({
      type: 'concentration',
      value: 10,
      unit: 'minute',
      concentration: true,
    });
    expect(dm.classes).toEqual(['Bard', 'Cleric', 'Wizard']);
  });

  it('parses a line AoE with width', () => {
    const lb = byName('Lightning Bolt');
    expect(lb.areaOfEffect).toEqual({ shape: 'line', size: 100, width: 5 });
    expect(lb.modifiers[0].damageType).toBe('lightning');
  });
});
