import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { LoreCard } from './LoreCard';
import { LoreModal } from './LoreModal';
import { LoreViewModal } from './LoreViewModal';
import { useLore } from '~/hooks/useLore';
import { useCampaign } from '~/hooks/useCampaigns';
import type { LoreListItem } from '~/types/lore';

interface LorePanelProps {
  onBack: () => void;
}

export function LorePanel({ onBack }: LorePanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLoreId, setSelectedLoreId] = useState<string | undefined>();
  const [viewLoreId, setViewLoreId] = useState<string | undefined>();

  const { lore, isLoading, error } = useLore(campaignId, {
    search: search || undefined,
    visibility,
    tags: filterTags.length > 0 ? filterTags : undefined,
  });

  const handleCreateClick = () => {
    setSelectedLoreId(undefined);
    setIsModalOpen(true);
  };

  const handleLoreClick = (item: LoreListItem) => {
    if (item.canEdit) {
      setSelectedLoreId(item.id);
      setIsModalOpen(true);
    } else {
      setViewLoreId(item.id);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedLoreId(undefined);
  };

  const handleViewModalClose = () => {
    setViewLoreId(undefined);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Lore" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onCreateClick={handleCreateClick}
        createButtonTestId="lore-create-button"
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search lore..."
        showSessionFilter={false}
        showVisibilityFilter={isGM}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading lore...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : lore.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <BookOpen className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No lore found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {lore.map((item) => (
              <LoreCard key={item.id} lore={item} onClick={handleLoreClick} />
            ))}
          </div>
        </div>
      )}

      <LoreModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        campaignId={campaignId}
        loreId={selectedLoreId}
      />
      {viewLoreId && (
        <LoreViewModal
          isOpen={!!viewLoreId}
          onClose={handleViewModalClose}
          loreId={viewLoreId}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
