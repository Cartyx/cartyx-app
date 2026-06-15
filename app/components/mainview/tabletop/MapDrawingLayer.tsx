import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MapDrawingData } from '~/types/mapDrawing';
import { drawingBBox } from './ActiveMapStage.geometry';

/** Minimal geometry a drawing element needs to render (committed or live preview). */
interface RenderableDrawing {
  id?: string;
  kind: 'pencil' | 'rect' | 'ellipse';
  color: string;
  strokeWidth: number;
  filled: boolean;
  points: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  createdBy?: string;
}

interface MapDrawingLayerProps {
  /** Whether the drawing layer is shown at all (GM + per-viewer + layer toggle). */
  visible: boolean;
  drawings: MapDrawingData[];
  /** In-progress drawing being created (rendered as a non-interactive preview). */
  preview: RenderableDrawing | null;
  /** Pointer tool active → shapes are selectable/movable. */
  pointerActive: boolean;
  isGM: boolean;
  currentUserId: string | null;
  effectiveScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  selectedDrawingId: string | null;
  canModify: (d: MapDrawingData) => boolean;
  onBeginMove: (id: string, e: ReactPointerEvent<SVGElement>) => void;
  onBeginResize: (d: MapDrawingData, e: ReactPointerEvent<HTMLButtonElement>) => void;
}

/**
 * Renders the shared drawing overlay: one SVG above the map/grid (the SVG never
 * captures events; individual shapes are interactive only in the pointer tool),
 * plus the selected drawing's bounding box + corner resize handle. All geometry
 * is map-local and converted to DOM here at *effectiveScale.
 */
export function MapDrawingLayer({
  visible,
  drawings,
  preview,
  pointerActive,
  isGM,
  currentUserId,
  effectiveScale,
  imageOffsetX,
  imageOffsetY,
  selectedDrawingId,
  canModify,
  onBeginMove,
  onBeginResize,
}: MapDrawingLayerProps) {
  const renderDrawing = (
    d: RenderableDrawing,
    opts: { interactive: boolean; isPreview?: boolean }
  ) => {
    const sw = Math.max(1, d.strokeWidth * effectiveScale);
    const fill = d.filled ? d.color : 'none';
    const stroke = d.filled ? 'none' : d.color;
    const pointerEvents = opts.interactive ? (d.kind === 'pencil' ? 'stroke' : 'all') : 'none';
    // Own/GM drawings can be dragged in the pointer tool → a move cursor.
    const movable =
      opts.interactive && (isGM || (currentUserId != null && d.createdBy === currentUserId));
    const common = {
      'data-testid': opts.isPreview ? undefined : 'map-drawing',
      'data-drawing-id': d.id,
      'data-drawing-kind': d.kind,
      'data-filled': String(d.filled),
      onPointerDown: opts.interactive
        ? (e: ReactPointerEvent<SVGElement>) => {
            if (d.id) onBeginMove(d.id, e);
          }
        : undefined,
      style: { pointerEvents, cursor: movable ? 'move' : 'pointer' } as const,
    };
    if (d.kind === 'pencil') {
      const pts: string[] = [];
      for (let i = 0; i + 1 < d.points.length; i += 2) {
        pts.push(
          `${imageOffsetX + d.points[i]! * effectiveScale},${imageOffsetY + d.points[i + 1]! * effectiveScale}`
        );
      }
      const points = pts.join(' ');
      // A thin line is hard to grab, so when interactive we lay a wider,
      // transparent hit-area polyline under the visible one and put the
      // interaction there; the visible polyline carries the testid + data attrs.
      const hitWidth = Math.max(sw, 16);
      return (
        <g key={d.id ?? 'preview'}>
          {opts.interactive && (
            <polyline
              points={points}
              fill="none"
              stroke="transparent"
              strokeWidth={hitWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              onPointerDown={common.onPointerDown}
              style={{ pointerEvents: 'stroke', cursor: common.style.cursor }}
            />
          )}
          <polyline
            data-testid={common['data-testid']}
            data-drawing-id={common['data-drawing-id']}
            data-drawing-kind={common['data-drawing-kind']}
            data-filled={common['data-filled']}
            points={points}
            fill="none"
            stroke={d.color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      );
    }
    const dx = imageOffsetX + d.x * effectiveScale;
    const dy = imageOffsetY + d.y * effectiveScale;
    const dw = d.width * effectiveScale;
    const dh = d.height * effectiveScale;
    if (d.kind === 'rect') {
      return (
        <rect
          key={d.id ?? 'preview'}
          {...common}
          x={dx}
          y={dy}
          width={dw}
          height={dh}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    }
    return (
      <ellipse
        key={d.id ?? 'preview'}
        {...common}
        cx={dx + dw / 2}
        cy={dy + dh / 2}
        rx={dw / 2}
        ry={dh / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    );
  };

  const selectedDrawing =
    visible && pointerActive && selectedDrawingId
      ? (drawings.find((d) => d.id === selectedDrawingId) ?? null)
      : null;
  const selectionBox = selectedDrawing
    ? (() => {
        const b = drawingBBox(selectedDrawing);
        return {
          left: imageOffsetX + b.x * effectiveScale,
          top: imageOffsetY + b.y * effectiveScale,
          width: b.width * effectiveScale,
          height: b.height * effectiveScale,
        };
      })()
    : null;

  return (
    <>
      {visible && (
        <svg
          className="pointer-events-none absolute inset-0 z-20 h-full w-full"
          data-testid="map-drawing-layer"
          aria-hidden="true"
        >
          {drawings.map((d) => renderDrawing(d, { interactive: pointerActive }))}
          {preview && renderDrawing(preview, { interactive: false, isPreview: true })}
        </svg>
      )}

      {selectedDrawing && selectionBox && (
        <>
          <div
            aria-hidden="true"
            data-testid="drawing-selection"
            className="pointer-events-none absolute z-30 rounded-sm outline outline-2 outline-offset-2 outline-[#60A5FA]"
            style={{
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
          {canModify(selectedDrawing) && (
            <button
              type="button"
              aria-label="Resize drawing"
              data-testid="drawing-resize-handle"
              onPointerDown={(e) => onBeginResize(selectedDrawing, e)}
              className="absolute z-40 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border border-white bg-[#60A5FA]"
              style={{
                left: selectionBox.left + selectionBox.width,
                top: selectionBox.top + selectionBox.height,
              }}
            />
          )}
        </>
      )}
    </>
  );
}
