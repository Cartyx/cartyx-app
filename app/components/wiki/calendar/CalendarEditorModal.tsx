// TODO(Task 16): real CalendarEditorModal
import type { CalendarData } from '~/types/calendar';

interface CalendarEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  calendar: CalendarData | null;
}

export function CalendarEditorModal(_props: CalendarEditorModalProps) {
  return null;
}
