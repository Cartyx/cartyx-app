import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Dna } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { RaceCard } from './RaceCard';
import { RaceModal } from './RaceModal';
import { RaceViewModal } from './RaceViewModal';
import { useRaces } from '~/hooks/useRaces';
import { useCampaign } from '~/hooks/useCampaigns';
import type { RaceListItem } from '~/types/race';

interface RacesPanelProps {
  onBack: () => void;
}

export function RacesPanel({ onBack }: RacesPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);

  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRaceId, setSelectedRaceId] = useState<string | undefined>();
  const [viewRaceId, setViewRaceId] = useState<string | undefined>();

  const isGM = campaign?.isGM ?? false;

  const { races, isLoading, error } = useRaces(campaignId, {
    search: search || undefined,
    tags: filterTags.length > 0 ? filterTags : undefined,
  });

  const handleCreateClick = () => {
    setSelectedRaceId(undefined);
    setIsModalOpen(true);
  };

  const handleRaceClick = (race: RaceListItem) => {
    if (race.canEdit) {
      setSelectedRaceId(race.id);
      setIsModalOpen(true);
    } else {
      setViewRaceId(race.id);
    }
  };

  // The menu's Edit only renders when canEdit, so this always goes to the editor.
  const handleRaceEdit = (race: RaceListItem) => {
    setSelectedRaceId(race.id);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedRaceId(undefined);
  };

  const handleViewModalClose = () => {
    setViewRaceId(undefined);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Races" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        onCreateClick={isGM ? handleCreateClick : undefined}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search races..."
        showSessionFilter={false}
        showVisibilityFilter={false}
        visibility="all"
        onVisibilityChange={() => {}}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading races...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : races.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <Dna className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No races found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {races.map((race) => (
              <RaceCard
                key={race.id}
                race={race}
                onClick={handleRaceClick}
                onEdit={handleRaceEdit}
              />
            ))}
          </div>
        </div>
      )}

      {isGM && (
        <RaceModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          campaignId={campaignId}
          raceId={selectedRaceId}
        />
      )}
      {viewRaceId && (
        <RaceViewModal
          isOpen={!!viewRaceId}
          onClose={handleViewModalClose}
          raceId={viewRaceId}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
