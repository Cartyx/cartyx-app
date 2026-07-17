import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { OrganizationWindow } from './OrganizationWindow';
import { useOrganization } from '~/hooks/useOrganizations';
import { useCampaign } from '~/hooks/useCampaigns';
import { ShowOnTabletopButton } from '~/components/wiki/shared/ShowOnTabletopButton';

interface OrganizationViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  campaignId: string;
}

export function OrganizationViewModal({
  isOpen,
  onClose,
  organizationId,
  campaignId,
}: OrganizationViewModalProps) {
  const { organization, isLoading } = useOrganization(organizationId, campaignId);
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="organization-view-modal-title"
        className="w-full max-w-lg max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="organization-view-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest truncate"
          >
            {organization?.name ?? 'Organization'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            <ShowOnTabletopButton
              campaignId={campaignId}
              collection="organization"
              documentId={organizationId}
              isGM={isGM}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="text-slate-500 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading organization...</p>
            </div>
          ) : organization ? (
            <OrganizationWindow organization={organization} />
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500">Organization not found</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
