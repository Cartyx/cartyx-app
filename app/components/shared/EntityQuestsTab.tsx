import { useQuestsForEntity } from '~/hooks/useQuests';
import type { QuestLinkKind, QuestStatus } from '~/types/quest';

const STATUS_LABELS: Record<QuestStatus, string> = {
  not_started: 'Not started',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  failed: 'Failed',
};

interface Props {
  campaignId: string;
  kind: QuestLinkKind;
  id: string;
}

export function EntityQuestsTab({ campaignId, kind, id }: Props) {
  const { quests, isLoading } = useQuestsForEntity(campaignId, kind, id);

  if (isLoading) return <div className="p-4 text-sm text-slate-400">Loading quests…</div>;
  if (quests.length === 0)
    return <div className="p-4 text-sm text-slate-500">No linked quests.</div>;

  return (
    <div data-testid="entity-quests-tab" className="space-y-2 p-2">
      {quests.map((q) => (
        <div
          key={q.id}
          className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
        >
          <span className="text-sm text-slate-200">{q.name}</span>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-slate-300">
            {STATUS_LABELS[q.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
