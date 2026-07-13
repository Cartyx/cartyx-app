import { describe, it, expect, vi } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useAoeTool } from '~/components/mainview/tabletop/useAoeTool';

const domToImage = (x: number, y: number) => ({ x, y });

const pointerEvt = (x: number, y: number) =>
  ({ clientX: x, clientY: y }) as unknown as ReactPointerEvent<HTMLDivElement>;

const pressEscape = (target?: EventTarget) => {
  const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  (target ?? window).dispatchEvent(evt);
};

const baseOpts = (overrides: Partial<Parameters<typeof useAoeTool>[0]> = {}) => ({
  aoeActive: true,
  shape: 'sphere' as const,
  sizeFt: 20,
  widthFt: 5,
  color: '#ff2d55',
  domToImage,
  pixelsPerSquare: 50,
  feetPerSquare: 5,
  imageWidth: 1000,
  imageHeight: 1000,
  onCommit: vi.fn(),
  ...overrides,
});

describe('useAoeTool', () => {
  it('sphere (radial) commits immediately on the first click', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useAoeTool(baseOpts({ shape: 'sphere', onCommit })));

    act(() => result.current.onPointerDown(pointerEvt(100, 120)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    const aoe = onCommit.mock.calls[0]![0];
    expect(aoe.shape).toBe('sphere');
    expect(aoe.originX).toBe(100);
    expect(aoe.originY).toBe(120);
    // feetToPixels(20, { pixelsPerSquare: 50, feetPerSquare: 5 }) = (20/5)*50 = 200
    expect(aoe.sizePx).toBe(200);
    expect(result.current.preview).toBeNull();
  });

  it('cone (directional) sets a preview on the first click, aims on move, commits on the second click', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useAoeTool(baseOpts({ shape: 'cone', onCommit })));

    act(() => result.current.onPointerDown(pointerEvt(100, 100)));
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.preview).not.toBeNull();
    expect(result.current.preview?.originX).toBe(100);
    expect(result.current.preview?.originY).toBe(100);

    act(() => result.current.onPointerMove(pointerEvt(100, 200)));
    // origin (100,100) -> cursor (100,200): atan2(100, 0) = PI/2
    expect(result.current.preview?.rotation).toBeCloseTo(Math.PI / 2);

    act(() => result.current.onPointerDown(pointerEvt(100, 200)));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const aoe = onCommit.mock.calls[0]![0];
    expect(aoe.originX).toBe(100);
    expect(aoe.originY).toBe(100);
    expect(aoe.rotation).toBeCloseTo(Math.PI / 2);
    expect(result.current.preview).toBeNull();
  });

  it('Esc after the first cone click clears the preview without committing', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useAoeTool(baseOpts({ shape: 'cone', onCommit })));

    act(() => result.current.onPointerDown(pointerEvt(100, 100)));
    expect(result.current.preview).not.toBeNull();

    act(() => pressEscape());

    expect(result.current.preview).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
