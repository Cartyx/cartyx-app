import { describe, it, expect } from 'vitest';
import {
  clamp,
  drawingBBox,
  distToSegment,
  eraserHits,
  resizedGeometry,
  movedGeometry,
} from '~/components/mainview/tabletop/ActiveMapStage.geometry';

describe('clamp', () => {
  it('clamps into [min,max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('drawingBBox', () => {
  it('returns the box for rect/ellipse directly', () => {
    expect(drawingBBox({ kind: 'rect', points: [], x: 5, y: 6, width: 7, height: 8 })).toEqual({
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    });
  });
  it('computes the bbox of a pencil point list', () => {
    expect(
      drawingBBox({
        kind: 'pencil',
        points: [10, 20, 40, 5, 25, 50],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      })
    ).toEqual({ x: 10, y: 5, width: 30, height: 45 });
  });
});

describe('distToSegment', () => {
  it('is 0 on the segment and positive off it', () => {
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
  });
  it('clamps to the nearer endpoint past the ends', () => {
    expect(distToSegment(-4, 0, 0, 0, 10, 0)).toBe(4);
  });
});

describe('eraserHits', () => {
  const base = { strokeWidth: 2, points: [] as number[], x: 0, y: 0, width: 100, height: 100 };

  it('filled rect: anywhere inside hits', () => {
    expect(eraserHits({ ...base, kind: 'rect', filled: true }, 50, 50, 2)).toBe(true);
  });

  it('outline rect: hollow centre does NOT hit, the edge does', () => {
    const rect = { ...base, kind: 'rect' as const, filled: false };
    expect(eraserHits(rect, 50, 50, 2)).toBe(false); // hollow centre
    expect(eraserHits(rect, 0, 50, 2)).toBe(true); // on the left edge
  });

  it('outline ellipse: centre does NOT hit, the rim does', () => {
    const ell = { ...base, kind: 'ellipse' as const, filled: false };
    expect(eraserHits(ell, 50, 50, 2)).toBe(false); // centre
    expect(eraserHits(ell, 100, 50, 2)).toBe(true); // rightmost rim point
  });

  it('ellipse corner of the bbox does NOT hit (uses the ellipse equation)', () => {
    const ell = { ...base, kind: 'ellipse' as const, filled: true };
    expect(eraserHits(ell, 99, 99, 2)).toBe(false); // bbox corner is outside the ellipse
  });

  it('pencil: near the line hits, far does not', () => {
    const pencil = { ...base, kind: 'pencil' as const, filled: false, points: [0, 0, 100, 0] };
    expect(eraserHits(pencil, 50, 1, 2)).toBe(true);
    expect(eraserHits(pencil, 50, 40, 2)).toBe(false);
  });
});

describe('resizedGeometry', () => {
  const start = { startClientX: 0, startClientY: 0, bx: 0, by: 0, bw: 100, bh: 100 };

  it('rect: grows width/height by the drag delta (scale 1 DOM px = 1 image px here)', () => {
    const g = resizedGeometry({ ...start, kind: 'rect', startPoints: [] }, 50, 30, 1);
    expect(g.width).toBe(150);
    expect(g.height).toBe(130);
  });

  it('pencil: scales points around the bbox origin', () => {
    const g = resizedGeometry(
      { ...start, kind: 'pencil', startPoints: [0, 0, 100, 100] },
      100,
      100,
      1
    );
    // bw=bh=100, drag +100 → 2x; (100,100) → (200,200)
    expect(g.points).toEqual([0, 0, 200, 200]);
  });

  it('pencil: a near-1D (horizontal) stroke is not exploded on the flat axis', () => {
    const g = resizedGeometry(
      { ...start, kind: 'pencil', bh: 0, startPoints: [0, 0, 100, 0] },
      100,
      100,
      1
    );
    // bh=0 → no vertical scale; y stays 0
    expect(g.points).toEqual([0, 0, 200, 0]);
  });
});

describe('movedGeometry', () => {
  it('rect: translates x/y, keeps size', () => {
    const g = movedGeometry(
      { kind: 'rect', startPoints: [], startX: 10, startY: 20, bw: 30, bh: 40 },
      5,
      6
    );
    expect(g).toEqual({ points: [], x: 15, y: 26, width: 30, height: 40 });
  });
  it('pencil: translates every point', () => {
    const g = movedGeometry(
      { kind: 'pencil', startPoints: [0, 0, 10, 10], startX: 0, startY: 0, bw: 10, bh: 10 },
      5,
      -3
    );
    expect(g.points).toEqual([5, -3, 15, 7]);
  });
});
