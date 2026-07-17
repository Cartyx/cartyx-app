/**
 * Pure viewport transform math for the map stage — the single source of truth
 * for the image↔DOM coordinate conversion, extracted from `useViewport` so it
 * can be unit-tested in isolation (no React, no DOM).
 *
 * Coordinate system: tokens/drawings/text/ruler points live in IMAGE-PIXEL
 * space. The transform (fit-scale × zoom, then centered + panned) converts an
 * image point to a STAGE-LOCAL DOM point (px from the stage's top-left). The
 * inverse converts a stage-local DOM point back to image space.
 *
 * `imageOffset{X,Y}` and `effectiveScale` enter both directions symmetrically,
 * so `domToImagePoint` and `imageToDomPoint` are exact inverses: a click
 * converted in and rendered back out lands on the same stage-local pixel
 * regardless of zoom, pan, or the container size used — provided the SAME
 * transform is used for both, which is the whole point of centralizing it here.
 */

export interface ViewportTransform {
  /** fit-scale × zoom — image px → DOM px multiplier. */
  effectiveScale: number;
  /** Stage-local px offset of the image's left edge. */
  imageOffsetX: number;
  /** Stage-local px offset of the image's top edge. */
  imageOffsetY: number;
}

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Fit-scale: the scale at zoom 1 that letterboxes the whole image into the
 * container. 1 when either dimension is unmeasured (container not yet observed).
 */
export function computeFitScale(container: Size, image: Size): number {
  if (container.width === 0 || image.width === 0) return 1;
  return Math.min(container.width / image.width, container.height / image.height);
}

/**
 * The full transform for a container/image/viewport triple. Mirrors the former
 * inline math in `useViewport` verbatim.
 */
export function computeTransform(
  container: Size,
  image: Size,
  viewport: { zoom: number; panX: number; panY: number }
): ViewportTransform {
  const fitScale = computeFitScale(container, image);
  const effectiveScale = fitScale * viewport.zoom;
  const displayedImageWidth = image.width * effectiveScale;
  const displayedImageHeight = image.height * effectiveScale;
  const imageOffsetX = (container.width - displayedImageWidth) / 2 + viewport.panX;
  const imageOffsetY = (container.height - displayedImageHeight) / 2 + viewport.panY;
  return { effectiveScale, imageOffsetX, imageOffsetY };
}

/** Stage-local DOM point → image-space point. */
export function domToImagePoint(local: Point, t: ViewportTransform): Point {
  return {
    x: (local.x - t.imageOffsetX) / t.effectiveScale,
    y: (local.y - t.imageOffsetY) / t.effectiveScale,
  };
}

/** Image-space point → stage-local DOM point. */
export function imageToDomPoint(img: Point, t: ViewportTransform): Point {
  return {
    x: t.imageOffsetX + img.x * t.effectiveScale,
    y: t.imageOffsetY + img.y * t.effectiveScale,
  };
}
