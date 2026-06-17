import { useState, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { CalendarDays, List, LayoutGrid } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { CalendarGridView } from './CalendarGridView';
import { EventListView } from './EventListView';
import { EventViewModal } from './EventViewModal';
import { CalendarEditorModal } from './CalendarEditorModal';
import { useCalendar, useUpsertCalendar } from '~/hooks/useCalendar';
import { useEvents } from '~/hooks/useEvents';
import { useCampaign } from '~/hooks/useCampaigns';
import { HARPTOS_CONFIG } from '~/utils/harptos';
import type { CalendarConfig } from '~/utils/calendarEngine';
import type { CalDate } from '~/types/calendar';
import { calendarConfigFromData } from '~/types/calendar';

interface CalendarPanelProps {
  onBack: () => void;
}

export function CalendarPanel({ onBack }: CalendarPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const { calendar, isLoading } = useCalendar(campaignId);
  const { events } = useEvents(campaignId);
  const { save: saveCalendar, isLoading: isSaving } = useUpsertCalendar();

  const [view, setView] = useState<'list' | 'grid'>('list');
  const [cursor, setCursor] = useState<{ year: number; monthIndex: number } | null>(null);
  const [viewEventId, setViewEventId] = useState<string | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);

  // Reset cursor when the calendar identity or month count changes so a stale
  // cursor can't point past the end of the month array.
  useEffect(() => {
    setCursor(null);
  }, [calendar?.id, calendar?.months.length]);

  // Build CalendarConfig from CalendarData when available.
  const cfg: CalendarConfig | null = calendar ? calendarConfigFromData(calendar) : null;

  const handleHarptos = () => {
    const harptosCurrentDate: CalDate = { year: 1491, monthIndex: 6, day: 15 };
    saveCalendar({
      campaignId,
      name: 'Calendar of Harptos',
      description: '',
      namedYears: [],
      currentDate: harptosCurrentDate,
      months: HARPTOS_CONFIG.months,
      weekdays: HARPTOS_CONFIG.weekdays,
      weekdayMode: HARPTOS_CONFIG.weekdayMode,
      epoch: HARPTOS_CONFIG.epoch,
      yearSuffix: HARPTOS_CONFIG.yearSuffix ?? '',
      leapDays: HARPTOS_CONFIG.leapDays,
      moons: HARPTOS_CONFIG.moons ?? [],
      seasons: HARPTOS_CONFIG.seasons ?? [],
      holidays: HARPTOS_CONFIG.holidays ?? [],
    });
  };

  // Month navigation (index stepping only, no date arithmetic).
  const currentYear = cursor?.year ?? calendar?.currentDate.year ?? 1;
  const currentMonthIndex = cursor?.monthIndex ?? calendar?.currentDate.monthIndex ?? 0;
  const totalMonths = cfg?.months.length ?? 1;

  const handlePrev = () => {
    if (currentMonthIndex === 0) {
      setCursor({ year: currentYear - 1, monthIndex: totalMonths - 1 });
    } else {
      setCursor({ year: currentYear, monthIndex: currentMonthIndex - 1 });
    }
  };

  const handleNext = () => {
    if (currentMonthIndex >= totalMonths - 1) {
      setCursor({ year: currentYear + 1, monthIndex: 0 });
    } else {
      setCursor({ year: currentYear, monthIndex: currentMonthIndex + 1 });
    }
  };

  return (
    <div data-testid="calendar-panel" className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Calendar" onBack={onBack} />

      {/* View toggle + configure button row */}
      {calendar && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.07]">
          <button
            type="button"
            data-testid="calendar-view-toggle"
            onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-colors border border-white/[0.07]"
            aria-label={view === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          >
            {view === 'list' ? (
              <>
                <LayoutGrid className="h-3.5 w-3.5" />
                Grid
              </>
            ) : (
              <>
                <List className="h-3.5 w-3.5" />
                List
              </>
            )}
          </button>

          {isGM && (
            <button
              type="button"
              data-testid="calendar-configure-button"
              onClick={() => setEditorOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-colors border border-white/[0.07]"
            >
              Configure calendar
            </button>
          )}
        </div>
      )}

      {/* Main content area */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading calendar...
          </p>
        </div>
      ) : calendar === null ? (
        /* No calendar exists */
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center gap-4">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center">
            <CalendarDays className="h-6 w-6 text-slate-600" />
          </div>
          {isGM ? (
            <>
              <p className="font-sans font-semibold text-xs text-slate-500">
                No calendar has been set up yet.
              </p>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  className="w-full px-4 py-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 text-xs font-semibold transition-colors"
                >
                  Set up calendar
                </button>
                <button
                  type="button"
                  data-testid="calendar-harptos-button"
                  onClick={handleHarptos}
                  disabled={isSaving}
                  className="w-full px-4 py-2 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/30 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Saving...' : 'Use Calendar of Harptos'}
                </button>
              </div>
            </>
          ) : (
            <p className="font-sans font-semibold text-xs text-slate-500">
              The GM hasn't set up a calendar yet.
            </p>
          )}
        </div>
      ) : cfg ? (
        /* Calendar exists */
        <div className="flex-1 overflow-y-auto min-h-0">
          {view === 'list' ? (
            <EventListView
              cfg={cfg}
              events={events}
              isGM={isGM}
              onSelect={(e) => setViewEventId(e.id)}
            />
          ) : (
            <div className="p-3">
              <CalendarGridView
                cfg={cfg}
                year={currentYear}
                monthIndex={Math.min(Math.max(currentMonthIndex, 0), cfg.months.length - 1)}
                events={events}
                currentDate={calendar.currentDate}
                onPrev={handlePrev}
                onNext={handleNext}
                onSelectDay={() => {
                  /* no-op: day selection is a future enhancement */
                }}
              />
            </div>
          )}
        </div>
      ) : null}

      {/* Event view modal */}
      {viewEventId && (
        <EventViewModal
          isOpen={!!viewEventId}
          onClose={() => setViewEventId(undefined)}
          eventId={viewEventId}
          campaignId={campaignId}
        />
      )}

      {/* Calendar editor modal */}
      <CalendarEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        campaignId={campaignId}
        calendar={calendar}
      />
    </div>
  );
}
