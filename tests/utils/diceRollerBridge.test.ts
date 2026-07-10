import { describe, it, expect, vi } from 'vitest';
import {
  onDiceBroadcastRequest,
  onDiceDelivery,
  reportDiceDelivery,
  requestDiceBroadcast,
  type DiceBroadcastRequest,
} from '~/utils/diceRollerBridge';

const roll: DiceBroadcastRequest['roll'] = {
  character: '',
  title: '1d20',
  rollType: 'custom',
  attackRolls: [
    { roll: 11, type: 'hit', total: 11, formula: '1d20', discarded: false, dice: [11] },
  ],
  damageRolls: [],
  totalDamages: {},
  rollInfo: [],
  description: '',
  channel: 'general',
};

describe('diceRollerBridge', () => {
  it('delivers broadcast requests to subscribers', () => {
    const cb = vi.fn();
    const unsubscribe = onDiceBroadcastRequest(cb);
    requestDiceBroadcast({ requestId: 'r1', roll });
    expect(cb).toHaveBeenCalledExactlyOnceWith({ requestId: 'r1', roll });
    unsubscribe();
  });

  it('stops delivering after unsubscribe', () => {
    const cb = vi.fn();
    const unsubscribe = onDiceBroadcastRequest(cb);
    unsubscribe();
    requestDiceBroadcast({ requestId: 'r2', roll });
    expect(cb).not.toHaveBeenCalled();
  });

  it('delivers delivery reports to subscribers', () => {
    const cb = vi.fn();
    const unsubscribe = onDiceDelivery(cb);
    reportDiceDelivery({ requestId: 'r3', delivered: false });
    expect(cb).toHaveBeenCalledExactlyOnceWith({ requestId: 'r3', delivered: false });
    unsubscribe();
  });
});
