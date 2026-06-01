import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { MapPin, Settings } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { LocationCard } from './LocationCard';
import { LocationModal } from './LocationModal';
import { LocationViewModal } from './LocationViewModal';
import { LocationTypeManager } from './LocationTypeManager';
import { useLocations } from '~/hooks/useLocations';
import { useLocationTypes } from '~/hooks/useLocationTypes';
import { useCampaign } from '~/hooks/useCampaigns';
import type { LocationListItem } from '~/types/location';

interface LocationsPanelProps {
  onBack: () => void;
}

export function LocationsPanel({ onBack }: LocationsPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterLocationType, setFilterLocationType] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | undefined>();
  const [viewLocationId, setViewLocationId] = useState<string | undefined>();
  const [showTypeManager, setShowTypeManager] = useState(false);

  const { locationTypes } = useLocationTypes(campaignId);

  const { locations, isLoading, error } = useLocations(campaignId, {
    search: search || undefined,
    visibility,
    locationType: filterLocationType || undefined,
    tags: filterTags.length > 0 ? filterTags : undefined,
  });

  const handleCreateClick = () => {
    setSelectedLocationId(undefined);
    setIsModalOpen(true);
  };

  const handleLocationClick = (location: LocationListItem) => {
    if (isGM) {
      setSelectedLocationId(location.id);
      setIsModalOpen(true);
    } else {
      setViewLocationId(location.id);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedLocationId(undefined);
  };

  const handleViewModalClose = () => {
    setViewLocationId(undefined);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Locations" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onCreateClick={isGM ? handleCreateClick : undefined}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search locations..."
        showSessionFilter={false}
        showVisibilityFilter={isGM}
      />

      {/* Location type filter + manage types */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.07] bg-[#0D1117]">
        <select
          value={filterLocationType}
          onChange={(e) => setFilterLocationType(e.target.value)}
          className="flex-1 bg-[#080A12] border border-white/[0.07] rounded px-2 py-1.5 font-sans font-semibold text-[11px] text-slate-300 outline-none focus:border-blue-500/50 transition-colors"
          aria-label="Filter by location type"
        >
          <option value="">All Types</option>
          {locationTypes.map((lt) => (
            <option key={lt.id} value={lt.name}>
              {lt.name}
            </option>
          ))}
        </select>
        {isGM && (
          <button
            type="button"
            onClick={() => setShowTypeManager(!showTypeManager)}
            className="flex items-center justify-center h-7 w-7 rounded bg-white/[0.03] hover:bg-white/[0.07] text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Manage location types"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showTypeManager && isGM && <LocationTypeManager campaignId={campaignId} />}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading locations...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : locations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <MapPin className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No locations found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {locations.map((location) => (
              <LocationCard key={location.id} location={location} onClick={handleLocationClick} />
            ))}
          </div>
        </div>
      )}

      {isGM && (
        <LocationModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          campaignId={campaignId}
          locationId={selectedLocationId}
        />
      )}
      {viewLocationId && (
        <LocationViewModal
          isOpen={!!viewLocationId}
          onClose={handleViewModalClose}
          locationId={viewLocationId}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
