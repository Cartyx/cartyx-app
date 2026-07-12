import { describe, it, expect } from 'vitest';
import { SPELL_SCHOOLS, formatSpellLevel, formatSchool } from './spells';

describe('spell constants', () => {
  it('has the eight schools of magic', () => {
    expect(SPELL_SCHOOLS).toHaveLength(8);
    expect(SPELL_SCHOOLS).toContain('evocation');
  });

  it('formats level 0 as Cantrip', () => {
    expect(formatSpellLevel(0)).toBe('Cantrip');
    expect(formatSpellLevel(1)).toBe('1st');
    expect(formatSpellLevel(3)).toBe('3rd');
    expect(formatSpellLevel(9)).toBe('9th');
  });

  it('title-cases a school', () => {
    expect(formatSchool('evocation')).toBe('Evocation');
  });
});
