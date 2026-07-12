import { describe, it, expect } from 'vitest';
import {
  placeToolWindow,
  TOOL_WINDOW_MARGIN,
  type Rect,
} from '~/components/mainview/tabletop/placeToolWindow';

const STAGE = { width: 1200, height: 800 };
const M = TOOL_WINDOW_MARGIN; // 12

describe('placeToolWindow', () => {
  it('places the first window at the top-left origin', () => {
    expect(placeToolWindow({ width: 240, height: 300 }, [], STAGE)).toEqual({ x: M, y: M });
  });

  it('stacks the second window below the first (flow down)', () => {
    const open: Rect[] = [{ x: M, y: M, width: 240, height: 300 }];
    expect(placeToolWindow({ width: 240, height: 300 }, open, STAGE)).toEqual({
      x: M,
      y: M + 300 + M, // 324
    });
  });

  it('starts a new column to the right when the column is full', () => {
    const open: Rect[] = [
      { x: M, y: M, width: 240, height: 400 },
      { x: M, y: 424, width: 240, height: 300 },
    ];
    // Next window (height 200) cannot fit below y=736 within height 800.
    expect(placeToolWindow({ width: 240, height: 200 }, open, STAGE)).toEqual({
      x: M + 240 + M, // 264 — right of the widest window in column 1
      y: M,
    });
  });

  it('skips slots that would overlap a dragged window', () => {
    // A window was dragged to cover the origin slot.
    const open: Rect[] = [{ x: 0, y: 0, width: 300, height: 200 }];
    const pos = placeToolWindow({ width: 240, height: 300 }, open, STAGE);
    // First free candidate in column 1 is below the dragged window.
    expect(pos).toEqual({ x: M, y: 200 + M });
  });

  it('falls back to the origin when nothing fits (tiny stage)', () => {
    const open: Rect[] = [{ x: M, y: M, width: 240, height: 300 }];
    expect(placeToolWindow({ width: 240, height: 300 }, open, { width: 280, height: 340 })).toEqual(
      { x: M, y: M }
    );
  });

  it('handles a zero-size stage (pre-measure) by falling back to the origin', () => {
    expect(placeToolWindow({ width: 240, height: 300 }, [], { width: 0, height: 0 })).toEqual({
      x: M,
      y: M,
    });
  });
});
