import type { RaceListItem } from '~/types/race';
import { WikiCardMenu } from '~/components/wiki/shared/WikiCardMenu';

interface RaceCardProps {
  race: RaceListItem;
  onClick: (race: RaceListItem) => void;
  onEdit?: (race: RaceListItem) => void;
}

export function RaceCard({ race, onClick, onEdit }: RaceCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-cartyx-document',
          JSON.stringify({
            collection: 'race',
            documentId: race.id,
            title: race.title,
          })
        );
        e.dataTransfer.effectAllowed = 'copy';
        e.currentTarget.style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '';
      }}
      onClick={() => onClick(race)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(race);
        }
      }}
      className="relative flex items-start gap-3 px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors group cursor-grab active:cursor-grabbing"
    >
      {/* Overflow menu. Stops propagation so opening it never fires the card's
          own click/keyboard activation, and is not itself draggable. */}
      <div
        role="presentation"
        className="absolute right-2 top-2"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <WikiCardMenu
          collection="race"
          documentId={race.id}
          label="Race actions"
          canEdit={race.canEdit}
          onEdit={onEdit ? () => onEdit(race) : undefined}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
            {race.title}
          </span>
        </div>

        {race.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {race.tags.map((tag) => (
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
  );
}
