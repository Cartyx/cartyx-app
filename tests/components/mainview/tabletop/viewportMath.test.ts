import { describe, it, expect } from 'vitest';
import {
  computeFitScale,
  computeTransform,
  domToImagePoint,
  imageToDomPoint,
} from '~/components/mainview/tabletop/viewportMath';

describe('viewport transform round-trip', () => {
  const cases = [
    { zoom: 1, panX: 0, panY: 0 },
    { zoom: 2.5, panX: -180, panY: 90 },
    { zoom: 8, panX: 1500, panY: -2300 },
    { zoom: 0.25, panX: 10, panY: 10 },
  ];
  for (const vp of cases) {
    it(`domToImage(imageToDom(p)) ≈ p at zoom ${vp.zoom}`, () => {
      const t = computeTransform({ width: 1280, height: 720 }, { width: 1024, height: 1024 }, vp);
      const p = { x: 333.25, y: 741.5 };
      const round = domToImagePoint(imageToDomPoint(p, t), t);
      expect(round.x).toBeCloseTo(p.x, 6);
      expect(round.y).toBeCloseTo(p.y, 6);
    });

    it(`imageToDom(domToImage(d)) ≈ d at zoom ${vp.zoom}`, () => {
      // The dot-under-cursor guarantee: a stage-local click point converted in
      // and rendered back out lands on the same pixel — this is the identity the
      // e2e regression exercises end-to-end.
      const t = computeTransform({ width: 1280, height: 720 }, { width: 1024, height: 1024 }, vp);
      const d = { x: 777.5, y: 251.25 };
      const round = imageToDomPoint(domToImagePoint(d, t), t);
      expect(round.x).toBeCloseTo(d.x, 6);
      expect(round.y).toBeCloseTo(d.y, 6);
    });
  }
});

describe('computeFitScale', () => {
  it('letterboxes on the limiting dimension (wide container, square image)', () => {
    // 1280×720 container, 1024×1024 image → limited by height: 720/1024.
    expect(
      computeFitScale({ width: 1280, height: 720 }, { width: 1024, height: 1024 })
    ).toBeCloseTo(720 / 1024, 10);
  });

  it('is 1 when the container is unmeasured', () => {
    expect(computeFitScale({ width: 0, height: 0 }, { width: 1024, height: 1024 })).toBe(1);
  });
});

describe('computeTransform', () => {
  it('centers the image at zoom 1 with no pan', () => {
    const t = computeTransform(
      { width: 1280, height: 720 },
      { width: 1024, height: 1024 },
      { zoom: 1, panX: 0, panY: 0 }
    );
    // fitScale = 720/1024; displayed image is 720×720 → centered horizontally,
    // flush vertically.
    const fit = 720 / 1024;
    expect(t.effectiveScale).toBeCloseTo(fit, 10);
    expect(t.imageOffsetX).toBeCloseTo((1280 - 1024 * fit) / 2, 10);
    expect(t.imageOffsetY).toBeCloseTo(0, 10);
  });

  it('applies pan as a pure offset on top of centering', () => {
    const base = computeTransform(
      { width: 1280, height: 720 },
      { width: 1024, height: 1024 },
      { zoom: 2, panX: 0, panY: 0 }
    );
    const panned = computeTransform(
      { width: 1280, height: 720 },
      { width: 1024, height: 1024 },
      { zoom: 2, panX: -50, panY: 33 }
    );
    expect(panned.imageOffsetX).toBeCloseTo(base.imageOffsetX - 50, 10);
    expect(panned.imageOffsetY).toBeCloseTo(base.imageOffsetY + 33, 10);
    expect(panned.effectiveScale).toBeCloseTo(base.effectiveScale, 10);
  });
});
