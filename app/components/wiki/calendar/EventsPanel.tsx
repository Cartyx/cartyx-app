import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { CalendarDays } from 'lucide-react';
import { WikiCategoryHeader } from '~/components/wiki/shared/WikiCategoryHeader';
import { WikiFilterBar } from '~/components/wiki/shared/WikiFilterBar';
import { EventCard } from './EventCard';
import { EventModal } from './EventModal';
import { useEvents } from '~/hooks/useEvents';
import { useCalendar } from '~/hooks/useCalendar';
import { useCampaign } from '~/hooks/useCampaigns';
import { calendarConfigFromData } from '~/types/calendar';
import type { EventListItem } from '~/types/event';

interface EventsPanelProps {
  onBack: () => void;
}

export function EventsPanel({ onBack }: EventsPanelProps) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [epicOnly, setEpicOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();

  const { calendar, isLoading: isLoadingCalendar } = useCalendar(campaignId);
  const cfg = calendar ? calendarConfigFromData(calendar) : null;

  const { events, isLoading, error } = useEvents(campaignId, {
    search: search || undefined,
    visibility,
    tags: filterTags.length > 0 ? filterTags : undefined,
    epicOnly: epicOnly || undefined,
  });

  const handleCreateClick = () => {
    setSelectedEventId(undefined);
    setIsModalOpen(true);
  };

  const handleEventClick = (item: EventListItem) => {
    if (item.canEdit) {
      setSelectedEventId(item.id);
      setIsModalOpen(true);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedEventId(undefined);
  };

  // When there's no calendar configured, show only the header + empty state.
  // Do NOT render the WikiFilterBar or EventModal—those require a calendar.
  if (isLoadingCalendar) {
    return (
      <div className="flex flex-col h-full w-full bg-[#080A12]">
        <WikiCategoryHeader title="Events" onBack={onBack} />
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading calendar...
          </p>
        </div>
      </div>
    );
  }

  if (!calendar) {
    return (
      <div className="flex flex-col h-full w-full bg-[#080A12]">
        <WikiCategoryHeader title="Events" onBack={onBack} />
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <CalendarDays className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500 mb-1">
            No calendar configured.
          </p>
          <p className="font-sans text-xs text-slate-600">
            Create a calendar first in the Calendar category.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#080A12]">
      <WikiCategoryHeader title="Events" onBack={onBack} />
      <WikiFilterBar
        search={search}
        onSearchChange={setSearch}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onCreateClick={handleCreateClick}
        createButtonTestId="event-create-button"
        campaignId={campaignId}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        searchPlaceholder="Search events..."
        showSessionFilter={false}
        showVisibilityFilter={isGM}
      />

      {/* Epic-only toggle — adjacent to the filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.07] bg-[#0D1117]">
        <button
          type="button"
          onClick={() => setEpicOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
            epicOnly
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20 hover:text-slate-300'
          }`}
          aria-pressed={epicOnly}
        >
          Epic only
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
            Loading events...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <CalendarDays className="h-6 w-6 text-slate-600" />
          </div>
          <p className="font-sans font-semibold text-xs text-slate-500">
            No events found matching your filters.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col">
            {events.map((item) => (
              <EventCard key={item.id} event={item} cfg={cfg!} onClick={handleEventClick} />
            ))}
          </div>
        </div>
      )}

      <EventModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        campaignId={campaignId}
        eventId={selectedEventId}
      />
    </div>
  );
}
