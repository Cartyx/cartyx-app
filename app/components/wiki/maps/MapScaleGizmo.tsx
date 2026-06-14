import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { GridType } from '~/types/schemas/maps';

interface Gizmo {
  /** Center X in image-pixel coordinates. */
  centerX: number;
  /** Center Y in image-pixel coordinates. */
  centerY: number;
  /** Side length / diameter in image-pixel coordinates. */
  sizePx: number;
}

interface MapScaleGizmoProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  gridType: GridType;
  feetPerSquare: number;
  value: Gizmo;
  onChange: (next: Gizmo) => void;
}

type DragMode = 'move' | 'resize' | 'pan' | null;

interface Viewport {
  /** User-applied zoom factor multiplied on top of the fit-scale. */
  zoom: number;
  /** Pan offset in DOM pixels. */
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

/**
 * MapScaleGizmo — overlays a draggable + resizable reference shape on a
 * preview of the uploaded map image. The shape represents one grid square
 * (or one movement unit for gridless). Sizing it to a known feature on the
 * map (a door, a tile) calibrates pixelsPerSquare.
 *
 * Coordinates: the gizmo is stored in IMAGE-PIXEL space, so calibration is
 * independent of the viewport. The renderer multiplies by an effective DOM
 * scale (fit-scale × user zoom) and adds a pan offset to position both the
 * image and the gizmo together.
 *
 * Controls:
 *   - Wheel / pinch        → zoom around cursor
 *   - Drag background      → pan
 *   - Drag gizmo body      → move
 *   - Drag gizmo corner    → resize
 *   - +/- buttons          → discrete zoom
 *   - Fit button           → reset viewport
 */
export function MapScaleGizmo({
  imageUrl,
  imageWidth,
  imageHeight,
  gridType,
  feetPerSquare,
  value,
  onChange,
}: MapScaleGizmoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  // Mirror the viewport in a ref so the (passive:false) wheel listener sees
  // the latest zoom without re-attaching on every state update.
  const viewportRef = useRef<Viewport>(viewport);
  viewportRef.current = viewport;
  const [drag, setDrag] = useState<{
    mode: DragMode;
    startClientX: number;
    startClientY: number;
    startGizmo: Gizmo;
    startViewport: Viewport;
  }>({
    mode: null,
    startClientX: 0,
    startClientY: 0,
    startGizmo: value,
    startViewport: viewport,
  });

  // Observe container size for accurate image→DOM coordinate conversion.
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

  // Fit-to-container scale (image px → DOM px at zoom=1). The effective
  // image→DOM scale that the gizmo and pan offsets use is fitScale × zoom.
  const fitScale =
    containerSize.width === 0 || imageWidth === 0
      ? 1
      : Math.min(containerSize.width / imageWidth, containerSize.height / imageHeight);
  const effectiveScale = fitScale * viewport.zoom;
  const displayedImageWidth = imageWidth * effectiveScale;
  const displayedImageHeight = imageHeight * effectiveScale;
  // Center the image at zoom=1, then offset by pan.
  const imageOffsetX = (containerSize.width - displayedImageWidth) / 2 + viewport.panX;
  const imageOffsetY = (containerSize.height - displayedImageHeight) / 2 + viewport.panY;

  const gizmoDomX = imageOffsetX + (value.centerX - value.sizePx / 2) * effectiveScale;
  const gizmoDomY = imageOffsetY + (value.centerY - value.sizePx / 2) * effectiveScale;
  const gizmoDomSize = value.sizePx * effectiveScale;

  const clampGizmo = useCallback(
    (g: Gizmo): Gizmo => {
      const minSize = 4;
      const maxSize = Math.min(imageWidth, imageHeight);
      const sizePx = Math.max(minSize, Math.min(maxSize, g.sizePx));
      const half = sizePx / 2;
      const centerX = Math.max(half, Math.min(imageWidth - half, g.centerX));
      const centerY = Math.max(half, Math.min(imageHeight - half, g.centerY));
      return { centerX, centerY, sizePx };
    },
    [imageWidth, imageHeight]
  );

  const handlePointerDown = (mode: DragMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // primary only
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startGizmo: value,
      startViewport: viewport,
    });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.mode) return;
    const dxDom = e.clientX - drag.startClientX;
    const dyDom = e.clientY - drag.startClientY;

    if (drag.mode === 'pan') {
      setViewport({
        ...drag.startViewport,
        panX: drag.startViewport.panX + dxDom,
        panY: drag.startViewport.panY + dyDom,
      });
      return;
    }

    // Both move and resize are in IMAGE-pixel deltas, so divide out the
    // effective scale (fit × zoom).
    const dxImage = dxDom / effectiveScale;
    const dyImage = dyDom / effectiveScale;

    if (drag.mode === 'move') {
      onChange(
        clampGizmo({
          centerX: drag.startGizmo.centerX + dxImage,
          centerY: drag.startGizmo.centerY + dyImage,
          sizePx: drag.startGizmo.sizePx,
        })
      );
    } else if (drag.mode === 'resize') {
      // Symmetric resize — pulling a corner outward grows both dimensions.
      const delta = (dxImage + dyImage) / 2;
      onChange(
        clampGizmo({
          centerX: drag.startGizmo.centerX,
          centerY: drag.startGizmo.centerY,
          sizePx: drag.startGizmo.sizePx + delta * 2,
        })
      );
    }
  };

  const handlePointerUp = () => {
    setDrag((d) => ({ ...d, mode: null }));
  };

  // Zoom around a focal point so the image pixel under the focal point
  // stays fixed under it. (focalX, focalY) are DOM coords relative to the
  // container.
  const zoomAround = useCallback(
    (focalX: number, focalY: number, nextZoom: number) => {
      setViewport((vp) => {
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
        if (clampedZoom === vp.zoom) return vp;

        // Image-pixel coordinate under the focal point at the OLD viewport.
        const oldEffective = fitScale * vp.zoom;
        const oldOffsetX = (containerSize.width - imageWidth * oldEffective) / 2 + vp.panX;
        const oldOffsetY = (containerSize.height - imageHeight * oldEffective) / 2 + vp.panY;
        const imgX = (focalX - oldOffsetX) / oldEffective;
        const imgY = (focalY - oldOffsetY) / oldEffective;

        // Recompute pan so that imgX/imgY still lands at the focal point
        // after the zoom changes.
        const newEffective = fitScale * clampedZoom;
        const newOffsetX = focalX - imgX * newEffective;
        const newOffsetY = focalY - imgY * newEffective;
        const newPanX = newOffsetX - (containerSize.width - imageWidth * newEffective) / 2;
        const newPanY = newOffsetY - (containerSize.height - imageHeight * newEffective) / 2;
        return { zoom: clampedZoom, panX: newPanX, panY: newPanY };
      });
    },
    [containerSize.width, containerSize.height, fitScale, imageWidth, imageHeight]
  );

  // Native wheel listener with passive:false so we can preventDefault. The
  // React onWheel prop is registered passive in modern React, which means
  // it cannot stop the modal scrolling under the cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;
      // Normalise across deltaMode (0=px, 1=line, 2=page).
      const px =
        e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
      // ~Figma feel: 1 notch of a standard wheel (~100px) ≈ 18% zoom step.
      const factor = Math.exp(-px * 0.0017);
      zoomAround(focalX, focalY, viewportRef.current.zoom * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  const handleZoomButton = (factor: number) => () => {
    zoomAround(containerSize.width / 2, containerSize.height / 2, viewport.zoom * factor);
  };

  const handleFitReset = () => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
  };

  const shape =
    gridType === 'gridless'
      ? 'rounded-full'
      : gridType === 'hex'
        ? '[clip-path:polygon(25%_5%,75%_5%,100%_50%,75%_95%,25%_95%,0%_50%)]'
        : ''; // square = default

  const readoutFeet = feetPerSquare;
  const readoutPxPerSquare = Math.round(value.sizePx);
  const cursorClass =
    drag.mode === 'pan' ? 'cursor-grabbing' : drag.mode == null ? 'cursor-grab' : '';

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown('pan')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`relative h-full w-full touch-none select-none overflow-hidden bg-black/40 ${cursorClass}`}
      data-testid="map-scale-gizmo"
    >
      {/* Image. maxWidth/maxHeight overrides Tailwind preflight's
          `img { max-width: 100%; height: auto; }` which would otherwise
          clamp the width at high zoom and leave the height to grow
          freely — producing a visibly stretched image. */}
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="pointer-events-none absolute"
        style={{
          width: displayedImageWidth,
          height: displayedImageHeight,
          maxWidth: 'none',
          maxHeight: 'none',
          left: imageOffsetX,
          top: imageOffsetY,
          imageRendering: viewport.zoom > 2 ? 'pixelated' : 'auto',
        }}
      />

      {/* Gizmo */}
      {effectiveScale > 0 && gizmoDomSize > 0 && (
        <div
          onPointerDown={handlePointerDown('move')}
          className={[
            'absolute cursor-move border-2 border-white/90 bg-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]',
            shape,
          ].join(' ')}
          style={{ left: gizmoDomX, top: gizmoDomY, width: gizmoDomSize, height: gizmoDomSize }}
          data-testid="map-scale-gizmo-shape"
        >
          {/* Resize handle (bottom-right) */}
          <div
            onPointerDown={handlePointerDown('resize')}
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-sm border border-white/90 bg-emerald-400 shadow"
            aria-label="Resize gizmo"
            data-testid="map-scale-gizmo-handle"
          />
        </div>
      )}

      {/* Zoom toolbar (top-right) */}
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/70 p-1">
        <button
          type="button"
          aria-label="Zoom out"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleZoomButton(1 / 1.25)}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-200 hover:bg-white/10"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="px-1 font-mono text-[10px] text-slate-200 tabular-nums">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleZoomButton(1.25)}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-200 hover:bg-white/10"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleFitReset}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-200 hover:bg-white/10"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Readout */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-white">
        1 {gridType === 'gridless' ? 'unit' : 'square'} = {readoutPxPerSquare}px ≈ {readoutFeet}ft
      </div>

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-slate-300">
        Scroll · Drag background to pan
      </div>
    </div>
  );
}
