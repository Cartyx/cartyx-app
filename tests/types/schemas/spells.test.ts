import { describe, it, expect } from 'vitest';
import { createSpellSchema, listSpellsSchema } from '~/types/schemas/spells';

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

describe('listSpellsSchema', () => {
  it('accepts optional level/school filters', () => {
    const parsed = listSpellsSchema.parse({ campaignId: 'c1', level: 3, school: 'evocation' });
    expect(parsed.level).toBe(3);
  });
});
