import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AoeSettingsPanel } from '~/components/mainview/tabletop/AoeSettingsPanel';
import type { AoeShape } from '~/types/mapAoe';

const SHAPES: AoeShape[] = ['sphere', 'cone', 'cube', 'line', 'cylinder'];

function renderPanel(props: Partial<React.ComponentProps<typeof AoeSettingsPanel>> = {}) {
  const defaults: React.ComponentProps<typeof AoeSettingsPanel> = {
    shape: 'sphere',
    onShape: vi.fn(),
    sizeFt: 20,
    onSizeFt: vi.fn(),
    widthFt: 5,
    onWidthFt: vi.fn(),
    color: '#e74c3c',
    onColor: vi.fn(),
    onClearAll: vi.fn(),
    canClearAll: false,
  };
  return render(<AoeSettingsPanel {...defaults} {...props} />);
}

describe('AoeSettingsPanel', () => {
  it('renders the root panel', () => {
    renderPanel();
    expect(screen.getByTestId('aoe-settings-panel')).toBeInTheDocument();
  });

  it('renders all five shape buttons', () => {
    renderPanel();
    for (const shape of SHAPES) {
      expect(screen.getByTestId(`aoe-shape-${shape}`)).toBeInTheDocument();
    }
  });

  it('highlights the active shape', () => {
    renderPanel({ shape: 'cone' });
    expect(screen.getByTestId('aoe-shape-cone')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('aoe-shape-sphere')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onShape when a shape button is clicked', async () => {
    const user = userEvent.setup();
    const onShape = vi.fn();
    renderPanel({ onShape });
    await user.click(screen.getByTestId('aoe-shape-cube'));
    expect(onShape).toHaveBeenCalledWith('cube');
  });

  it('binds the Size (ft) input to sizeFt/onSizeFt', async () => {
    const onSizeFt = vi.fn();
    renderPanel({ sizeFt: 15, onSizeFt });
    const input = screen.getByTestId('aoe-size-input') as HTMLInputElement;
    expect(input.value).toBe('15');
  });

  it('hides the Width (ft) field unless shape is line', () => {
    renderPanel({ shape: 'sphere' });
    expect(screen.queryByTestId('aoe-width-input')).not.toBeInTheDocument();
  });

  it('shows the Width (ft) field when shape is line', () => {
    renderPanel({ shape: 'line', widthFt: 10 });
    const input = screen.getByTestId('aoe-width-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('10');
  });

  it('hides the Clear all AoE button when canClearAll is false', () => {
    renderPanel({ canClearAll: false });
    expect(screen.queryByTestId('aoe-clear-all')).not.toBeInTheDocument();
  });

  it('shows the Clear all AoE button and calls onClearAll when canClearAll is true', async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    renderPanel({ canClearAll: true, onClearAll });
    const button = screen.getByTestId('aoe-clear-all');
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
