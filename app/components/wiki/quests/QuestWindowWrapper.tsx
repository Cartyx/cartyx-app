import { QuestWindow } from './QuestWindow';
import { QuestModal } from './QuestModal';
import { useQuest } from '~/hooks/useQuests';

export function EditQuestModalWrapper({
  campaignId,
  questId,
  onClose,
}: {
  campaignId: string;
  questId: string;
  onClose: () => void;
}) {
  return <QuestModal isOpen onClose={onClose} campaignId={campaignId} questId={questId} />;
}

export function QuestWindowWrapper({
  questId,
  campaignId,
  onEdit,
}: {
  questId: string;
  campaignId: string;
  onEdit: () => void;
}) {
  const { quest, isLoading } = useQuest(questId, campaignId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500 animate-pulse">Loading quest...</p>
      </div>
    );
  }
  if (!quest) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500">Quest not found</p>
      </div>
    );
  }
  return <QuestWindow quest={quest} onEdit={onEdit} />;
}
