import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MasterBar } from '~/components/soundboard/MasterBar';

describe('MasterBar', () => {
  it('renders the master volume', () => {
    render(
      <MasterBar
        masterVolume={0.6}
        onMasterVolumeChange={vi.fn()}
        onStopAll={vi.fn()}
        playingCount={0}
      />
    );
    expect(screen.getByRole('slider', { name: /master volume/i })).toHaveValue('0.6');
  });

  it('dragging the master slider calls onMasterVolumeChange with the new value', () => {
    const onMasterVolumeChange = vi.fn();
    render(
      <MasterBar
        masterVolume={0.6}
        onMasterVolumeChange={onMasterVolumeChange}
        onStopAll={vi.fn()}
        playingCount={0}
      />
    );
    fireEvent.change(screen.getByRole('slider', { name: /master volume/i }), {
      target: { value: '0.2' },
    });
    expect(onMasterVolumeChange).toHaveBeenCalledWith(0.2);
  });

  it('shows "Nothing playing" and disables Stop All when nothing is playing', () => {
    render(
      <MasterBar
        masterVolume={1}
        onMasterVolumeChange={vi.fn()}
        onStopAll={vi.fn()}
        playingCount={0}
      />
    );
    expect(screen.getByTestId('playing-count')).toHaveTextContent('Nothing playing');
    expect(screen.getByRole('button', { name: /stop all/i })).toBeDisabled();
  });

  it('shows the playing count and enables Stop All when something is playing', () => {
    render(
      <MasterBar
        masterVolume={1}
        onMasterVolumeChange={vi.fn()}
        onStopAll={vi.fn()}
        playingCount={3}
      />
    );
    expect(screen.getByTestId('playing-count')).toHaveTextContent('3 playing');
    expect(screen.getByRole('button', { name: /stop all/i })).not.toBeDisabled();
  });

  it('clicking Stop All calls onStopAll', async () => {
    const user = userEvent.setup();
    const onStopAll = vi.fn();
    render(
      <MasterBar
        masterVolume={1}
        onMasterVolumeChange={vi.fn()}
        onStopAll={onStopAll}
        playingCount={2}
      />
    );
    await user.click(screen.getByRole('button', { name: /stop all/i }));
    expect(onStopAll).toHaveBeenCalledTimes(1);
  });
});
