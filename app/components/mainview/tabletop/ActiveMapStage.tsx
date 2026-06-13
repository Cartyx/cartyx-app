import type { MapData } from '~/types/map';

interface ActiveMapStageProps {
  map: MapData;
}

/**
 * ActiveMapStage — full-bleed render of the currently active map.
 *
 * Phase 1: a simple `<img>` with `object-contain` centered in the workspace.
 * Phase 2 swaps this for a Konva.Stage so tokens can be drawn on top with
 * shared zoom/pan, but the contract (`map: MapData`) stays stable.
 */
export function ActiveMapStage({ map }: ActiveMapStageProps) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/40"
      data-testid="active-map-stage"
      data-map-id={map.id}
    >
      <img
        src={map.imageUrl}
        alt={map.name}
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
      />
    </div>
  );
}
