import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Lock, X } from 'lucide-react';
import { LocationWindow } from './LocationWindow';
import { useLocation } from '~/hooks/useLocations';
import { useCampaign } from '~/hooks/useCampaigns';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';

interface LocationViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  locationId: string;
  campaignId: string;
}

export function LocationViewModal({
  isOpen,
  onClose,
  locationId,
  campaignId,
}: LocationViewModalProps) {
  const { location, isLoading } = useLocation(locationId, campaignId);
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
        aria-labelledby="location-view-modal-title"
        className="w-full max-w-lg max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {location &&
              (location.isPublic ? (
                <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
              ))}
            <h2
              id="location-view-modal-title"
              className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest truncate"
            >
              {location?.name ?? 'Location'}
              {location && (
                <span className="sr-only">{location.isPublic ? ' (Public)' : ' (Private)'}</span>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ShowOnTabletopButton
              campaignId={campaignId}
              collection="location"
              documentId={locationId}
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
              <p className="text-xs text-slate-500 animate-pulse">Loading location...</p>
            </div>
          ) : location ? (
            <LocationWindow location={location} />
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500">Location not found</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
