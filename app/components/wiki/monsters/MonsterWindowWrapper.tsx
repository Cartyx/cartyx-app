import { MonsterWindow } from './MonsterWindow';
import { MonsterModal } from './MonsterModal';
import { useMonster } from '~/hooks/useMonsters';

export function EditMonsterModalWrapper({
  campaignId,
  monsterId,
  onClose,
}: {
  campaignId: string;
  monsterId: string;
  onClose: () => void;
}) {
  return <MonsterModal isOpen monsterId={monsterId} campaignId={campaignId} onClose={onClose} />;
}

export function MonsterWindowWrapper({
  monsterId,
  campaignId,
  isGM,
  onEdit,
}: {
  monsterId: string;
  campaignId: string;
  isGM: boolean;
  onEdit: () => void;
}) {
  const { data: monster, isLoading } = useMonster(campaignId, monsterId, isGM);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="animate-pulse text-xs text-slate-500">Loading monster...</p>
      </div>
    );
  }

  if (!monster) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-slate-500">Monster not found</p>
      </div>
    );
  }

  return <MonsterWindow monster={monster} onEdit={isGM ? onEdit : undefined} />;
}
