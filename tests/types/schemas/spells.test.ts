import { describe, it, expect } from 'vitest';
import { createSpellSchema, listSpellsSchema, updateSpellSchema } from '~/types/schemas/spells';

const validSpell = {
  campaignId: 'c1',
  name: 'Fire Bolt',
  description: 'You hurl a mote of fire.',
  level: 0,
  school: 'evocation',
  castingTime: { value: 1, unit: 'action' },
  components: { verbal: true, somatic: true, material: false },
  range: { type: 'ranged', distance: 120 },
  duration: { type: 'instantaneous', concentration: false },
};

describe('createSpellSchema', () => {
  it('accepts a valid spell and applies array defaults', () => {
    const parsed = createSpellSchema.parse(validSpell);
    expect(parsed.modifiers).toEqual([]);
    expect(parsed.classes).toEqual([]);
    expect(parsed.ritual).toBe(false);
    expect(parsed.areaOfEffect).toEqual({ shape: 'none' });
  });

  it('rejects a missing name', () => {
    expect(() => createSpellSchema.parse({ ...validSpell, name: '' })).toThrow();
  });

  it('rejects an invalid school', () => {
    expect(() => createSpellSchema.parse({ ...validSpell, school: 'wizardry' })).toThrow();
  });

  it('rejects level above 9', () => {
    expect(() => createSpellSchema.parse({ ...validSpell, level: 10 })).toThrow();
  });
});

describe('updateSpellSchema', () => {
  it('requires id field', () => {
    expect(() => updateSpellSchema.parse({ ...validSpell })).toThrow();
  });

  it('accepts a valid spell with id', () => {
    const parsed = updateSpellSchema.parse({ ...validSpell, id: 's1' });
    expect(parsed.id).toBe('s1');
  });
});

describe('listSpellsSchema', () => {
  it('accepts optional level/school filters', () => {
    const parsed = listSpellsSchema.parse({ campaignId: 'c1', level: 3, school: 'evocation' });
    expect(parsed.level).toBe(3);
  });
});

describe('modifiers with scaling', () => {
  it('accepts a damage modifier with scaling', () => {
    const parsed = createSpellSchema.parse({
      ...validSpell,
      modifiers: [
        {
          id: 'm0',
          type: 'damage',
          dice: { count: 8, sides: 6 },
          scaling: { perStep: { count: 1, sides: 6 } },
        },
      ],
    });
    expect(parsed.modifiers[0].scaling).toEqual({ perStep: { count: 1, sides: 6 } });
  });
});
