import { describe, it, expect } from 'vitest';
import {
  placeToolWindow,
  TOOL_WINDOW_MARGIN,
  TOOL_WINDOW_CASCADE_STEP,
  type Rect,
} from '~/components/mainview/tabletop/placeToolWindow';

const STAGE = { width: 1200, height: 800 };
const M = TOOL_WINDOW_MARGIN; // 12
const STEP = TOOL_WINDOW_CASCADE_STEP; // 28

const rects = (n: number): Rect[] =>
  Array.from({ length: n }, (_, i) => ({
    x: M + i * STEP,
    y: M + i * STEP,
    width: 240,
    height: 300,
  }));

describe('placeToolWindow', () => {
  it('places the first window at the top-left origin', () => {
    expect(placeToolWindow({ width: 240, height: 300 }, [], STAGE)).toEqual({ x: M, y: M });
  });

  it('cascades each new window one step down and to the right', () => {
    expect(placeToolWindow({ width: 240, height: 300 }, rects(1), STAGE)).toEqual({
      x: M + STEP,
      y: M + STEP,
    });
    expect(placeToolWindow({ width: 240, height: 300 }, rects(2), STAGE)).toEqual({
      x: M + 2 * STEP,
      y: M + 2 * STEP,
    });
  });

  it('cascades by open-window count regardless of where windows were dragged', () => {
    // Two windows dragged to arbitrary spots — only the count drives the step.
    const dragged: Rect[] = [
      { x: 600, y: 400, width: 240, height: 300 },
      { x: 50, y: 700, width: 240, height: 300 },
    ];
    expect(placeToolWindow({ width: 240, height: 300 }, dragged, STAGE)).toEqual({
      x: M + 2 * STEP,
      y: M + 2 * STEP,
    });
  });

  it('wraps the cascade back to the origin before running off the stage', () => {
    // Stage that fits exactly two steps (k = 0, 1) before wrapping.
    // maxX = 300 - 12 - 240 = 48; steps = floor((48-12)/28) = 1 → period 2.
    const smallStage = { width: 300, height: 800 };
    const size = { width: 240, height: 300 };
    expect(placeToolWindow(size, rects(0), smallStage)).toEqual({ x: M, y: M });
    expect(placeToolWindow(size, rects(1), smallStage)).toEqual({ x: M + STEP, y: M + STEP });
    // Third window would overflow, so it wraps back to the origin.
    expect(placeToolWindow(size, rects(2), smallStage)).toEqual({ x: M, y: M });
  });

  it('falls back to the origin when no step fits (tiny stage)', () => {
    expect(
      placeToolWindow({ width: 240, height: 300 }, rects(1), { width: 280, height: 340 })
    ).toEqual({ x: M, y: M });
  });

  it('handles a zero-size stage (pre-measure) by falling back to the origin', () => {
    expect(placeToolWindow({ width: 240, height: 300 }, [], { width: 0, height: 0 })).toEqual({
      x: M,
      y: M,
    });
  });
});
