import { Skull } from 'lucide-react';
import type { MonsterListItem } from '~/types/monster';
import { setTokenDragImage } from '~/utils/setTokenDragImage';

interface MonsterCardProps {
  monster: MonsterListItem;
  onClick: (monster: MonsterListItem) => void;
}

const SIZE_LABELS: Record<MonsterListItem['size'], string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
  gargantuan: 'Gargantuan',
};

function formatCR(value: number): string {
  if (value === 0) return '0';
  if (value === 0.125) return '1/8';
  if (value === 0.25) return '1/4';
  if (value === 0.5) return '1/2';
  return String(value);
}

export function MonsterCard({ monster, onClick }: MonsterCardProps) {
  const typeText = [monster.type, monster.subtype && `(${monster.subtype})`]
    .filter(Boolean)
    .join(' ');
  const initial = monster.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-cartyx-document',
          JSON.stringify({
            collection: 'monster',
            documentId: monster.id,
            title: monster.name,
          })
        );
        e.dataTransfer.effectAllowed = 'copy';
        setTokenDragImage(e, {
          pictureUrl: monster.picture,
          initial,
          color: monster.color,
        });
        e.currentTarget.style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '';
      }}
      onClick={() => onClick(monster)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(monster);
        }
      }}
      className="flex w-full cursor-grab items-center gap-3 border-b border-white/[0.05] px-4 py-3 text-left transition-colors hover:bg-white/[0.03] active:cursor-grabbing"
      style={{ borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: monster.color }}
      data-testid="monster-card"
    >
      {/* Avatar */}
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={monster.picture ? undefined : { backgroundColor: monster.color }}
      >
        {monster.picture ? (
          <img
            src={monster.picture}
            alt={monster.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <Skull className="h-5 w-5 text-white" />
        )}
      </div>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="font-sans truncate text-sm font-semibold text-slate-200">
            {monster.name}
          </span>
          <span
            className="rounded bg-white/[0.05] px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            title="Creature size"
          >
            {SIZE_LABELS[monster.size]}
          </span>
          <span
            className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300"
            title="Challenge Rating"
          >
            CR {formatCR(monster.cr.value)}
          </span>
        </div>
        {typeText && (
          <p className="font-sans truncate text-xs text-slate-500">
            {typeText}
            {monster.alignment ? ` · ${monster.alignment}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
