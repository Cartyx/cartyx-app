import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { SpellsFilterBar } from './SpellsFilterBar';
import { SpellCard } from './SpellCard';
import { SpellModal } from './SpellModal';
import { SpellViewModal } from './SpellViewModal';
import { useSpells, useDeleteSpell } from '~/hooks/useSpells';
import { useCampaign } from '~/hooks/useCampaigns';
import type { SpellListItem, SpellSchool } from '~/types/spell';

interface SpellsPanelProps {
  onBack: () => void;
}

export function SpellsPanel({ onBack }: SpellsPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [level, setLevel] = useState<number | undefined>(undefined);
  const [school, setSchool] = useState<SpellSchool | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSpellId, setSelectedSpellId] = useState<string | undefined>();
  const [viewSpellId, setViewSpellId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<SpellListItem | undefined>();
  const { remove: removeItem, isLoading: isDeleting } = useDeleteSpell();

  const { spells, isLoading, error } = useSpells(campaignId, {
    search: search || undefined,
    tags: filterTags.length > 0 ? filterTags : undefined,
    level,
    school,
  });

  const handleCreateClick = () => {
    setSelectedSpellId(undefined);
    setIsModalOpen(true);
  };
  const handleSpellClick = (spell: SpellListItem) => {
    // GMs always open the editor modal: homebrew spells are editable, and SRD
    // spells render read-only there with a "Duplicate to Homebrew" action.
    // Everyone else gets the read-only view modal.
    if (isGM) {
      setSelectedSpellId(spell.id);
      setIsModalOpen(true);
    } else {
      setViewSpellId(spell.id);
    }
  };

  // The menu's Edit only renders when spell.canEdit (isGM && homebrew), which
  // implies isGM, so this always reaches the editor.
  const handleSpellEdit = (spell: SpellListItem) => {
    setSelectedSpellId(spell.id);
    setIsModalOpen(true);
  };

  // The menu's Delete only renders for a GM (useWikiCardActions owns that gate).
  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    await removeItem({ id: pendingDelete.id, campaignId });
    setPendingDelete(undefined);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Spells" onBack={onBack} />
      <SpellsFilterBar
        search={search}
        onSearchChange={setSearch}
        onCreateClick={isGM ? handleCreateClick : undefined}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        level={level}
        onLevelChange={setLevel}
        school={school}
        onSchoolChange={setSchool}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading spells...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : spells.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <Sparkles className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No spells found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {spells.map((spell) => (
              <SpellCard
                key={spell.id}
                spell={spell}
                onClick={handleSpellClick}
                onEdit={handleSpellEdit}
                onDelete={() => setPendingDelete(spell)}
              />
            ))}
          </div>
        </div>
      )}

      {isGM && (
        <SpellModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedSpellId(undefined);
          }}
          campaignId={campaignId}
          spellId={selectedSpellId}
        />
      )}
      {viewSpellId && (
        <SpellViewModal
          isOpen={!!viewSpellId}
          onClose={() => setViewSpellId(undefined)}
          spellId={viewSpellId}
          campaignId={campaignId}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete spell"
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
