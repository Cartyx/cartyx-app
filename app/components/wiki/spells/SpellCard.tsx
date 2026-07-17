import type { SpellListItem } from '~/types/spell';
import { formatSpellLevel, formatSchool } from '~/constants/spells';

interface SpellCardProps {
  spell: SpellListItem;
  onClick: (spell: SpellListItem) => void;
}

export function SpellCard({ spell, onClick }: SpellCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-cartyx-document',
          JSON.stringify({ collection: 'spell', documentId: spell.id, title: spell.name })
        );
        e.dataTransfer.effectAllowed = 'copy';
        e.currentTarget.style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '';
      }}
      onClick={() => onClick(spell)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(spell);
        }
      }}
      className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors group cursor-grab active:cursor-grabbing"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
            {spell.name}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-sans font-semibold text-slate-500">
          <span>{formatSpellLevel(spell.level)}</span>
          <span aria-hidden>·</span>
          <span>{formatSchool(spell.school)}</span>
          {spell.source === 'srd' && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-400 text-[9px] tracking-wide">
              SRD
            </span>
          )}
        </div>
        {spell.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {spell.tags.map((tag) => (
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
