import { LocationWindow } from './LocationWindow';
import { LocationModal } from './LocationModal';
import { useLocation } from '~/hooks/useLocations';

export function LocationWindowWrapper({
  locationId,
  campaignId,
  isGM,
  onEdit,
  onOpenLocation,
}: {
  locationId: string;
  campaignId: string;
  isGM: boolean;
  onEdit: () => void;
  onOpenLocation?: (locationId: string) => void;
}) {
  const { location, isLoading } = useLocation(locationId, campaignId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500 animate-pulse">Loading location...</p>
      </div>
    );
  }

  if (!location) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500">Location not found</p>
      </div>
    );
  }

  return (
    <LocationWindow
      location={location}
      isGM={isGM}
      onEdit={onEdit}
      onOpenLocation={onOpenLocation}
    />
  );
}

export function EditLocationModalWrapper({
  campaignId,
  locationId,
  onClose,
}: {
  campaignId: string;
  locationId: string;
  onClose: () => void;
}) {
  return <LocationModal isOpen onClose={onClose} campaignId={campaignId} locationId={locationId} />;
}
