import { Globe, Lock, Link2 } from 'lucide-react';
import type { CalendarConfig } from '~/utils/calendarEngine';
import { formatDate } from '~/utils/calendarEngine';
import type { EventListItem } from '~/types/event';

interface EventListViewProps {
  cfg: CalendarConfig;
  events: EventListItem[];
  isGM: boolean;
  onSelect(e: EventListItem): void;
}

/** Group a sorted-by-startOrdinal list into year → monthIndex buckets
 *  without performing any date arithmetic — we preserve the incoming
 *  order and just read start.year / start.monthIndex. */
function groupEvents(events: EventListItem[]): Map<number, Map<number, EventListItem[]>> {
  const byYear = new Map<number, Map<number, EventListItem[]>>();
  for (const ev of events) {
    const { year, monthIndex } = ev.start;
    if (!byYear.has(year)) byYear.set(year, new Map());
    const byMonth = byYear.get(year)!;
    if (!byMonth.has(monthIndex)) byMonth.set(monthIndex, []);
    byMonth.get(monthIndex)!.push(ev);
  }
  return byYear;
}

export function EventListView({ cfg, events, isGM, onSelect }: EventListViewProps) {
  if (events.length === 0) {
    return (
      <div
        data-testid="event-list"
        className="flex flex-1 flex-col items-center justify-center p-8 text-center"
      >
        <p className="font-sans font-semibold text-xs text-slate-500">No events</p>
      </div>
    );
  }

  const grouped = groupEvents(events);
  // Preserve insertion order (which reflects startOrdinal sort from server)
  const years = Array.from(grouped.keys());

  return (
    <div data-testid="event-list" className="flex flex-col">
      {years.map((year) => {
        const byMonth = grouped.get(year)!;
        const monthIndices = Array.from(byMonth.keys());

        return (
          <div key={year}>
            {/* Year heading */}
            <div className="sticky top-0 z-10 px-4 py-1.5 bg-[#080A12] border-b border-white/[0.07]">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {year}
                {cfg.yearSuffix ? ` ${cfg.yearSuffix}` : ''}
              </span>
            </div>

            {monthIndices.map((monthIndex) => {
              const monthEvents = byMonth.get(monthIndex)!;
              const monthName = cfg.months[monthIndex]?.name ?? '';

              return (
                <div key={monthIndex}>
                  {/* Month sub-heading */}
                  <div className="px-4 py-1 border-b border-white/[0.04] bg-white/[0.01]">
                    <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                      {monthName}
                    </span>
                  </div>

                  {/* Event rows */}
                  {monthEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      data-testid="event-row"
                      data-event-id={ev.id}
                      onClick={() => onSelect(ev)}
                      className="flex items-start gap-3 w-full px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors text-left group"
                    >
                      {/* Color stripe */}
                      <div
                        className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                        style={{ backgroundColor: ev.color ?? '#3b82f6' }}
                      />

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        {/* Date range */}
                        <p className="text-[10px] text-slate-500 mb-0.5">
                          {formatDate(cfg, ev.start)}
                          {ev.end !== null && ` – ${formatDate(cfg, ev.end)}`}
                        </p>

                        {/* Title + badges row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
                            {ev.title}
                          </span>

                          {ev.isEpic && (
                            <span className="inline-flex items-center px-1.5 py-px rounded bg-amber-500/15 border border-amber-500/25 text-amber-400 font-bold text-[9px] uppercase tracking-tight shrink-0">
                              EPIC
                            </span>
                          )}

                          {isGM &&
                            (ev.isPublic ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 font-semibold text-[9px] shrink-0">
                                <Globe className="h-2.5 w-2.5" />
                                Public
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-red-500/15 border border-red-500/20 text-red-400 font-semibold text-[9px] shrink-0">
                                <Lock className="h-2.5 w-2.5" />
                                Private
                              </span>
                            ))}
                        </div>

                        {/* Tags */}
                        {ev.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {ev.tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-sans font-bold text-[9px] tracking-tight"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Link count */}
                      {ev.links.length > 0 && (
                        <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-slate-500 mt-0.5">
                          <Link2 className="h-3 w-3" />
                          {ev.links.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
