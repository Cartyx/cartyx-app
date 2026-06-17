import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Lock, X } from 'lucide-react';
import { EventWindow } from './EventWindow';
import { EventModal } from './EventModal';
import { useEvent } from '~/hooks/useEvents';
import { useCalendar } from '~/hooks/useCalendar';
import type { CalendarConfig } from '~/utils/calendarEngine';

interface EventViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  campaignId: string;
}

export function EventViewModal({ isOpen, onClose, eventId, campaignId }: EventViewModalProps) {
  const { event, isLoading: isLoadingEvent } = useEvent(eventId, campaignId);
  const { calendar, isLoading: isLoadingCalendar } = useCalendar(campaignId);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const isLoading = isLoadingEvent || isLoadingCalendar;

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Build a CalendarConfig from the calendar data when available.
  const cfg: CalendarConfig | null = calendar
    ? {
        months: calendar.months,
        weekdays: calendar.weekdays,
        weekdayMode: calendar.weekdayMode,
        epoch: calendar.epoch,
        leapDays: calendar.leapDays,
        yearSuffix: calendar.yearSuffix,
        moons: calendar.moons,
        seasons: calendar.seasons,
        holidays: calendar.holidays,
      }
    : null;

  return createPortal(
    <>
      <div
        role="presentation"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-view-modal-title"
          className="w-full max-w-lg max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        >
          <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {event &&
                (event.isPublic ? (
                  <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                ) : (
                  <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                ))}
              <h2
                id="event-view-modal-title"
                className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest truncate"
              >
                {event ? event.title : 'Event'}
                {event && (
                  <span className="sr-only">{event.isPublic ? ' (Public)' : ' (Private)'}</span>
                )}
              </h2>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="text-slate-500 hover:text-white transition-colors"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-xs text-slate-500 animate-pulse">Loading event...</p>
              </div>
            ) : event && cfg ? (
              <EventWindow
                event={event}
                cfg={cfg}
                onEdit={event.canEdit ? () => setIsEditOpen(true) : undefined}
              />
            ) : (
              <div className="flex items-center justify-center py-12">
                <p className="text-xs text-slate-500">Event not found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <EventModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        campaignId={campaignId}
        eventId={eventId}
      />
    </>,
    document.body
  );
}
