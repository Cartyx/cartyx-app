import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MapAoEData } from '~/types/mapAoe';
import { aoeShapeGeometry, type AoeInput } from './aoeGeometry';

interface MapAoELayerProps {
  visible: boolean;
  aoes: MapAoEData[];
  preview: (AoeInput & { color: string }) | null;
  effectiveScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  /** Pointer-down on a selectable template — begins a select/drag (like map text). */
  onBeginDrag?: (a: MapAoEData, e: ReactPointerEvent<SVGElement>) => void;
  selectedId?: string | null;
  /**
   * Whether templates are selectable/draggable right now. True while the AoE
   * tool OR the pointer tool is active (parity with map text) — otherwise the
   * shapes stay `pointer-events-none` so they never swallow pans/measurements.
   */
  interactive?: boolean;
  /** A template can be selected/moved/deleted only by its author or the GM. */
  canModify?: (a: MapAoEData) => boolean;
}

export function MapAoELayer({
  visible,
  aoes,
  preview,
  effectiveScale,
  imageOffsetX,
  imageOffsetY,
  onBeginDrag,
  // selectedId is accepted for API symmetry but unused this phase (no selected-highlight yet).
  selectedId: _selectedId,
  interactive = false,
  canModify,
}: MapAoELayerProps) {
  if (!visible) return null;
  const toDomX = (x: number) => imageOffsetX + x * effectiveScale;
  const toDomY = (y: number) => imageOffsetY + y * effectiveScale;

  const renderShape = (
    input: AoeInput,
    color: string,
    opts: { id?: string; interactive: boolean; aoe?: MapAoEData }
  ) => {
    const g = aoeShapeGeometry(input);
    const selectable = opts.interactive && !!opts.id && !!opts.aoe;
    const common = {
      'data-testid': opts.id ? 'map-aoe' : undefined,
      'data-aoe-id': opts.id,
      'data-aoe-shape': input.shape,
      fill: color,
      fillOpacity: 0.3,
      stroke: color,
      strokeOpacity: 0.9,
      strokeWidth: Math.max(1, 2 * effectiveScale),
      style: { pointerEvents: (selectable ? 'all' : 'none') as 'all' | 'none', cursor: 'pointer' },
      // onBeginDrag stops propagation itself so selecting/dragging an existing
      // template doesn't also reach the stage's placement handler — mirrors
      // beginTextDrag in ActiveMapStage.
      onPointerDown:
        selectable && opts.aoe
          ? (e: ReactPointerEvent<SVGElement>) => onBeginDrag?.(opts.aoe!, e)
          : undefined,
      'aria-hidden': true as const,
    };
    if (g.kind === 'circle') {
      return (
        <circle
          key={opts.id ?? 'preview'}
          {...common}
          cx={toDomX(g.cx)}
          cy={toDomY(g.cy)}
          r={g.r * effectiveScale}
        />
      );
    }
    if (g.kind === 'rect') {
      return (
        <rect
          key={opts.id ?? 'preview'}
          {...common}
          x={toDomX(g.x)}
          y={toDomY(g.y)}
          width={g.w * effectiveScale}
          height={g.h * effectiveScale}
        />
      );
    }
    const points = g.points.map((p) => `${toDomX(p.x)},${toDomY(p.y)}`).join(' ');
    return <polygon key={opts.id ?? 'preview'} {...common} points={points} />;
  };

  // Small, semi-transparent labels centered on the template's origin: the
  // optional user label (e.g. spell name) plus the placer's name below it. A
  // thin dark outline keeps them legible on any map; the fill stays translucent
  // so tokens/terrain underneath remain visible. Non-interactive.
  const renderLabel = (a: MapAoEData) => {
    const userLabel = a.label?.trim();
    const name = a.createdByName?.trim();
    if (!userLabel && !name) return null;
    // Anchor at the shape's CENTROID, not the origin: for cone/line the origin
    // is the apex — right where the caster's token usually is — so a label there
    // would hide the token. The centroid sits in the middle of the effect.
    const g = aoeShapeGeometry(a);
    let cx: number;
    let cy: number;
    if (g.kind === 'circle') {
      cx = g.cx;
      cy = g.cy;
    } else if (g.kind === 'rect') {
      cx = g.x + g.w / 2;
      cy = g.y + g.h / 2;
    } else {
      cx = g.points.reduce((s, p) => s + p.x, 0) / g.points.length;
      cy = g.points.reduce((s, p) => s + p.y, 0) / g.points.length;
    }
    const x = toDomX(cx);
    const y = toDomY(cy);
    const outline = { paintOrder: 'stroke' as const, pointerEvents: 'none' as const };
    return (
      <g key={`label-${a.id}`} aria-hidden="true">
        {userLabel && (
          <text
            x={x}
            y={name ? y - 4 : y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={12}
            fontWeight={600}
            fill="#ffffff"
            fillOpacity={0.85}
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={2.5}
            style={outline}
          >
            {userLabel}
          </text>
        )}
        {name && (
          <text
            x={x}
            y={userLabel ? y + 11 : y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9.5}
            fill="#ffffff"
            fillOpacity={0.7}
            stroke="rgba(0,0,0,0.5)"
            strokeWidth={2}
            style={outline}
          >
            {name}
          </text>
        )}
      </g>
    );
  };

  const labels = aoes.map(renderLabel).filter(Boolean);

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        data-testid="map-aoe-layer"
        role="group"
        aria-label="Spell area-of-effect templates"
      >
        {aoes.map((a) =>
          renderShape(a, a.color, {
            id: a.id,
            interactive: interactive && !!canModify && canModify(a),
            aoe: a,
          })
        )}
        {preview && renderShape(preview, preview.color, { interactive: false })}
      </svg>
      {/* Labels sit above tokens (z-40) but semi-transparent, so the caster's
          name / spell name reads while tokens and terrain stay visible. */}
      {labels.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 z-40 h-full w-full"
          data-testid="map-aoe-label-layer"
          aria-hidden="true"
        >
          {labels}
        </svg>
      )}
    </>
  );
}
