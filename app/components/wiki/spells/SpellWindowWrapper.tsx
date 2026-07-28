import { SpellWindow } from './SpellWindow';
import { SpellModal } from './SpellModal';
import { useSpell } from '~/hooks/useSpells';

export function EditSpellModalWrapper({
  campaignId,
  spellId,
  onClose,
}: {
  campaignId: string;
  spellId: string;
  onClose: () => void;
}) {
  return <SpellModal isOpen onClose={onClose} campaignId={campaignId} spellId={spellId} />;
}

export function SpellWindowWrapper({
  spellId,
  campaignId,
  onEdit,
}: {
  spellId: string;
  campaignId: string;
  onEdit: () => void;
}) {
  const { spell, isLoading } = useSpell(spellId, campaignId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500 animate-pulse">Loading spell...</p>
      </div>
    );
  }
  if (!spell) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500">Spell not found</p>
      </div>
    );
  }
  return <SpellWindow spell={spell} onEdit={onEdit} />;
}
