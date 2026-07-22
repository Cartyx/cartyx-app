import { Globe, Lock } from 'lucide-react';
import type { LocationListItem } from '~/types/location';
import { WikiCardMenu } from '~/components/wiki/shared/WikiCardMenu';

interface LocationCardProps {
  location: LocationListItem;
  onClick: (location: LocationListItem) => void;
  onEdit?: (location: LocationListItem) => void;
  onDelete?: (location: LocationListItem) => void;
}

export function LocationCard({ location, onClick, onEdit, onDelete }: LocationCardProps) {
  return (
    <div className="group relative border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
      <div
        role="button"
        tabIndex={0}
        draggable="true"
        onDragStart={(e) => {
          e.dataTransfer.setData(
            'application/x-cartyx-document',
            JSON.stringify({
              collection: 'location',
              documentId: location.id,
              title: location.name,
            })
          );
          e.dataTransfer.effectAllowed = 'copy';
          e.currentTarget.style.opacity = '0.4';
        }}
        onDragEnd={(e) => {
          e.currentTarget.style.opacity = '';
        }}
        onClick={() => onClick(location)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(location);
          }
        }}
        className="flex items-start gap-3 px-4 py-3 cursor-grab active:cursor-grabbing"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
              {location.name}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-sans font-bold text-[9px] tracking-tight capitalize shrink-0">
              {location.locationType}
            </span>
            {location.isPublic ? (
              <Globe className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-label="Public" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Private" />
            )}
          </div>

          {location.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {location.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="absolute right-2 top-2">
        <WikiCardMenu
          collection="location"
          documentId={location.id}
          label="Location actions"
          canEdit={location.canEdit}
          onEdit={onEdit ? () => onEdit(location) : undefined}
          onDelete={onDelete ? () => onDelete(location) : undefined}
        />
      </div>
    </div>
  );
}
