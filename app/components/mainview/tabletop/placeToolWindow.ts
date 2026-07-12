export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Gutter between the first tool window and the stage edges (workspace px). */
export const TOOL_WINDOW_MARGIN = 12;

/** Down-and-right step between cascaded windows (workspace px). */
export const TOOL_WINDOW_CASCADE_STEP = 28;

/**
 * Position for a newly opened tool window. Windows *cascade* — each one opens
 * one step down-and-right of the previous, overlapping rather than tiling, so
 * the newest sits on top and can be dragged clear of the others. The cascade
 * wraps back to the origin once another step would run past the stage edges.
 *
 * Pure — the caller passes the currently-open windows (only their count drives
 * the cascade) and the measured stage size. `openRects` keeps the Rect[] shape
 * for callers; positions within it are intentionally ignored. Falls back to
 * the origin for a not-yet-measured (zero/tiny) stage.
 */
export function placeToolWindow(
  size: Size,
  openRects: Rect[],
  stage: Size
): { x: number; y: number } {
  const m = TOOL_WINDOW_MARGIN;
  const step = TOOL_WINDOW_CASCADE_STEP;
  // Furthest top-left the window can sit and still fit fully on the stage.
  const maxX = Math.max(m, stage.width - m - size.width);
  const maxY = Math.max(m, stage.height - m - size.height);
  // How many steps fit before either edge is exceeded; the cascade wraps there.
  const steps = Math.max(0, Math.min(Math.floor((maxX - m) / step), Math.floor((maxY - m) / step)));
  const k = steps === 0 ? 0 : openRects.length % (steps + 1);
  return { x: m + k * step, y: m + k * step };
}
