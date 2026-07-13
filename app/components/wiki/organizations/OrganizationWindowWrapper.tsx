import { OrganizationWindow } from './OrganizationWindow';
import { OrganizationModal } from './OrganizationModal';
import { useOrganization } from '~/hooks/useOrganizations';

export function EditOrganizationModalWrapper({
  campaignId,
  organizationId,
  onClose,
}: {
  campaignId: string;
  organizationId: string;
  onClose: () => void;
}) {
  return (
    <OrganizationModal
      isOpen
      onClose={onClose}
      campaignId={campaignId}
      organizationId={organizationId}
    />
  );
}

export function OrganizationWindowWrapper({
  organizationId,
  campaignId,
  onEdit,
}: {
  organizationId: string;
  campaignId: string;
  onEdit: () => void;
}) {
  const { organization, isLoading } = useOrganization(organizationId, campaignId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500 animate-pulse">Loading organization...</p>
      </div>
    );
  }
  if (!organization) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500">Organization not found</p>
      </div>
    );
  }
  return <OrganizationWindow organization={organization} onEdit={onEdit} />;
}
