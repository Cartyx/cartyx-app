import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('~/utils/diceRollerBridge', () => ({ requestDiceBroadcast: vi.fn() }));

import { requestDiceBroadcast } from '~/utils/diceRollerBridge';
import { SpellWindow } from '~/components/wiki/spells/SpellWindow';
import type { SpellData } from '~/types/spell';

const mockRequestDiceBroadcast = vi.mocked(requestDiceBroadcast);

function fireball(): SpellData {
  return {
    id: 's',
    campaignId: 'c',
    createdBy: 'u',
    source: 'srd',
    name: 'Fireball',
    description: 'A bright streak.',
    level: 3,
    school: 'evocation',
    castingTime: { value: 1, unit: 'action' },
    components: { verbal: true, somatic: true, material: false },
    range: { type: 'ranged', distance: 150 },
    duration: { type: 'instantaneous', concentration: false },
    ritual: false,
    higherLevelScaling: { enabled: true, type: 'spell-scale' },
    classes: ['Wizard'],
    attackSave: { kind: 'save', saveAbility: 'dex' },
    modifiers: [
      {
        id: 'm0',
        type: 'damage',
        dice: { count: 8, sides: 6 },
        damageType: 'fire',
        scaling: { perStep: { count: 1, sides: 6 } },
      },
    ],
    conditions: [],
    higherLevels: [],
    areaOfEffect: { shape: 'sphere', size: 20 },
    tags: [],
    canEdit: false,
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('SpellWindow roll chips', () => {
  it('rolls base dice and broadcasts', async () => {
    const user = userEvent.setup();
    render(<SpellWindow spell={fireball()} />);
    expect(screen.getByTestId('roll-m0')).toHaveTextContent('8d6 fire');
    await user.click(screen.getByTestId('roll-m0'));
    expect(mockRequestDiceBroadcast).toHaveBeenCalledTimes(1);
    expect(mockRequestDiceBroadcast.mock.calls[0][0].roll.title).toBe('Fireball · Fire');
  });

  it('shows the roll result locally (independent of the session broadcast)', async () => {
    const user = userEvent.setup();
    render(<SpellWindow spell={fireball()} />);
    // No result before rolling.
    expect(screen.queryByTestId('spell-roll-result')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('roll-m0'));
    // A local result appears with the spell title and a numeric total, even
    // though no active session/socket exists in this test.
    const result = screen.getByTestId('spell-roll-result');
    expect(result).toHaveTextContent('Fireball · Fire');
    expect(result.textContent).toMatch(/\d+/);
  });

  it('scales the chip when the slot level changes', async () => {
    const user = userEvent.setup();
    render(<SpellWindow spell={fireball()} />);
    await user.selectOptions(screen.getByRole('combobox'), '5');
    expect(screen.getByTestId('roll-m0')).toHaveTextContent('10d6 fire');
  });
});
