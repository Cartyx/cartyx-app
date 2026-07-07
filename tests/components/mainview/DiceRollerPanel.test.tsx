import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiceRollerPanel } from '~/components/mainview/DiceRollerPanel';
import { onDiceBroadcastRequest, reportDiceDelivery } from '~/utils/diceRollerBridge';

describe('DiceRollerPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all seven dice and disables Roll while the pool is empty', () => {
    render(<DiceRollerPanel />);
    for (const sides of [100, 20, 12, 10, 8, 6, 4]) {
      expect(screen.getByTestId(`dice-roller-die-${sides}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('dice-roller-roll')).toBeDisabled();
  });

  it('queues dice with count badges and clears them with Reset', async () => {
    const user = userEvent.setup();
    render(<DiceRollerPanel />);
    await user.click(screen.getByTestId('dice-roller-die-6'));
    await user.click(screen.getByTestId('dice-roller-die-6'));
    await user.click(screen.getByTestId('dice-roller-die-8'));
    expect(screen.getByTestId('dice-roller-count-6')).toHaveTextContent('2');
    expect(screen.getByTestId('dice-roller-count-8')).toHaveTextContent('1');
    expect(screen.getByTestId('dice-roller-roll')).toBeEnabled();

    // Badge click removes one die of that type
    await user.click(screen.getByTestId('dice-roller-count-6'));
    expect(screen.getByTestId('dice-roller-count-6')).toHaveTextContent('1');

    await user.click(screen.getByTestId('dice-roller-reset'));
    expect(screen.queryByTestId('dice-roller-count-6')).not.toBeInTheDocument();
    expect(screen.getByTestId('dice-roller-roll')).toBeDisabled();
  });

  it('steps and clamps the modifier', async () => {
    const user = userEvent.setup();
    render(<DiceRollerPanel />);
    await user.click(screen.getByTestId('dice-roller-modifier-inc'));
    await user.click(screen.getByTestId('dice-roller-modifier-inc'));
    expect(screen.getByTestId('dice-roller-modifier-value')).toHaveTextContent('+2');
    for (let i = 0; i < 5; i++) await user.click(screen.getByTestId('dice-roller-modifier-dec'));
    expect(screen.getByTestId('dice-roller-modifier-value')).toHaveTextContent('-3');
  });

  it('shows the result with every die value after a private roll and does not broadcast', async () => {
    const user = userEvent.setup();
    const broadcasts = vi.fn();
    const unsubscribe = onDiceBroadcastRequest(broadcasts);
    // 3d6 -> deterministic values 3, 3, 3: the no-rng path is rejection
    // sampling + modulo, so 2^31 % 6 = 2 -> die value 3.
    const cryptoSpy = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
        if (buf instanceof Uint32Array) buf[0] = 2147483648;
        return buf;
      });

    render(<DiceRollerPanel />);
    await user.click(screen.getByTestId('dice-roller-privacy-private'));
    for (let i = 0; i < 3; i++) await user.click(screen.getByTestId('dice-roller-die-6'));
    await user.click(screen.getByTestId('dice-roller-roll'));

    const result = screen.getByTestId('dice-roller-result');
    expect(result).toHaveTextContent('3d6');
    expect(result).toHaveTextContent('(3 + 3 + 3)');
    expect(broadcasts).not.toHaveBeenCalled();

    cryptoSpy.mockRestore();
    unsubscribe();
  });

  it('broadcasts public rolls and shows a notice when delivery fails', async () => {
    const user = userEvent.setup();
    let captured: { requestId: string } | null = null;
    const unsubscribe = onDiceBroadcastRequest((d) => {
      captured = d;
    });

    render(<DiceRollerPanel />);
    // Public is the default — no privacy click needed
    await user.click(screen.getByTestId('dice-roller-die-20'));
    await user.click(screen.getByTestId('dice-roller-roll'));

    expect(captured).not.toBeNull();
    expect(screen.queryByTestId('dice-roller-notice')).not.toBeInTheDocument();

    reportDiceDelivery({ requestId: captured!.requestId, delivered: false });
    expect(await screen.findByTestId('dice-roller-notice')).toHaveTextContent(/not connected/i);
    unsubscribe();
  });
});
