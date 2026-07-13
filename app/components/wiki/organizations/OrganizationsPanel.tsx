import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { OrganizationCard } from './OrganizationCard';
import { OrganizationModal } from './OrganizationModal';
import { OrganizationViewModal } from './OrganizationViewModal';
import { useOrganizations } from '~/hooks/useOrganizations';
import { useLocations } from '~/hooks/useLocations';
import type { OrganizationListItem } from '~/types/organization';

interface OrganizationsPanelProps {
  onBack: () => void;
}

export function OrganizationsPanel({ onBack }: OrganizationsPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { locations } = useLocations(campaignId);

  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterLocationIds, setFilterLocationIds] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [viewId, setViewId] = useState<string | undefined>();

  const { organizations, isLoading, error } = useOrganizations(campaignId, {
    search: search || undefined,
    tags: filterTags.length > 0 ? filterTags : undefined,
    locationIds: filterLocationIds.length > 0 ? filterLocationIds : undefined,
  });

  const handleCreateClick = () => {
    setSelectedId(undefined);
    setIsModalOpen(true);
  };

  const handleClick = (org: OrganizationListItem) => {
    if (org.canEdit) {
      setSelectedId(org.id);
      setIsModalOpen(true);
    } else {
      setViewId(org.id);
    }
  };

  const toggleLocation = (id: string) => {
    setFilterLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Organizations" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        onCreateClick={handleCreateClick}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search organizations..."
        showSessionFilter={false}
        showVisibilityFilter={false}
        visibility="all"
        onVisibilityChange={() => {}}
      />

      {locations.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3 border-b border-white/[0.07] bg-[#0D1117]">
          {locations.map((loc) => {
            const active = filterLocationIds.includes(loc.id);
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => toggleLocation(loc.id)}
                aria-pressed={active}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${active ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:text-slate-300'}`}
              >
                {loc.name}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading organizations...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : organizations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <Building2 className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No organizations found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {organizations.map((org) => (
              <OrganizationCard key={org.id} organization={org} onClick={handleClick} />
            ))}
          </div>
        </div>
      )}

      <OrganizationModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedId(undefined);
        }}
        campaignId={campaignId}
        organizationId={selectedId}
      />
      {viewId && (
        <OrganizationViewModal
          isOpen={!!viewId}
          onClose={() => setViewId(undefined)}
          organizationId={viewId}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
