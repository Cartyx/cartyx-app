// TODO(Task 15): real EventModal
// Mirroring LoreModal props: isOpen, onClose, campaignId, eventId? (create vs edit)

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  eventId?: string;
}

export function EventModal(_props: EventModalProps) {
  return null;
}
