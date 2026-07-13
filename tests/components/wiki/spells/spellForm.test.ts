import { describe, it, expect } from 'vitest';
import { EMPTY_SPELL_FORM, formToInput, spellToForm } from '~/components/wiki/spells/spellForm';
import { createSpellSchema, updateSpellSchema } from '~/types/schemas/spells';
import type { SpellData } from '~/types/spell';

describe('formToInput', () => {
  it('produces a create payload that satisfies createSpellSchema', () => {
    const form = {
      ...EMPTY_SPELL_FORM,
      name: 'Fire Bolt',
      description: 'A mote of fire.',
      rangeType: 'ranged' as const,
      rangeDistance: '120',
      verbal: true,
      somatic: true,
    };
    const input = formToInput(form, 'c1');
    expect(() => createSpellSchema.parse(input)).not.toThrow();
    expect((input as { range: { distance: number } }).range.distance).toBe(120);
  });

  it('produces an update payload with id that satisfies updateSpellSchema', () => {
    const form = { ...EMPTY_SPELL_FORM, name: 'X', description: 'Y' };
    const input = formToInput(form, 'c1', 'spell1');
    expect(() => updateSpellSchema.parse(input)).not.toThrow();
  });

  it('round-trips a spell through spellToForm -> formToInput', () => {
    const spell = {
      id: 's1',
      campaignId: 'c1',
      createdBy: 'u1',
      source: 'homebrew',
      name: 'Fireball',
      description: 'Boom',
      level: 3,
      school: 'evocation',
      castingTime: { value: 1, unit: 'action' },
      components: { verbal: true, somatic: true, material: true, materialDescription: 'bat guano' },
      range: { type: 'ranged', distance: 150 },
      duration: { type: 'instantaneous', concentration: false },
      ritual: false,
      higherLevelScaling: { enabled: true, type: 'spell-scale' },
      classes: ['Wizard'],
      attackSave: { kind: 'save', saveAbility: 'dex' },
      modifiers: [{ id: 'm1', type: 'damage', dice: { count: 8, sides: 6 }, damageType: 'fire' }],
      conditions: [],
      higherLevels: [],
      areaOfEffect: { shape: 'sphere', size: 20 },
      tags: ['fire'],
      canEdit: true,
      createdAt: '',
      updatedAt: '',
    } as SpellData;
    const input = formToInput(spellToForm(spell), 'c1');
    const parsed = createSpellSchema.parse(input);
    expect(parsed.level).toBe(3);
    expect(parsed.areaOfEffect).toEqual({ shape: 'sphere', size: 20 });
    expect(parsed.attackSave.saveAbility).toBe('dex');
  });
});
