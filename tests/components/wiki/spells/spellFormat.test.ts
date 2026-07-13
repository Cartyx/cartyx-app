import { describe, it, expect } from 'vitest';
import {
  formatRange,
  formatDuration,
  formatComponents,
  formatDamageEffect,
} from '~/components/wiki/spells/spellFormat';
import type { SpellData } from '~/types/spell';

describe('spell display formatters', () => {
  it('formats ranged distance', () => {
    expect(formatRange({ type: 'ranged', distance: 120 })).toBe('120 ft.');
    expect(formatRange({ type: 'self' })).toBe('Self');
  });

  it('formats concentration duration', () => {
    expect(
      formatDuration({ type: 'concentration', value: 10, unit: 'minute', concentration: true })
    ).toBe('Concentration, up to 10 minutes');
    expect(formatDuration({ type: 'instantaneous', concentration: false })).toBe('Instantaneous');
  });

  it('joins components', () => {
    expect(formatComponents({ verbal: true, somatic: true, material: false })).toBe('V, S');
  });

  it('derives damage/effect from modifiers', () => {
    const spell = { modifiers: [{ id: 'm', type: 'damage', damageType: 'fire' }] } as SpellData;
    expect(formatDamageEffect(spell)).toBe('Fire');
  });
});
