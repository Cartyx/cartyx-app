import type { AoeShape } from '~/types/mapAoe';

export function feetToPixels(
  feet: number,
  scale: { pixelsPerSquare: number; feetPerSquare: number }
): number {
  const perSquare = scale.feetPerSquare || 5;
  return (feet / perSquare) * (scale.pixelsPerSquare || 1);
}

export interface AoeInput {
  shape: AoeShape;
  originX: number;
  originY: number;
  sizePx: number;
  widthPx?: number;
  rotation: number;
}

export type AoeShapeGeometry =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> };

/** Map-local geometry for an AoE template. Line/cone are rotated by `rotation`. */
export function aoeShapeGeometry(aoe: AoeInput): AoeShapeGeometry {
  const { shape, originX: ox, originY: oy, sizePx: L, rotation } = aoe;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // local (aim-aligned, apex/origin at 0,0) → map-local
  const at = (lx: number, ly: number) => ({
    x: ox + (lx * cos - ly * sin),
    y: oy + (lx * sin + ly * cos),
  });

  if (shape === 'sphere' || shape === 'cylinder') {
    return { kind: 'circle', cx: ox, cy: oy, r: L };
  }
  if (shape === 'cube') {
    // Axis-aligned square centered on the origin.
    return { kind: 'rect', x: ox - L / 2, y: oy - L / 2, w: L, h: L };
  }
  if (shape === 'line') {
    const W = aoe.widthPx ?? Math.max(1, L / 20);
    return { kind: 'polygon', points: [at(0, -W / 2), at(L, -W / 2), at(L, W / 2), at(0, W / 2)] };
  }
  // cone — 5e: width == length at the far edge (isosceles triangle, apex at origin)
  return { kind: 'polygon', points: [at(0, 0), at(L, L / 2), at(L, -L / 2)] };
}
