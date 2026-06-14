import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Skull } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { useCampaign } from '~/hooks/useCampaigns';
import { useMonsters } from '~/hooks/useMonsters';
import { MonsterCard } from './MonsterCard';
import { MonsterModal } from './MonsterModal';
import type { MonsterListItem } from '~/types/monster';

interface MonstersPanelProps {
  onBack: () => void;
}

export function MonstersPanel({ onBack }: MonstersPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [search, setSearch] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>(undefined);

  const {
    data: monsters = [],
    isLoading,
    error,
  } = useMonsters(campaignId, isGM, {
    search: search || undefined,
    tags: filterTags.length > 0 ? filterTags : undefined,
    sessionId: sessionId || undefined,
  });

  const handleCreate = () => {
    setEditId(undefined);
    setModalOpen(true);
  };

  const handleClick = (m: MonsterListItem) => {
    setEditId(m.id);
    setModalOpen(true);
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#080A12]">
      <WikiCategoryHeader title="Monsters" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        sessionId={sessionId}
        onSessionChange={setSessionId}
        sessions={campaign?.sessions}
        visibility="all"
        onVisibilityChange={() => {}}
        onCreateClick={handleCreate}
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search monsters..."
        showSessionFilter
        showVisibilityFilter={false}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans animate-pulse text-xs font-semibold text-slate-500">
            Loading monsters...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans text-xs font-semibold text-rose-400">
            {(error as Error).message}
          </p>
        </div>
      ) : monsters.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.03]">
            <Skull className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans text-xs font-semibold text-slate-500">No monsters yet.</p>
          <p className="font-sans mt-1 text-[11px] text-slate-600">
            Click <span className="text-slate-400">+ New</span> to add one. SRD bestiary import
            comes in Phase 2.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col">
            {monsters.map((m) => (
              <MonsterCard key={m.id} monster={m} onClick={handleClick} />
            ))}
          </div>
        </div>
      )}

      <MonsterModal
        isOpen={modalOpen}
        monsterId={editId}
        campaignId={campaignId}
        onClose={() => {
          setModalOpen(false);
          setEditId(undefined);
        }}
      />
    </div>
  );
}
