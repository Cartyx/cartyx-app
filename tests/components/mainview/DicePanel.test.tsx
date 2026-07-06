import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiceRollCard } from '~/components/mainview/DicePanel';
import type { DiceRollMessage } from '~/hooks/useDiceRolls';

function makeRoll(overrides: Partial<DiceRollMessage>): DiceRollMessage {
  return {
    id: 'm1',
    seq: 1,
    sessionId: 's1',
    campaignId: 'c1',
    channel: 'general',
    character: 'Tester',
    title: '3d6 + 3',
    rollType: 'custom',
    attackRolls: [],
    damageRolls: [],
    totalDamages: {},
    rollInfo: [],
    description: '',
    timestamp: 1720000000000,
    ...overrides,
  };
}

describe('DiceRollCard', () => {
  it('labels custom rolls "Result" and lists every die value', () => {
    render(
      <DiceRollCard
        roll={makeRoll({
          attackRolls: [
            {
              roll: 16,
              type: 'hit',
              total: 16,
              formula: '3d6 + 3',
              discarded: false,
              dice: [4, 3, 6],
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.queryByText(/To Hit/)).not.toBeInTheDocument();
    expect(screen.getByText(/\(4 \+ 3 \+ 6\)/)).toBeInTheDocument();
  });

  it('keeps Beyond20 rolls unchanged: "To Hit" label and first-die-only breakdown', () => {
    render(
      <DiceRollCard
        roll={makeRoll({
          rollType: 'to-hit',
          attackRolls: [
            {
              roll: 20,
              type: 'hit',
              total: 20,
              formula: '1d20 + 3',
              discarded: false,
              dice: [17],
            },
          ],
        })}
      />
    );
    expect(screen.getByText(/To Hit/)).toBeInTheDocument();
    expect(screen.getByText(/\(17\)/)).toBeInTheDocument();
  });

  it('shows the ADV badge and strikes through the discarded custom set', () => {
    render(
      <DiceRollCard
        roll={makeRoll({
          rollInfo: [['Mode', 'Advantage']],
          attackRolls: [
            { roll: 5, type: 'hit', total: 5, formula: '1d20', discarded: true, dice: [5] },
            { roll: 15, type: 'hit', total: 15, formula: '1d20', discarded: false, dice: [15] },
          ],
        })}
      />
    );
    expect(screen.getByText('ADV')).toBeInTheDocument();
    expect(screen.getByText('Mode: Advantage')).toBeInTheDocument();
    expect(screen.getByText('5')).toHaveClass('line-through');
  });
});
