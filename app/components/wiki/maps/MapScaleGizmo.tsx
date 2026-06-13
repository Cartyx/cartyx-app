import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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

type DragMode = 'move' | 'resize' | null;

/**
 * MapScaleGizmo — overlays a draggable + resizable reference shape on a
 * preview of the uploaded map image. The shape represents one grid square
 * (or one movement unit for gridless). Sizing it to a known feature on the
 * map (a door, a tile) calibrates pixelsPerSquare.
 *
 * The gizmo and image both render at the same DOM scale (image is
 * `object-contain` inside a fixed-size box). All gizmo coordinates are
 * stored in IMAGE-PIXEL space, which the renderer converts to DOM-pixel
 * space using the current display scale. This way the calibration is
 * independent of the preview's viewport size.
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
  const [drag, setDrag] = useState<{
    mode: DragMode;
    startClientX: number;
    startClientY: number;
    startGizmo: Gizmo;
  }>({ mode: null, startClientX: 0, startClientY: 0, startGizmo: value });

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

  // Compute the display scale (image px → DOM px) given object-contain layout.
  const displayScale =
    containerSize.width === 0 || imageWidth === 0
      ? 1
      : Math.min(containerSize.width / imageWidth, containerSize.height / imageHeight);
  const displayedImageWidth = imageWidth * displayScale;
  const displayedImageHeight = imageHeight * displayScale;
  const imageOffsetX = (containerSize.width - displayedImageWidth) / 2;
  const imageOffsetY = (containerSize.height - displayedImageHeight) / 2;

  const gizmoDomX = imageOffsetX + value.centerX * displayScale - (value.sizePx * displayScale) / 2;
  const gizmoDomY = imageOffsetY + value.centerY * displayScale - (value.sizePx * displayScale) / 2;
  const gizmoDomSize = value.sizePx * displayScale;

  const clampGizmo = useCallback(
    (g: Gizmo): Gizmo => {
      const minSize = 8;
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
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startGizmo: value,
    });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.mode) return;
    const dxDom = e.clientX - drag.startClientX;
    const dyDom = e.clientY - drag.startClientY;
    const dxImage = dxDom / displayScale;
    const dyImage = dyDom / displayScale;

    if (drag.mode === 'move') {
      onChange(
        clampGizmo({
          centerX: drag.startGizmo.centerX + dxImage,
          centerY: drag.startGizmo.centerY + dyImage,
          sizePx: drag.startGizmo.sizePx,
        })
      );
    } else if (drag.mode === 'resize') {
      // Resize is symmetric — pull a corner outward grows in both dimensions.
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
    setDrag({ mode: null, startClientX: 0, startClientY: 0, startGizmo: value });
  };

  const shape =
    gridType === 'gridless'
      ? 'rounded-full'
      : gridType === 'hex'
        ? '[clip-path:polygon(25%_5%,75%_5%,100%_50%,75%_95%,25%_95%,0%_50%)]'
        : ''; // square = default

  const readoutFeet = feetPerSquare;
  const readoutPxPerSquare = Math.round(value.sizePx);

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative h-full w-full select-none overflow-hidden bg-black/40"
      data-testid="map-scale-gizmo"
    >
      {/* Image */}
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 m-auto max-h-full max-w-full"
        style={{
          width: displayedImageWidth,
          height: displayedImageHeight,
          left: imageOffsetX,
          top: imageOffsetY,
        }}
      />

      {/* Gizmo */}
      {displayScale > 0 && gizmoDomSize > 0 && (
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

      {/* Readout */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-white">
        1 {gridType === 'gridless' ? 'unit' : 'square'} = {readoutPxPerSquare}px ≈ {readoutFeet}ft
      </div>
    </div>
  );
}
