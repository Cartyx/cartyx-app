import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarConfig, CalDate } from '~/utils/calendarEngine';
import {
  monthGrid,
  toOrdinal,
  compareDates,
  holidaysOn,
  moonPhase,
  seasonOf,
} from '~/utils/calendarEngine';
import type { EventListItem } from '~/types/event';

interface CalendarGridViewProps {
  cfg: CalendarConfig;
  year: number;
  monthIndex: number;
  events: EventListItem[];
  currentDate: CalDate;
  onPrev(): void;
  onNext(): void;
  onSelectDay(date: CalDate): void;
}

/** Moon phase fraction → a compact unicode symbol. */
function moonSymbol(phase: number): string {
  if (phase < 0.0625) return '🌑';
  if (phase < 0.1875) return '🌒';
  if (phase < 0.3125) return '🌓';
  if (phase < 0.4375) return '🌔';
  if (phase < 0.5625) return '🌕';
  if (phase < 0.6875) return '🌖';
  if (phase < 0.8125) return '🌗';
  if (phase < 0.9375) return '🌘';
  return '🌑';
}

export function CalendarGridView({
  cfg,
  year,
  monthIndex,
  events,
  currentDate,
  onPrev,
  onNext,
  onSelectDay,
}: CalendarGridViewProps) {
  const month = cfg.months[monthIndex];
  const yearLabel = `${year}${cfg.yearSuffix ? ` ${cfg.yearSuffix}` : ''}`;
  const monthName = month?.name ?? '';

  // --- Navigation header (shared by both views) ---
  const header = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.07]">
      <button
        type="button"
        onClick={onPrev}
        className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-colors"
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-semibold text-slate-200">
        {monthName} <span className="text-slate-400 font-normal">{yearLabel}</span>
      </span>
      <button
        type="button"
        onClick={onNext}
        className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-colors"
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  // --- Intercalary: festival banner ---
  if (month?.isIntercalary) {
    const festivalEvents = events.filter(
      (ev) => ev.start.year === year && ev.start.monthIndex === monthIndex && ev.start.day === 1
    );
    return (
      <div
        data-testid="calendar-grid"
        className="flex flex-col bg-[#080A12] rounded-lg overflow-hidden border border-white/[0.07]"
      >
        {header}
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="h-16 w-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-1">
            <span className="text-2xl">✨</span>
          </div>
          <p className="text-base font-bold text-amber-300">{monthName}</p>
          <p className="text-xs text-slate-500">Festival day — {yearLabel}</p>
          {festivalEvents.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5 w-full max-w-xs">
              {festivalEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="px-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-slate-300 truncate"
                  style={ev.color ? { borderLeftColor: ev.color, borderLeftWidth: 3 } : undefined}
                >
                  {ev.title}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Regular grid ---
  const rows = monthGrid(cfg, year, monthIndex);

  // Footer info: use first day of month's ordinal
  const firstOrdinal = toOrdinal(cfg, { year, monthIndex, day: 1 });
  const season = seasonOf(cfg, firstOrdinal);
  const moons = cfg.moons ?? [];

  return (
    <div
      data-testid="calendar-grid"
      className="flex flex-col bg-[#080A12] rounded-lg overflow-hidden border border-white/[0.07]"
    >
      {header}

      {/* Weekday header row */}
      <div
        className="grid border-b border-white/[0.07]"
        style={{ gridTemplateColumns: `repeat(${cfg.weekdays.length}, minmax(0, 1fr))` }}
      >
        {cfg.weekdays.map((wd) => (
          <div
            key={wd}
            className="py-1.5 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider"
          >
            {wd.slice(0, 3)}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="flex-1">
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className="grid border-b border-white/[0.04] last:border-0"
            style={{ gridTemplateColumns: `repeat(${cfg.weekdays.length}, minmax(0, 1fr))` }}
          >
            {row.map((cell, colIdx) => {
              if (cell === null) {
                return (
                  <div
                    key={colIdx}
                    className="min-h-[56px] border-r border-white/[0.04] last:border-0 bg-black/[0.15]"
                  />
                );
              }

              const day = cell;
              const cellDate: CalDate = { year, monthIndex, day };
              const ord = toOrdinal(cfg, cellDate);
              const isToday = compareDates(cfg, cellDate, currentDate) === 0;
              const holidays = holidaysOn(cfg, year, monthIndex, day);
              const hasHoliday = holidays.length > 0;
              const holidayColor = holidays[0]?.color ?? null;

              const dayEvents = events.filter(
                (ev) => ev.startOrdinal <= ord && ord <= ev.endOrdinal
              );

              return (
                <button
                  key={colIdx}
                  type="button"
                  onClick={() => onSelectDay(cellDate)}
                  className={[
                    'min-h-[56px] p-1 border-r border-white/[0.04] last:border-0 text-left align-top transition-colors',
                    'hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50',
                    isToday ? 'bg-blue-500/10' : '',
                    hasHoliday && !isToday ? 'bg-amber-500/5' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={
                    hasHoliday && holidayColor
                      ? { boxShadow: `inset 0 2px 0 0 ${holidayColor}40` }
                      : undefined
                  }
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between mb-0.5">
                    <span
                      className={[
                        'inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-semibold',
                        isToday ? 'bg-blue-500 text-white' : 'text-slate-300',
                      ].join(' ')}
                    >
                      {day}
                    </span>
                    {hasHoliday && (
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: holidayColor ?? '#f59e0b' }}
                        title={holidays.map((h) => h.name).join(', ')}
                      />
                    )}
                  </div>

                  {/* Event chips */}
                  <div className="flex flex-col gap-px">
                    {dayEvents.slice(0, 3).map((ev) => {
                      const isMultiDay = ev.startOrdinal !== ev.endOrdinal;
                      return (
                        <div
                          key={ev.id}
                          className={[
                            'truncate text-[9px] leading-tight px-1 py-px rounded font-medium',
                            isMultiDay ? 'rounded-none px-1' : 'rounded',
                          ].join(' ')}
                          style={{
                            backgroundColor: ev.color ? `${ev.color}33` : 'rgba(59,130,246,0.2)',
                            color: ev.color ?? '#93c5fd',
                            borderLeft: isMultiDay ? `2px solid ${ev.color ?? '#3b82f6'}` : 'none',
                          }}
                          title={ev.title}
                        >
                          {ev.title}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <span className="text-[9px] text-slate-500 px-1">
                        +{dayEvents.length - 3}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer: season + moons */}
      {(season !== null || moons.length > 0) && (
        <div className="flex items-center gap-3 px-4 py-2 border-t border-white/[0.07] text-[11px] text-slate-500">
          {season !== null && (
            <span
              className="font-medium"
              style={season.color ? { color: season.color } : undefined}
            >
              {season.name}
            </span>
          )}
          {moons.map((moon) => {
            const phase = moonPhase(cfg, moon, firstOrdinal);
            return (
              <span key={moon.name} className="flex items-center gap-1" title={moon.name}>
                <span className="text-sm leading-none">{moonSymbol(phase)}</span>
                <span>{moon.name}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
