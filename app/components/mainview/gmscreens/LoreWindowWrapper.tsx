import { LoreWindow } from '~/components/wiki/lore/LoreWindow';
import { LoreModal } from '~/components/wiki/lore/LoreModal';
import { useLoreEntry } from '~/hooks/useLore';

export function EditLoreModalWrapper({
  campaignId,
  loreId,
  onClose,
}: {
  campaignId: string;
  loreId: string;
  onClose: () => void;
}) {
  return <LoreModal isOpen onClose={onClose} campaignId={campaignId} loreId={loreId} />;
}

export function LoreWindowWrapper({
  loreId,
  campaignId,
  onEdit,
}: {
  loreId: string;
  campaignId: string;
  onEdit: () => void;
}) {
  const { lore, isLoading } = useLoreEntry(loreId, campaignId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500 animate-pulse">Loading lore...</p>
      </div>
    );
  }

  if (!lore) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500">Lore entry not found</p>
      </div>
    );
  }

  return <LoreWindow lore={lore} onEdit={onEdit} />;
}
