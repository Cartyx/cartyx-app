import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { UserCircle, Loader2 } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { PlayerCard } from './PlayerCard';
import { PlayerModal } from './PlayerModal';
import { usePlayers } from '~/hooks/usePlayers';

interface PlayersPanelProps {
  onBack: () => void;
}

export function PlayersPanel({ onBack }: PlayersPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const [search, setSearch] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const { players, isLoading, error } = usePlayers(campaignId, search || undefined);

  const handlePlayerClick = (playerId: string) => {
    setSelectedPlayerId(playerId);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Players" onBack={onBack} />

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/[0.05]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players..."
          className="w-full bg-white/[0.05] border border-white/[0.08] rounded px-3 py-1.5 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : players.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <UserCircle className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">No players found.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {players.map((player) => (
              <PlayerCard
                key={player.id}
                player={player}
                onClick={() => handlePlayerClick(player.id)}
                onEdit={() => handlePlayerClick(player.id)}
              />
            ))}
          </div>
        </div>
      )}
      {selectedPlayerId && (
        <PlayerModal
          campaignId={campaignId}
          playerId={selectedPlayerId}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}
