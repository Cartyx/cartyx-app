import React from 'react';
import { Globe, Lock } from 'lucide-react';
import type { EventListItem } from '~/types/event';
import type { CalendarConfig } from '~/utils/calendarEngine';
import { formatDate } from '~/utils/calendarEngine';
import { WikiCardMenu } from '~/components/wiki/shared/WikiCardMenu';
import { setTokenDragImage } from '~/utils/setTokenDragImage';

const GRADIENT_PAIRS = [
  ['#3b82f6', '#8b5cf6'],
  ['#f59e0b', '#ef4444'],
  ['#10b981', '#06b6d4'],
  ['#ec4899', '#8b5cf6'],
  ['#f97316', '#eab308'],
  ['#14b8a6', '#3b82f6'],
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

interface EventCardProps {
  event: EventListItem;
  cfg: CalendarConfig;
  onClick: (event: EventListItem) => void;
  onEdit?: (event: EventListItem) => void;
}

export function EventCard({ event, cfg, onClick, onEdit }: EventCardProps) {
  const gradientIndex = hashName(event.title) % GRADIENT_PAIRS.length;
  const [gradFrom] = GRADIENT_PAIRS[gradientIndex]!;
  const firstImageUrl = event.images[0]?.url ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      data-testid="event-card"
      data-event-id={event.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-cartyx-document',
          JSON.stringify({
            collection: 'events',
            documentId: event.id,
            title: event.title,
          })
        );
        e.dataTransfer.effectAllowed = 'copy';
        setTokenDragImage(e, {
          pictureUrl: firstImageUrl,
          initial: event.title,
          color: gradFrom,
        });
        e.currentTarget.style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '';
      }}
      onClick={() => onClick(event)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(event);
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
          collection="events"
          documentId={event.id}
          label="Event actions"
          canEdit={event.canEdit}
          onEdit={onEdit ? () => onEdit(event) : undefined}
        />
      </div>

      {/* Avatar / first image thumbnail */}
      <div
        className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden mt-0.5"
        style={
          firstImageUrl
            ? undefined
            : {
                background: `linear-gradient(135deg, ${gradFrom}, ${GRADIENT_PAIRS[gradientIndex]![1]})`,
              }
        }
      >
        {firstImageUrl ? (
          <img src={firstImageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm text-white font-semibold uppercase">
            {event.title.charAt(0)}
          </span>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            data-testid="event-card-title"
            className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate"
          >
            {event.title}
          </span>
          {event.isEpic && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/25 text-amber-400 font-bold text-[9px] uppercase tracking-tight shrink-0">
              EPIC
            </span>
          )}
          {event.isPublic ? (
            <Globe className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-label="Public" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Private" />
          )}
        </div>

        <p className="text-[11px] text-slate-500">{formatDate(cfg, event.start)}</p>

        {event.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {event.tags.map((tag) => (
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
