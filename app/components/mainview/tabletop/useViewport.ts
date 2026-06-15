import { useCallback, useEffect, useRef, useState } from 'react';

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

  // Transform math.
  const fitScale =
    containerSize.width === 0 || imageWidth === 0
      ? 1
      : Math.min(containerSize.width / imageWidth, containerSize.height / imageHeight);
  const effectiveScale = fitScale * viewport.zoom;
  const displayedImageWidth = imageWidth * effectiveScale;
  const displayedImageHeight = imageHeight * effectiveScale;
  const imageOffsetX = (containerSize.width - displayedImageWidth) / 2 + viewport.panX;
  const imageOffsetY = (containerSize.height - displayedImageHeight) / 2 + viewport.panY;

  const domToImage = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!containerRef.current || effectiveScale <= 0) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      return {
        x: (localX - imageOffsetX) / effectiveScale,
        y: (localY - imageOffsetY) / effectiveScale,
      };
    },
    [effectiveScale, imageOffsetX, imageOffsetY]
  );

  const zoomAround = useCallback(
    (focalX: number, focalY: number, nextZoom: number) => {
      setViewport((vp) => {
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
        if (clampedZoom === vp.zoom) return vp;
        const oldEffective = fitScale * vp.zoom;
        const oldOffsetX = (containerSize.width - imageWidth * oldEffective) / 2 + vp.panX;
        const oldOffsetY = (containerSize.height - imageHeight * oldEffective) / 2 + vp.panY;
        const imgX = (focalX - oldOffsetX) / oldEffective;
        const imgY = (focalY - oldOffsetY) / oldEffective;
        const newEffective = fitScale * clampedZoom;
        const newOffsetX = focalX - imgX * newEffective;
        const newOffsetY = focalY - imgY * newEffective;
        const newPanX = newOffsetX - (containerSize.width - imageWidth * newEffective) / 2;
        const newPanY = newOffsetY - (containerSize.height - imageHeight * newEffective) / 2;
        return { zoom: clampedZoom, panX: newPanX, panY: newPanY };
      });
    },
    [fitScale, containerSize.width, containerSize.height, imageWidth, imageHeight]
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
