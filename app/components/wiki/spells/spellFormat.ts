import type { SpellData } from '~/types/spell';

export function formatCastingTime(ct: SpellData['castingTime']): string {
  const unitLabel: Record<string, string> = {
    action: 'Action',
    bonus: 'Bonus Action',
    reaction: 'Reaction',
    minute: 'Minute',
    hour: 'Hour',
  };
  const label = unitLabel[ct.unit] ?? ct.unit;
  const plural = ct.value !== 1 && (ct.unit === 'minute' || ct.unit === 'hour') ? 's' : '';
  if (ct.unit === 'action' || ct.unit === 'bonus' || ct.unit === 'reaction') {
    return ct.value <= 1 ? `1 ${label}` : `${ct.value} ${label}s`;
  }
  return `${ct.value} ${label}${plural}`;
}

export function formatRange(range: SpellData['range']): string {
  switch (range.type) {
    case 'self':
      return 'Self';
    case 'touch':
      return 'Touch';
    case 'sight':
      return 'Sight';
    case 'unlimited':
      return 'Unlimited';
    case 'ranged':
      return range.distance != null ? `${range.distance} ft.` : 'Ranged';
    default:
      return 'Self';
  }
}

export function formatDuration(d: SpellData['duration']): string {
  if (d.type === 'instantaneous') return 'Instantaneous';
  if (d.type === 'until-dispelled') return 'Until Dispelled';
  if (d.type === 'special') return 'Special';
  const unit = d.unit ?? 'round';
  const plural = (d.value ?? 0) !== 1 ? 's' : '';
  const body = d.value != null ? `${d.value} ${unit}${plural}` : unit;
  return d.concentration || d.type === 'concentration' ? `Concentration, up to ${body}` : body;
}

export function formatComponents(c: SpellData['components']): string {
  const parts: string[] = [];
  if (c.verbal) parts.push('V');
  if (c.somatic) parts.push('S');
  if (c.material) parts.push('M');
  return parts.join(', ') || '—';
}

export function formatAttackSave(a: SpellData['attackSave']): string {
  if (a.kind === 'attack') {
    return a.attackType === 'melee' ? 'Melee' : 'Ranged';
  }
  if (a.kind === 'save' && a.saveAbility) {
    return a.saveAbility.toUpperCase();
  }
  return '—';
}

export function formatDamageEffect(spell: SpellData): string {
  const damage = spell.modifiers.find((m) => m.type === 'damage' && m.damageType);
  if (damage?.damageType) {
    return damage.damageType.charAt(0).toUpperCase() + damage.damageType.slice(1);
  }
  const healing = spell.modifiers.find((m) => m.type === 'healing');
  if (healing) return 'Healing';
  return '—';
}
