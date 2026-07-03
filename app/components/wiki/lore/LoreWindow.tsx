import React from 'react';
import { Globe, Lock, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LoreData, LoreLink } from '~/types/lore';
import type { PictureCrop } from '~/types/character';
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

const KIND_LABELS: Record<string, string> = {
  race: 'Race',
  character: 'Character',
  player: 'Player',
  location: 'Location',
};

function LinkChip({ link }: { link: LoreLink }) {
  const kindLabel = KIND_LABELS[link.kind] ?? link.kind;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-slate-300 text-xs">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
        {kindLabel}
      </span>
      <span>{link.label ?? link.id}</span>
    </span>
  );
}

interface LoreWindowProps {
  lore: LoreData;
  onEdit?: () => void;
}

export function LoreWindow({ lore, onEdit }: LoreWindowProps) {
  const hasImages = lore.images.length > 0;
  const hasContent = !!lore.content;
  const hasGmContent = !!lore.gmContent;
  const hasLinks = lore.links.length > 0;

  return (
    <div data-testid="lore-window" className="flex flex-col gap-4 p-4">
      {/* Header: title, visibility, edit */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {lore.isPublic ? (
            <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-label="Public" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-label="Private" />
          )}
          <h3 className="font-sans font-bold text-sm text-slate-100 truncate">{lore.title}</h3>
        </div>
        {lore.canEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
            aria-label="Edit lore entry"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Tags */}
      {lore.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lore.tags.map((tag) => (
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
            {lore.images.map((image, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                <div className="w-full aspect-square overflow-hidden rounded-lg border border-white/[0.08]">
                  <img
                    src={image.url}
                    alt={image.caption || `Lore image ${idx + 1}`}
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{lore.content}</ReactMarkdown>
        </div>
      ) : (
        !hasImages &&
        !hasLinks &&
        !hasGmContent && <p className="text-xs text-slate-500">No lore details yet.</p>
      )}

      {/* GM Content */}
      {hasGmContent && (
        <div>
          <div className="mb-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
            <p className="text-[10px] text-amber-400">GM Notes — only visible to the GM.</p>
          </div>
          <div className={MARKDOWN_PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{lore.gmContent}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Linked entities */}
      {hasLinks && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Linked to</p>
          <div className="flex flex-wrap gap-2">
            {lore.links.map((link, idx) => (
              <LinkChip key={`${link.kind}-${link.id}-${idx}`} link={link} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
