import { Globe, Lock } from 'lucide-react';
import type { RuleListItem } from '~/types/rule';
import { WikiCardMenu } from '~/components/wiki/shared/WikiCardMenu';

interface RuleCardProps {
  rule: RuleListItem;
  /** RuleListItem carries no canEdit — the panel gates rule edits on isGM. */
  canEdit?: boolean;
  onClick: (rule: RuleListItem) => void;
  onEdit?: (rule: RuleListItem) => void;
  onDelete?: (rule: RuleListItem) => void;
}

export function RuleCard({ rule, canEdit, onClick, onEdit, onDelete }: RuleCardProps) {
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
              collection: 'rule',
              documentId: rule.id,
              title: rule.title,
            })
          );
          e.dataTransfer.effectAllowed = 'copy';
          e.currentTarget.style.opacity = '0.4';
        }}
        onDragEnd={(e) => {
          e.currentTarget.style.opacity = '';
        }}
        onClick={() => onClick(rule)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(rule);
          }
        }}
        className="flex items-start gap-3 px-4 py-3 cursor-grab active:cursor-grabbing"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
              {rule.title}
            </span>
            {rule.isPublic ? (
              <Globe className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-label="Public" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Private" />
            )}
          </div>

          {rule.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {rule.tags.map((tag) => (
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
          collection="rule"
          documentId={rule.id}
          label="Rule actions"
          canEdit={canEdit}
          onEdit={onEdit ? () => onEdit(rule) : undefined}
          onDelete={onDelete ? () => onDelete(rule) : undefined}
        />
      </div>
    </div>
  );
}
