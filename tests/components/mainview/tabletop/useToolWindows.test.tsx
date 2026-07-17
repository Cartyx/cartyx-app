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

/**
 * Regression harness for a window id that is open but never mounts a
 * ToolWindow — the real-world case is a tabletop screen with no active map,
 * where drawing/text/ruler windows never render (they live inside
 * ActiveMapStage). `elsRef` in the hook never gets an entry for `id`, so the
 * measure/place effect must not spin.
 */
function NoMountHarness({
  open,
  onClose,
  onRender,
}: {
  open: ToolWindowId[];
  onClose: (id: ToolWindowId) => void;
  onRender: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  onRender();
  // Intentionally never render a ToolWindow for `open` — simulates the
  // no-map screen where the window id has no mounted element.
  useToolWindows(open, ref, onClose);
  return <div ref={ref} style={{ width: 1200, height: 800, position: 'relative' }} />;
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

  it('remembers a dragged position and restores it when the window is reopened', async () => {
    const { rerender } = render(<Harness open={['dice']} onClose={() => {}} />);
    const win = screen.getByTestId('tool-window-dice');
    await waitFor(() => expect(win.style.visibility).toBe('visible'));

    // Drag the header away from the origin slot.
    fireEvent.pointerDown(screen.getByTestId('tool-window-dice-header'));
    fireEvent.pointerMove(window, { clientX: 140, clientY: 90 });
    fireEvent.pointerUp(window);

    const movedLeft = win.style.left;
    const movedTop = win.style.top;
    expect(movedLeft).not.toBe('12px'); // actually moved off the origin

    // Close, then reopen — it should return to where it was dragged, not
    // re-cascade to the origin.
    rerender(<Harness open={[]} onClose={() => {}} />);
    rerender(<Harness open={['dice']} onClose={() => {}} />);

    const reopened = screen.getByTestId('tool-window-dice');
    await waitFor(() => expect(reopened.style.visibility).toBe('visible'));
    expect(reopened.style.left).toBe(movedLeft);
    expect(reopened.style.top).toBe(movedTop);
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
    fireEvent.pointerDown(dice);
    // Compare live values — focus() renumbers the whole band on every call
    // (see the z-band normalization test below), so `layer`'s zIndex may
    // itself shift when `dice` is promoted; what matters is the relative
    // order at the moment of assertion.
    await waitFor(() =>
      expect(Number(dice.style.zIndex)).toBeGreaterThan(Number(layer.style.zIndex))
    );
  });

  it('keeps focus z-index normalized below the modal band (50) across many alternating focuses', async () => {
    render(<Harness open={['dice', 'layer']} onClose={() => {}} />);
    const dice = screen.getByTestId('tool-window-dice');
    const layer = screen.getByTestId('tool-window-layer');
    await waitFor(() => expect(layer.style.visibility).toBe('visible'));

    for (let i = 0; i < 20; i++) {
      fireEvent.pointerDown(i % 2 === 0 ? dice : layer);
      const top = i % 2 === 0 ? dice : layer;
      const other = i % 2 === 0 ? layer : dice;
      await waitFor(() =>
        expect(Number(top.style.zIndex)).toBeGreaterThan(Number(other.style.zIndex))
      );
    }

    expect(Number(dice.style.zIndex)).toBeLessThan(50);
    expect(Number(layer.style.zIndex)).toBeLessThan(50);
  });

  it('does not loop when an open window id never mounts an element (no map on screen)', async () => {
    const renderCountRef = { current: 0 };
    render(
      <NoMountHarness
        open={['text']}
        onClose={() => {}}
        onRender={() => {
          renderCountRef.current += 1;
        }}
      />
    );

    // Give the buggy version room to spin: if the measure/place effect churns
    // state every pass, the harness will re-render far more than a handful
    // of times within this window.
    await waitFor(
      () => {
        expect(renderCountRef.current).toBeLessThan(10);
      },
      { timeout: 2000, interval: 20 }
    );

    // Settle further and confirm it really stopped, not just slowed down.
    const countAfterFirstCheck = renderCountRef.current;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(renderCountRef.current).toBe(countAfterFirstCheck);
  }, 5000);
});
