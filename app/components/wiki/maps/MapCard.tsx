import { useState, type ReactNode } from 'react';
import { MoreVertical, MapPin, Eye, Trash2, Edit2 } from 'lucide-react';
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
  const [menuOpen, setMenuOpen] = useState(false);

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
          <button
            type="button"
            aria-label="Map actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="flex h-7 w-7 items-center justify-center rounded bg-white/[0.03] text-slate-400 opacity-0 transition-opacity hover:bg-white/[0.07] hover:text-slate-200 group-hover:opacity-100"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded border border-white/[0.07] bg-[#080A12] shadow-lg"
              >
                <MenuItem
                  icon={<Eye className="h-3.5 w-3.5" />}
                  label={isActive ? 'Clear Active' : 'Set Active'}
                  onClick={() => {
                    setMenuOpen(false);
                    onSetActive(map);
                  }}
                />
                <MenuItem
                  icon={<Edit2 className="h-3.5 w-3.5" />}
                  label="Edit"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit(map);
                  }}
                />
                <MenuItem
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Delete"
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(map);
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-xs transition-colors hover:bg-white/[0.05]',
        danger ? 'text-rose-300 hover:text-rose-200' : 'text-slate-300',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  );
}
