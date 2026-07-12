export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Gutter between tool windows and from the stage edges (workspace px). */
export const TOOL_WINDOW_MARGIN = 12;

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * First free slot for a newly opened tool window: origin at the top-left,
 * stacking below open windows (flow down); when a column is full, a new
 * column starts to the right of everything overlapping the current band.
 * Pure — callers pass measured sizes/rects. Falls back to the origin when
 * nothing fits (tiny viewport), where overlap is the least-bad option.
 */
export function placeToolWindow(
  size: Size,
  openRects: Rect[],
  stage: Size
): { x: number; y: number } {
  const m = TOOL_WINDOW_MARGIN;
  let colX = m;
  // Bounded loop: each iteration moves colX strictly right past at least one
  // window, so `openRects.length + 1` columns is the true upper bound.
  for (let col = 0; col <= openRects.length; col++) {
    if (colX + size.width > stage.width - m && col > 0) break;
    // Candidate ys: the top margin, plus just below every open window.
    const ys = [m, ...openRects.map((r) => r.y + r.height + m)].sort((a, b) => a - b);
    for (const y of ys) {
      if (y + size.height > stage.height - m) continue;
      const cand: Rect = { x: colX, y, width: size.width, height: size.height };
      if (!openRects.some((r) => intersects(cand, r))) return { x: colX, y };
    }
    // Column full — jump right of everything overlapping this column's band.
    const band = openRects.filter((r) => r.x < colX + size.width && r.x + r.width > colX);
    const nextX = band.length
      ? Math.max(...band.map((r) => r.x + r.width)) + m
      : colX + size.width + m;
    if (nextX <= colX) break;
    colX = nextX;
  }
  return { x: m, y: m };
}
