import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Swords } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { QuestCard } from './QuestCard';
import { QuestModal } from './QuestModal';
import { QuestViewModal } from './QuestViewModal';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import { useQuests, useDeleteQuest } from '~/hooks/useQuests';
import type { QuestListItem, QuestStatus } from '~/types/quest';

interface QuestsPanelProps {
  onBack: () => void;
}

const STATUS_FILTERS: { value: QuestStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'not_started', label: 'Not started' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export function QuestsPanel({ onBack }: QuestsPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });

  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<QuestStatus | 'all'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [viewId, setViewId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<QuestListItem | undefined>();

  const { quests, isLoading, error } = useQuests(campaignId, {
    search: search || undefined,
    tags: filterTags.length > 0 ? filterTags : undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });
  const { remove: removeQuest, isLoading: isDeleting } = useDeleteQuest();

  // The menu's Delete only renders for a GM (useWikiCardActions owns that gate).
  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    await removeQuest({ id: pendingDelete.id, campaignId });
    setPendingDelete(undefined);
  };

  const handleCreateClick = () => {
    setSelectedId(undefined);
    setIsModalOpen(true);
  };

  const handleClick = (quest: QuestListItem) => {
    if (quest.canEdit) {
      setSelectedId(quest.id);
      setIsModalOpen(true);
    } else {
      setViewId(quest.id);
    }
  };

  // The menu's Edit only renders when canEdit, so this always goes to the editor.
  const handleEdit = (quest: QuestListItem) => {
    setSelectedId(quest.id);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Quests" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        onCreateClick={handleCreateClick}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search quests..."
        showSessionFilter={false}
        showVisibilityFilter={false}
        visibility="all"
        onVisibilityChange={() => {}}
      />

      <div className="flex flex-wrap gap-1.5 px-3 pb-3 border-b border-white/[0.07] bg-[#0D1117]">
        {STATUS_FILTERS.map((s) => {
          const active = statusFilter === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatusFilter(s.value)}
              aria-pressed={active}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${active ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:text-slate-300'}`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading quests...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : quests.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <Swords className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No quests found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {quests.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                onClick={handleClick}
                onEdit={handleEdit}
                onDelete={() => setPendingDelete(quest)}
              />
            ))}
          </div>
        </div>
      )}

      <QuestModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedId(undefined);
        }}
        campaignId={campaignId}
        questId={selectedId}
      />
      {viewId && (
        <QuestViewModal
          isOpen={!!viewId}
          onClose={() => setViewId(undefined)}
          questId={viewId}
          campaignId={campaignId}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete quest"
          message={`Delete "${pendingDelete.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          isLoading={isDeleting}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(undefined)}
        />
      )}
    </div>
  );
}
