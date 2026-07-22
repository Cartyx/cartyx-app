import type { QuestListItem, QuestStatus } from '~/types/quest';
import { WikiCardMenu } from '~/components/wiki/shared/WikiCardMenu';

const STATUS_LABELS: Record<QuestStatus, string> = {
  not_started: 'Not started',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  failed: 'Failed',
};

interface QuestCardProps {
  quest: QuestListItem;
  onClick: (quest: QuestListItem) => void;
  onEdit?: (quest: QuestListItem) => void;
  onDelete?: (quest: QuestListItem) => void;
}

export function QuestCard({ quest, onClick, onEdit, onDelete }: QuestCardProps) {
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
              collection: 'quest',
              documentId: quest.id,
              title: quest.name,
            })
          );
          e.dataTransfer.effectAllowed = 'copy';
          e.currentTarget.style.opacity = '0.4';
        }}
        onDragEnd={(e) => {
          e.currentTarget.style.opacity = '';
        }}
        onClick={() => onClick(quest)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(quest);
          }
        }}
        className="flex items-start gap-3 px-4 py-3 cursor-grab active:cursor-grabbing"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
              {quest.name}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-slate-400 font-sans font-bold text-[9px] uppercase tracking-tight">
              {STATUS_LABELS[quest.status]}
            </span>
            {quest.type && (
              <span className="text-[10px] text-slate-500 truncate">{quest.type}</span>
            )}
          </div>
          {quest.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {quest.tags.map((tag) => (
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
          collection="quest"
          documentId={quest.id}
          label="Quest actions"
          canEdit={quest.canEdit}
          onEdit={onEdit ? () => onEdit(quest) : undefined}
          onDelete={onDelete ? () => onDelete(quest) : undefined}
        />
      </div>
    </div>
  );
}
