import type { TimelineEvent } from '~/services/mocks/types';
import type { EventListItem } from '~/types/event';
import type { CalendarConfig, CalDate } from '~/utils/calendarEngine';
import { formatDate, toOrdinal } from '~/utils/calendarEngine';

export function eventsToTimeline(
  cfg: CalendarConfig,
  events: EventListItem[],
  currentDate: CalDate
): TimelineEvent[] {
  const cur = toOrdinal(cfg, currentDate);
  const withOrd = events.map((e) => ({
    e,
    startOrd: toOrdinal(cfg, e.start),
    endOrd: toOrdinal(cfg, e.end ?? e.start),
  }));
  withOrd.sort((a, b) => b.startOrd - a.startOrd); // newest first
  return withOrd.map(({ e, startOrd, endOrd }) => {
    const isCurrent = cur >= startOrd && cur <= endOrd;
    const evt: TimelineEvent = {
      id: e.id,
      calendarDate: formatDate(cfg, e.start),
      sessionName: e.title,
      summary: (e.content || '').slice(0, 160),
      importance: 'major',
    };
    if (isCurrent) evt.isCurrent = true;
    return evt;
  });
}
