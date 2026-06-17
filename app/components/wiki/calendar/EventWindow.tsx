import React from 'react';
import { Globe, Lock, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EventData, EventLink } from '~/types/event';
import type { PictureCrop } from '~/types/character';
import type { CalendarConfig } from '~/utils/calendarEngine';
import { formatDate } from '~/utils/calendarEngine';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';

function getCropStyle(crop: PictureCrop): React.CSSProperties {
  const centerX = (crop.x + crop.width / 2) * 100;
  const centerY = (crop.y + crop.height / 2) * 100;
  const scale = 1 / crop.width;
  return {
    objectPosition: `${centerX}% ${centerY}%`,
    transform: `scale(${scale})`,
  };
}

/** Maps event link kind → a colour scheme for the chip badge. */
const KIND_BADGE_COLORS: Record<string, string> = {
  character: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
  player: 'bg-sky-500/10 border-sky-500/20 text-sky-400',
  race: 'bg-teal-500/10 border-teal-500/20 text-teal-400',
  location: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  lore: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
};

const KIND_LABELS: Record<string, string> = {
  character: 'Character',
  player: 'Player',
  race: 'Race',
  location: 'Location',
  lore: 'Lore',
};

function LinkChip({ link }: { link: EventLink }) {
  const kindLabel = KIND_LABELS[link.kind] ?? link.kind;
  const colorClass =
    KIND_BADGE_COLORS[link.kind] ?? 'bg-white/[0.05] border-white/[0.08] text-slate-300';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${colorClass}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider opacity-70 shrink-0">
        {kindLabel}
      </span>
      <span>{link.label ?? link.id}</span>
    </span>
  );
}

interface EventWindowProps {
  event: EventData;
  cfg: CalendarConfig;
  onEdit?: () => void;
}

export function EventWindow({ event, cfg, onEdit }: EventWindowProps) {
  const hasImages = event.images.length > 0;
  const hasContent = !!event.content;
  const hasGmContent = !!event.gmContent;
  const hasLinks = event.links.length > 0;

  const startLabel = formatDate(cfg, event.start);
  const endLabel = event.end !== null ? formatDate(cfg, event.end) : null;

  return (
    <div data-testid="event-window" className="flex flex-col gap-4 p-4">
      {/* Header: title, visibility, edit */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {event.isPublic ? (
            <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-label="Public" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-label="Private" />
          )}
          <h3 className="font-sans font-bold text-sm text-slate-100 truncate">{event.title}</h3>
        </div>
        {event.canEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
            aria-label="Edit event"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Epic badge */}
      {event.isEpic && (
        <div>
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/25 text-amber-400 font-bold text-[9px] uppercase tracking-tight">
            EPIC
          </span>
        </div>
      )}

      {/* Date range */}
      <p className="text-xs text-slate-500">
        {startLabel}
        {endLabel && ` – ${endLabel}`}
      </p>

      {/* Tags */}
      {event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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

      {/* Images gallery */}
      {hasImages && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Images</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {event.images.map((image, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                <div className="w-full aspect-square overflow-hidden rounded-lg border border-white/[0.08]">
                  <img
                    src={image.url}
                    alt={image.caption || `Event image ${idx + 1}`}
                    className="w-full h-full object-cover"
                    style={image.crop ? getCropStyle(image.crop) : undefined}
                  />
                </div>
                {image.caption && (
                  <p className="text-[10px] text-slate-500 text-center leading-tight">
                    {image.caption}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {hasContent ? (
        <div className={MARKDOWN_PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.content}</ReactMarkdown>
        </div>
      ) : (
        !hasImages &&
        !hasLinks &&
        !hasGmContent && <p className="text-xs text-slate-500">No event details yet.</p>
      )}

      {/* GM Content */}
      {hasGmContent && (
        <div>
          <div className="mb-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
            <p className="text-[10px] text-amber-400">GM Notes — only visible to the GM.</p>
          </div>
          <div className={MARKDOWN_PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.gmContent}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Linked entities */}
      {hasLinks && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Linked to</p>
          <div className="flex flex-wrap gap-2">
            {event.links.map((link, idx) => (
              <LinkChip key={`${link.kind}-${link.id}-${idx}`} link={link} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
