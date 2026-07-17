import { useCallback, useEffect, useRef, useState } from 'react';
import { computeTransform, domToImagePoint, imageToDomPoint } from './viewportMath';

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

/**
 * Viewport (zoom + pan) for the map stage. Owns the container ref + observed
 * size, the viewport state, the fit-scale/effective-scale transform math, the
 * DOM↔image coordinate conversion, zoom-around-a-focal-point, and the
 * non-passive wheel-zoom listener. Extracted from ActiveMapStage so the
 * coordinate transform has one home that the tools read from.
 *
 * Coordinate system: tokens/drawings/text live in IMAGE-PIXEL space; the
 * viewport transform (fit-scale × zoom + pan) converts to DOM pixels.
 */
export function useViewport(imageWidth: number, imageHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Observe container size.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Transform math — one source of truth, shared with the tools (viewportMath).
  const { effectiveScale, imageOffsetX, imageOffsetY } = computeTransform(
    containerSize,
    { width: imageWidth, height: imageHeight },
    viewport
  );
  const displayedImageWidth = imageWidth * effectiveScale;
  const displayedImageHeight = imageHeight * effectiveScale;

  const domToImage = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!containerRef.current || effectiveScale <= 0) return null;
      const rect = containerRef.current.getBoundingClientRect();
      // Convert to stage-local px first (live rect origin), then to image space
      // using the same transform the overlay renders back with.
      return domToImagePoint(
        { x: clientX - rect.left, y: clientY - rect.top },
        {
          effectiveScale,
          imageOffsetX,
          imageOffsetY,
        }
      );
    },
    [effectiveScale, imageOffsetX, imageOffsetY]
  );

  const zoomAround = useCallback(
    (focalX: number, focalY: number, nextZoom: number) => {
      setViewport((vp) => {
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
        if (clampedZoom === vp.zoom) return vp;
        const image = { width: imageWidth, height: imageHeight };
        // Image point currently under the focal, then solve the pan that keeps
        // it under the focal at the new zoom (pan-free base transform + offset).
        const imgPt = domToImagePoint(
          { x: focalX, y: focalY },
          computeTransform(containerSize, image, vp)
        );
        const base = computeTransform(containerSize, image, {
          zoom: clampedZoom,
          panX: 0,
          panY: 0,
        });
        const mapped = imageToDomPoint(imgPt, base);
        return { zoom: clampedZoom, panX: focalX - mapped.x, panY: focalY - mapped.y };
      });
    },
    [containerSize, imageWidth, imageHeight]
  );

  // Non-passive wheel listener so we can preventDefault and stop the modal/
  // page from scrolling under the cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;
      const px =
        e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
      const factor = Math.exp(-px * 0.0017);
      zoomAround(focalX, focalY, viewportRef.current.zoom * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  return {
    containerRef,
    containerSize,
    viewport,
    setViewport,
    effectiveScale,
    displayedImageWidth,
    displayedImageHeight,
    imageOffsetX,
    imageOffsetY,
    domToImage,
    zoomAround,
  };
}
