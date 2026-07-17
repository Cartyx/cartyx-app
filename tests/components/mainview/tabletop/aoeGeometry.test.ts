import { describe, it, expect } from 'vitest';
import { feetToPixels, aoeShapeGeometry } from '~/components/mainview/tabletop/aoeGeometry';

describe('feetToPixels', () => {
  it('converts feet using the grid scale', () => {
    // 20 ft on a 5-ft, 50px grid = 4 squares = 200 px
    expect(feetToPixels(20, { pixelsPerSquare: 50, feetPerSquare: 5 })).toBe(200);
  });
});

describe('aoeShapeGeometry', () => {
  const base = { originX: 100, originY: 100, sizePx: 40, rotation: 0 };
  it('sphere/cylinder → circle at origin', () => {
    expect(aoeShapeGeometry({ ...base, shape: 'sphere' })).toEqual({
      kind: 'circle',
      cx: 100,
      cy: 100,
      r: 40,
    });
    expect(aoeShapeGeometry({ ...base, shape: 'cylinder' }).kind).toBe('circle');
  });
  it('cube → centered square', () => {
    expect(aoeShapeGeometry({ ...base, shape: 'cube' })).toEqual({
      kind: 'rect',
      x: 80,
      y: 80,
      w: 40,
      h: 40,
    });
  });
  it('line at rotation 0 → rectangle extending +x', () => {
    const g = aoeShapeGeometry({ ...base, shape: 'line', widthPx: 10 });
    expect(g.kind).toBe('polygon');
    if (g.kind === 'polygon') {
      expect(g.points[0]).toEqual({ x: 100, y: 95 }); // (0,-5)
      expect(g.points[1]).toEqual({ x: 140, y: 95 }); // (40,-5)
      expect(g.points[2]).toEqual({ x: 140, y: 105 }); // (40,5)
    }
  });
  it('cone at rotation 0 → apex at origin, base at x=origin+L', () => {
    const g = aoeShapeGeometry({ ...base, shape: 'cone' });
    if (g.kind === 'polygon') {
      expect(g.points[0]).toEqual({ x: 100, y: 100 }); // apex
      expect(g.points[1]).toEqual({ x: 140, y: 120 }); // (L, L/2)
      expect(g.points[2]).toEqual({ x: 140, y: 80 }); // (L, -L/2)
    }
  });
  it('rotates line/cone by rotation', () => {
    const g = aoeShapeGeometry({ ...base, shape: 'cone', rotation: Math.PI / 2 });
    if (g.kind === 'polygon') {
      // apex unchanged; far edge now points +y
      expect(g.points[0]).toEqual({ x: 100, y: 100 });
      expect(g.points[1].y).toBeCloseTo(140);
    }
  });
});
