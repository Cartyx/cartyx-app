import React from 'react';
import { Globe, Lock } from 'lucide-react';
import type { LoreListItem } from '~/types/lore';
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

interface LoreCardProps {
  lore: LoreListItem;
  onClick: (lore: LoreListItem) => void;
  onEdit?: (lore: LoreListItem) => void;
  onDelete?: (lore: LoreListItem) => void;
}

export function LoreCard({ lore, onClick, onEdit, onDelete }: LoreCardProps) {
  const gradientIndex = hashName(lore.title) % GRADIENT_PAIRS.length;
  const [gradFrom] = GRADIENT_PAIRS[gradientIndex]!;
  const firstImageUrl = lore.images[0]?.url ?? null;

  return (
    <div className="group relative border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
      <div
        role="button"
        tabIndex={0}
        draggable="true"
        data-testid="lore-card"
        data-lore-id={lore.id}
        onDragStart={(e) => {
          e.dataTransfer.setData(
            'application/x-cartyx-document',
            JSON.stringify({
              collection: 'lore',
              documentId: lore.id,
              title: lore.title,
            })
          );
          e.dataTransfer.effectAllowed = 'copy';
          setTokenDragImage(e, {
            pictureUrl: firstImageUrl,
            initial: lore.title,
            color: gradFrom,
          });
          e.currentTarget.style.opacity = '0.4';
        }}
        onDragEnd={(e) => {
          e.currentTarget.style.opacity = '';
        }}
        onClick={() => onClick(lore)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(lore);
          }
        }}
        className="flex items-start gap-3 px-4 py-3 cursor-grab active:cursor-grabbing"
      >
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
              {lore.title.charAt(0)}
            </span>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              data-testid="lore-card-title"
              className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate"
            >
              {lore.title}
            </span>
            {lore.isPublic ? (
              <Globe className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-label="Public" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Private" />
            )}
          </div>

          {lore.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
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

          {lore.links.length > 0 && (
            <p className="text-[11px] text-slate-500">
              {lore.links.length === 1
                ? (lore.links[0]?.label ?? '1 link')
                : `${lore.links.length} links`}
            </p>
          )}
        </div>
      </div>

      <div className="absolute right-2 top-2">
        <WikiCardMenu
          collection="lore"
          documentId={lore.id}
          label="Lore actions"
          canEdit={lore.canEdit}
          onEdit={onEdit ? () => onEdit(lore) : undefined}
          onDelete={onDelete ? () => onDelete(lore) : undefined}
        />
      </div>
    </div>
  );
}
