import { MapPin, Eye, Trash2, Edit2 } from 'lucide-react';
import { OverflowMenu, type MenuItem } from '~/components/shared/OverflowMenu';
import type { MapListItem } from '~/types/map';

interface MapCardProps {
  map: MapListItem;
  isGM: boolean;
  isActive: boolean;
  onSetActive: (map: MapListItem) => void;
  onEdit: (map: MapListItem) => void;
  onDelete: (map: MapListItem) => void;
  onPreview: (map: MapListItem) => void;
}

export function MapCard({
  map,
  isGM,
  isActive,
  onSetActive,
  onEdit,
  onDelete,
  onPreview,
}: MapCardProps) {
  const mapMenuItems: MenuItem[] = [
    {
      key: 'set-active',
      label: isActive ? 'Clear Active' : 'Set Active',
      icon: <Eye className="h-3.5 w-3.5" />,
      onSelect: () => onSetActive(map),
    },
    {
      key: 'edit',
      label: 'Edit',
      icon: <Edit2 className="h-3.5 w-3.5" />,
      onSelect: () => onEdit(map),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => onDelete(map),
    },
  ];

  return (
    <div
      className={[
        'group relative border-b border-white/[0.07] bg-[#0D1117] transition-colors hover:bg-white/[0.03]',
        isActive ? 'ring-1 ring-inset ring-emerald-500/40' : '',
      ].join(' ')}
      data-testid="map-card"
      data-active={isActive ? 'true' : undefined}
    >
      <button
        type="button"
        onClick={() => onPreview(map)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        {/* Thumbnail */}
        <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded bg-black/40">
          {map.imageUrl ? (
            <img src={map.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-700">
              <MapPin className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Title + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-sans truncate text-sm font-semibold text-slate-100">{map.name}</h3>
            {isActive && (
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Active
              </span>
            )}
          </div>
          <p className="font-sans mt-0.5 text-[11px] text-slate-500">
            {map.imageWidth} × {map.imageHeight}px •{' '}
            {map.scale.gridType === 'gridless'
              ? 'No grid'
              : `${Math.round(map.scale.pixelsPerSquare)}px/sq`}
          </p>
        </div>
      </button>

      {isGM && (
        <div className="absolute right-2 top-2">
          <OverflowMenu label="Map actions" items={mapMenuItems} />
        </div>
      )}
    </div>
  );
}
