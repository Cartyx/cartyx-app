import { describe, it, expect, vi } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useRulerTool } from '~/components/mainview/tabletop/useRulerTool';

// The ruler color lives on the user record via react-query + server fns; stub
// it so the hook can be exercised in isolation.
vi.mock('~/hooks/useUserPreferences', () => ({
  useRulerColor: () => ({ color: '#ff2d55', setColor: vi.fn() }),
}));

const baseOpts = {
  rulerActive: true,
  tokens: [],
  domToImage: (x: number, y: number) => ({ x, y }),
  imageOffsetX: 0,
  imageOffsetY: 0,
  effectiveScale: 1,
  pixelsPerSquare: 50,
  feetPerSquare: 5,
  imageWidth: 1000,
  imageHeight: 1000,
};

const pointerEvt = (x: number, y: number, shiftKey = false) =>
  ({ clientX: x, clientY: y, shiftKey }) as unknown as ReactPointerEvent<HTMLDivElement>;

const pressEscape = (target?: EventTarget) => {
  const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  (target ?? window).dispatchEvent(evt);
};

describe('useRulerTool — Esc cancels an in-progress measurement', () => {
  it('clears the measurement when Escape is pressed mid-draw', () => {
    const { result } = renderHook(() => useRulerTool(baseOpts));
    act(() => result.current.onBackgroundPointerDown(pointerEvt(100, 120)));
    expect(result.current.measurement).not.toBeNull();

    act(() => pressEscape());
    expect(result.current.measurement).toBeNull();
  });

  it('does nothing on Escape when no measurement is in progress', () => {
    const { result } = renderHook(() => useRulerTool(baseOpts));
    expect(result.current.measurement).toBeNull();
    act(() => pressEscape());
    expect(result.current.measurement).toBeNull();
  });

  it('ignores Escape fired from a text field so it does not fight form inputs', () => {
    const { result } = renderHook(() => useRulerTool(baseOpts));
    act(() => result.current.onBackgroundPointerDown(pointerEvt(100, 120)));
    expect(result.current.measurement).not.toBeNull();

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => pressEscape(input));
    expect(result.current.measurement).not.toBeNull();
    input.remove();
  });
});
