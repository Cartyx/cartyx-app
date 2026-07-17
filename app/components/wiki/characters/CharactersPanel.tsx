import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { CharacterCard } from './CharacterCard';
import { CharacterModal } from './CharacterModal';
import { CharacterViewModal } from './CharacterViewModal';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import { useCharacters, useDeleteCharacter } from '~/hooks/useCharacters';
import { useCampaign } from '~/hooks/useCampaigns';
import type { CharacterListItem } from '~/types/character';

interface CharactersPanelProps {
  onBack: () => void;
}

export function CharactersPanel({ onBack }: CharactersPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);

  const [search, setSearch] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | undefined>();
  const [viewCharacterId, setViewCharacterId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<CharacterListItem | undefined>();

  const sessions = campaign?.sessions ?? [];
  const { remove: removeCharacter, isLoading: isDeleting } = useDeleteCharacter();

  const { characters, isLoading, error } = useCharacters(campaignId, {
    search: search || undefined,
    sessionId: sessionId || undefined,
    visibility,
    tags: filterTags.length > 0 ? filterTags : undefined,
  });

  const handleCreateClick = () => {
    setSelectedCharacterId(undefined);
    setIsModalOpen(true);
  };

  const handleCharacterClick = (character: CharacterListItem) => {
    if (character.canEdit) {
      setSelectedCharacterId(character.id);
      setIsModalOpen(true);
    } else {
      setViewCharacterId(character.id);
    }
  };

  // The menu's Edit only renders when canEdit, so this always goes to the editor.
  const handleCharacterEdit = (character: CharacterListItem) => {
    setSelectedCharacterId(character.id);
    setIsModalOpen(true);
  };

  // The menu's Delete only renders for a GM (useWikiCardActions owns that gate).
  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    await removeCharacter({ id: pendingDelete.id, campaignId });
    setPendingDelete(undefined);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedCharacterId(undefined);
  };

  const handleViewModalClose = () => {
    setViewCharacterId(undefined);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Characters" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        sessionId={sessionId}
        onSessionChange={setSessionId}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        sessions={sessions}
        onCreateClick={handleCreateClick}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search characters..."
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading characters...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : characters.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <Users className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No characters found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onClick={handleCharacterClick}
                onEdit={handleCharacterEdit}
                onDelete={() => setPendingDelete(character)}
              />
            ))}
          </div>
        </div>
      )}

      <CharacterModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        campaignId={campaignId}
        characterId={selectedCharacterId}
        sessions={sessions}
      />
      {viewCharacterId && (
        <CharacterViewModal
          isOpen={!!viewCharacterId}
          onClose={handleViewModalClose}
          characterId={viewCharacterId}
          campaignId={campaignId}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete character"
          message={`Delete "${pendingDelete.firstName} ${pendingDelete.lastName}"? This cannot be undone.`}
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
