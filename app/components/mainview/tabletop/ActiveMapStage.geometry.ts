/**
 * Pure geometry helpers for ActiveMapStage — extracted so they can be unit
 * tested in isolation and to keep the component focused on rendering/interaction.
 * All coordinates are MAP-LOCAL pixels unless a function says otherwise.
 */

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Minimum committed size for a rect/ellipse / resize (map-local pixels). */
export const MIN_DRAW_SIZE = 2;

/** Axis-aligned bounding box of a drawing, in map-local pixels. */
export function drawingBBox(d: {
  kind: 'pencil' | 'rect' | 'ellipse';
  points: number[];
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  if (d.kind !== 'pencil') return { x: d.x, y: d.y, width: d.width, height: d.height };
  if (d.points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < d.points.length; i += 2) {
    const x = d.points[i]!;
    const y = d.points[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Shortest distance from point (px,py) to the segment a→b. */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether the eraser at (cx,cy) with the given radius touches a drawing. */
export function eraserHits(
  d: {
    kind: 'pencil' | 'rect' | 'ellipse';
    strokeWidth: number;
    filled: boolean;
    points: number[];
    x: number;
    y: number;
    width: number;
    height: number;
  },
  cx: number,
  cy: number,
  radius: number
): boolean {
  const r = radius + d.strokeWidth / 2;
  if (d.kind === 'pencil') {
    if (d.points.length === 2) return Math.hypot(cx - d.points[0]!, cy - d.points[1]!) <= r;
    for (let i = 0; i + 3 < d.points.length; i += 2) {
      if (
        distToSegment(cx, cy, d.points[i]!, d.points[i + 1]!, d.points[i + 2]!, d.points[i + 3]!) <=
        r
      )
        return true;
    }
    return false;
  }
  if (d.kind === 'rect') {
    const inOuter =
      cx >= d.x - r && cx <= d.x + d.width + r && cy >= d.y - r && cy <= d.y + d.height + r;
    if (!inOuter) return false;
    if (d.filled) return true;
    // Outline rectangle: the hollow interior must NOT erase.
    const inInner =
      cx > d.x + r && cx < d.x + d.width - r && cy > d.y + r && cy < d.y + d.height - r;
    return !inInner;
  }
  // Ellipse — use the ellipse equation, not its bounding box.
  const rx = d.width / 2;
  const ry = d.height / 2;
  const ecx = d.x + rx;
  const ecy = d.y + ry;
  if (rx <= 0 || ry <= 0) return Math.hypot(cx - ecx, cy - ecy) <= r;
  const outer = ((cx - ecx) / (rx + r)) ** 2 + ((cy - ecy) / (ry + r)) ** 2;
  if (outer > 1) return false; // outside the (inflated) ellipse
  if (d.filled) return true;
  const innerRx = rx - r;
  const innerRy = ry - r;
  if (innerRx <= 0 || innerRy <= 0) return true; // thin ellipse — band covers it
  const inner = ((cx - ecx) / innerRx) ** 2 + ((cy - ecy) / innerRy) ** 2;
  return inner >= 1; // near the outline band, not the hollow interior
}

/** New geometry while resizing a drawing from its corner handle. */
export function resizedGeometry(
  d: {
    kind: 'pencil' | 'rect' | 'ellipse';
    startClientX: number;
    startClientY: number;
    bx: number;
    by: number;
    bw: number;
    bh: number;
    startPoints: number[];
  },
  clientX: number,
  clientY: number,
  effectiveScale: number
): { points: number[]; x: number; y: number; width: number; height: number } {
  const dxImage = (clientX - d.startClientX) / effectiveScale;
  const dyImage = (clientY - d.startClientY) / effectiveScale;
  const newW = Math.max(MIN_DRAW_SIZE, d.bw + dxImage);
  const newH = Math.max(MIN_DRAW_SIZE, d.bh + dyImage);
  if (d.kind === 'pencil') {
    // Only scale an axis whose original extent is meaningfully large; a near-1D
    // stroke (e.g. a perfectly horizontal line, bh≈0) would otherwise explode by
    // a huge factor on the first drag pixel, so leave that axis unscaled.
    const sx = d.bw >= MIN_DRAW_SIZE ? newW / d.bw : 1;
    const sy = d.bh >= MIN_DRAW_SIZE ? newH / d.bh : 1;
    const points = d.startPoints.map((v, i) =>
      i % 2 === 0 ? d.bx + (v - d.bx) * sx : d.by + (v - d.by) * sy
    );
    return { points, x: 0, y: 0, width: 0, height: 0 };
  }
  return { points: [], x: d.bx, y: d.by, width: newW, height: newH };
}

/** New geometry while moving a drawing by (offX, offY) map-local pixels. */
export function movedGeometry(
  d: {
    kind: 'pencil' | 'rect' | 'ellipse';
    startPoints: number[];
    startX: number;
    startY: number;
    bw: number;
    bh: number;
  },
  offX: number,
  offY: number
): { points: number[]; x: number; y: number; width: number; height: number } {
  if (d.kind === 'pencil') {
    const points = d.startPoints.map((v, i) => (i % 2 === 0 ? v + offX : v + offY));
    return { points, x: 0, y: 0, width: 0, height: 0 };
  }
  return { points: [], x: d.startX + offX, y: d.startY + offY, width: d.bw, height: d.bh };
}
