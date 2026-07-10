import { EventWindow } from '~/components/wiki/calendar/EventWindow';
import { useEvent } from '~/hooks/useEvents';
import { useCalendar } from '~/hooks/useCalendar';
import { calendarConfigFromData } from '~/types/calendar';

export function EventWindowWrapper({
  eventId,
  campaignId,
}: {
  eventId: string;
  campaignId: string;
}) {
  const { event, isLoading } = useEvent(eventId, campaignId);
  const { calendar } = useCalendar(campaignId);

  const cfg = calendar ? calendarConfigFromData(calendar) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500 animate-pulse">Loading event...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-slate-500">Event not found</p>
      </div>
    );
  }

  return <EventWindow event={event} cfg={cfg} />;
}
