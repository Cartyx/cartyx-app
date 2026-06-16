import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { PlayerWindow } from './PlayerWindow';
import { usePlayer } from '~/hooks/usePlayers';
import { useCampaign } from '~/hooks/useCampaigns';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';

interface PlayerViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerId: string;
  campaignId: string;
}

export function PlayerViewModal({ isOpen, onClose, playerId, campaignId }: PlayerViewModalProps) {
  const { player, isLoading } = usePlayer(playerId, campaignId);
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-view-modal-title"
        className="w-full max-w-lg max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              id="player-view-modal-title"
              className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest truncate"
            >
              {player ? `${player.firstName} ${player.lastName}`.trim() : 'Player'}
            </h2>
            {player?.link && (
              <a
                href={player.link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
                aria-label="External link"
              >
                <ExternalLink className="h-3.5 w-3.5 text-slate-500 hover:text-blue-400 transition-colors" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ShowOnTabletopButton
              campaignId={campaignId}
              collection="player"
              documentId={playerId}
              isGM={isGM}
            />
            <button
              type="button"
              onClick={onClose}
              className="text-slate-500 hover:text-white transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading player...</p>
            </div>
          ) : player ? (
            <PlayerWindow player={player} />
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500">Player not found</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
