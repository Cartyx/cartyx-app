import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Map as MapIcon, Plus, Search } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { PixelButton } from '~/components/PixelButton';
import { useCampaign } from '~/hooks/useCampaigns';
import { useMapsList, useActiveMap, useMapsMutations } from '~/hooks/useMaps';
import { MapCard } from './MapCard';
import { MapUploadModal } from './MapUploadModal';
import type { MapListItem } from '~/types/map';

interface MapsPanelProps {
  onBack: () => void;
}

export function MapsPanel({ onBack }: MapsPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const { data: maps = [], isLoading, error } = useMapsList(campaignId);
  const { data: activeMap } = useActiveMap(campaignId);
  const { setActiveMap, deleteMap } = useMapsMutations(campaignId);

  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return maps;
    return maps.filter((m) => m.name.toLowerCase().includes(q));
  }, [maps, search]);

  const handleSetActive = (m: MapListItem) => {
    const next = activeMap?.id === m.id ? null : m.id;
    setActiveMap.mutate(next);
  };

  const handleDelete = (m: MapListItem) => {
    if (!confirm(`Delete map "${m.name}"? This cannot be undone.`)) return;
    deleteMap.mutate(m.id);
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#080A12]">
      <WikiCategoryHeader title="Maps" onBack={onBack} />

      <div className="flex items-center gap-2 border-b border-white/[0.07] bg-[#0D1117] p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search maps..."
            className="w-full rounded border border-white/[0.07] bg-[#080A12] py-1.5 pl-7 pr-2 font-sans text-xs text-slate-200 outline-none focus:border-blue-500/50"
            aria-label="Search maps"
          />
        </div>
        {isGM && (
          <PixelButton
            variant="primary"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setUploadOpen(true)}
          >
            Upload Map
          </PixelButton>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans animate-pulse text-xs font-semibold text-slate-500">
            Loading maps...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans text-xs font-semibold text-rose-400">
            {(error as Error).message}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.03]">
            <MapIcon className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans text-xs font-semibold text-slate-500">
            {search ? 'No maps match your search.' : 'No maps yet.'}
          </p>
          {isGM && !search && (
            <p className="font-sans mt-1 text-[11px] text-slate-600">
              Click <span className="text-slate-400">+ Upload Map</span> to add one.
            </p>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col">
            {filtered.map((m) => (
              <MapCard
                key={m.id}
                map={m}
                isGM={isGM}
                isActive={activeMap?.id === m.id}
                onSetActive={handleSetActive}
                onEdit={() => {
                  // Phase 1: edit modal deferred. Stub to no-op so menu still works.
                }}
                onDelete={handleDelete}
                onPreview={() => {
                  // Phase 1: preview deferred — clicking a card is a no-op for non-GMs;
                  // GMs use the menu.
                }}
              />
            ))}
          </div>
        </div>
      )}

      {isGM && (
        <MapUploadModal
          isOpen={uploadOpen}
          onClose={() => setUploadOpen(false)}
          campaignId={campaignId}
        />
      )}
    </div>
  );
}
