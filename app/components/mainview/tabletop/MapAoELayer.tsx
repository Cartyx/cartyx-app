import type { MapAoEData } from '~/types/mapAoe';
import { aoeShapeGeometry, type AoeInput } from './aoeGeometry';

interface MapAoELayerProps {
  visible: boolean;
  aoes: MapAoEData[];
  preview: (AoeInput & { color: string }) | null;
  effectiveScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  /** A template can be selected/deleted only by its author or the GM. */
  canModify?: (a: MapAoEData) => boolean;
}

export function MapAoELayer({
  visible,
  aoes,
  preview,
  effectiveScale,
  imageOffsetX,
  imageOffsetY,
  onSelect,
  // selectedId is accepted for API symmetry but unused this phase (no selected-highlight yet).
  selectedId: _selectedId,
  canModify,
}: MapAoELayerProps) {
  if (!visible) return null;
  const toDomX = (x: number) => imageOffsetX + x * effectiveScale;
  const toDomY = (y: number) => imageOffsetY + y * effectiveScale;

  const renderShape = (
    input: AoeInput,
    color: string,
    opts: { id?: string; interactive: boolean }
  ) => {
    const g = aoeShapeGeometry(input);
    const selectable = opts.interactive && !!opts.id;
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
      onPointerDown: selectable && opts.id ? () => onSelect?.(opts.id!) : undefined,
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

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      data-testid="map-aoe-layer"
      role="group"
      aria-label="Spell area-of-effect templates"
    >
      {aoes.map((a) =>
        renderShape(a, a.color, { id: a.id, interactive: !!canModify && canModify(a) })
      )}
      {preview && renderShape(preview, preview.color, { interactive: false })}
    </svg>
  );
}
