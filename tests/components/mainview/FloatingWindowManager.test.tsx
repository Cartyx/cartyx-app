import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FloatingWindowManager,
  type ManagedWindow,
} from '~/components/mainview/FloatingWindowManager';

const baseWindows: ManagedWindow[] = [
  {
    id: 'map',
    title: 'Map',
    content: <div>Map content</div>,
    position: { x: 40, y: 40 },
    size: { width: 320, height: 220 },
    state: 'normal',
    zIndex: 1,
  },
  {
    id: 'notes',
    title: 'Notes',
    content: <div>Notes content</div>,
    position: { x: 160, y: 120 },
    size: { width: 320, height: 220 },
    state: 'normal',
    zIndex: 2,
  },
  {
    id: 'wiki',
    title: 'Wiki',
    content: <div>Wiki content</div>,
    state: 'minimized',
    zIndex: 3,
  },
];

function ControlledManager({
  initialWindows = baseWindows,
  onWindowsChange,
}: {
  initialWindows?: ManagedWindow[];
  onWindowsChange?: (windows: ManagedWindow[]) => void;
}) {
  const [windows, setWindows] = useState(initialWindows);

  return (
    <div className="relative h-[600px] w-[800px]">
      <FloatingWindowManager
        windows={windows}
        onWindowsChange={(nextWindows) => {
          setWindows(nextWindows);
          onWindowsChange?.(nextWindows);
        }}
      />
    </div>
  );
}

describe('FloatingWindowManager', () => {
  it('renders all non-minimized windows', () => {
    render(<ControlledManager />);

    expect(screen.getByRole('dialog', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Wiki' })).not.toBeInTheDocument();
  });

  it('minimized windows appear in the tray', () => {
    render(<ControlledManager />);

    expect(screen.getByRole('button', { name: 'Restore Wiki' })).toBeInTheDocument();
  });

  it('tray re-enables pointer events inside the pointer-events-none wrapper', () => {
    // The manager wrapper is pointer-events-none so clicks pass through to
    // content below (e.g. the active map). FloatingWindow opts back in with
    // pointer-events-auto; the tray must do the same or its restore buttons
    // are unclickable (regression: minimized windows could not be restored).
    render(<ControlledManager />);

    const tray = screen.getByRole('toolbar', { name: 'Minimized windows' });
    expect(tray.className).toContain('pointer-events-auto');
  });

  it('closing a window calls onWindowsChange without that window', async () => {
    const user = userEvent.setup();
    const onWindowsChange = vi.fn();

    render(<ControlledManager onWindowsChange={onWindowsChange} />);

    await user.click(screen.getByRole('button', { name: 'Close Notes' }));

    const latestCall = onWindowsChange.mock.calls.at(-1)?.[0] as ManagedWindow[] | undefined;

    expect(latestCall?.map((window) => window.id)).toEqual(['map', 'wiki']);
  });

  it('renders active (non-minimized) windows as dialogs', async () => {
    render(<ControlledManager />);

    // Two non-minimized windows should be in the document
    expect(screen.getByRole('dialog', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Notes' })).toBeInTheDocument();
  });

  it('passes titleIcon to the FloatingWindow', () => {
    const windows: ManagedWindow[] = [
      {
        id: 'rule-1',
        title: 'Difficulty',
        titleIcon: <span data-testid="rule-icon">icon</span>,
        content: <div>Rule content</div>,
        position: { x: 10, y: 10 },
        size: { width: 300, height: 200 },
        state: 'normal',
        zIndex: 1,
      },
    ];

    render(
      <div className="relative h-[600px] w-[800px]">
        <FloatingWindowManager windows={windows} onWindowsChange={vi.fn()} />
      </div>
    );

    expect(screen.getByTestId('rule-icon')).toBeInTheDocument();
  });

  it('focusing a window brings it to the highest zIndex', async () => {
    const user = userEvent.setup();

    render(<ControlledManager />);

    const mapWindow = screen.getByRole('dialog', { name: 'Map' });
    const notesWindow = screen.getByRole('dialog', { name: 'Notes' });

    expect(mapWindow).toHaveStyle({ zIndex: '1' });
    expect(notesWindow).toHaveStyle({ zIndex: '2' });

    await user.click(mapWindow);

    // After normalization: windows re-ranked 1..n, map brought to top
    // map was lowest (1), notes was middle (2), wiki minimized (3)
    // normalized: map=3 (top), notes=1 or 2, wiki=1 or 2
    const mapZIndex = Number(mapWindow.style.zIndex);
    const notesZIndex = Number(notesWindow.style.zIndex);
    expect(mapZIndex).toBeGreaterThan(notesZIndex);
  });
});
