import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dices } from 'lucide-react';
import { ToolWindow } from '~/components/mainview/tabletop/ToolWindow';
import { useToolWindows } from '~/components/mainview/tabletop/useToolWindows';
import type { ToolWindowId } from '~/components/mainview/tabletop/toolWindowState';

function Harness({ open, onClose }: { open: ToolWindowId[]; onClose: (id: ToolWindowId) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const manager = useToolWindows(open, ref, onClose);
  return (
    <div ref={ref} style={{ width: 1200, height: 800, position: 'relative' }}>
      {open.map((id) => (
        <ToolWindow key={id} title={id} icon={Dices} {...manager.getWindowProps(id)}>
          <div style={{ width: 240, height: 100 }} />
        </ToolWindow>
      ))}
    </div>
  );
}

describe('useToolWindows', () => {
  it('marks a newly opened window as placed (visible) after measure', async () => {
    render(<Harness open={['dice']} onClose={() => {}} />);
    const win = screen.getByTestId('tool-window-dice');
    await waitFor(() => expect(win.style.visibility).toBe('visible'));
    // happy-dom measures 0×0; placement still lands on the origin slot.
    expect(win.style.left).toBe('12px');
    expect(win.style.top).toBe('12px');
  });

  it('routes the close button to onCloseWindow', async () => {
    const onClose = vi.fn();
    render(<Harness open={['dice']} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tool-window-dice-close'));
    expect(onClose).toHaveBeenCalledWith('dice');
  });

  it('focusing a window raises it above the others', async () => {
    render(<Harness open={['dice', 'layer']} onClose={() => {}} />);
    const dice = screen.getByTestId('tool-window-dice');
    const layer = screen.getByTestId('tool-window-layer');
    await waitFor(() => expect(layer.style.visibility).toBe('visible'));
    const layerZ = Number(layer.style.zIndex);
    fireEvent.pointerDown(dice);
    await waitFor(() => expect(Number(dice.style.zIndex)).toBeGreaterThan(layerZ));
  });
});
