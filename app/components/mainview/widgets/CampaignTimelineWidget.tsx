import { useEffect, useState } from 'react';
import { Widget } from '~/components/mainview/Widget';
import { getTimelineEvents, type TimelineEvent } from '~/services/mocks/timelineService';
import { captureException } from '~/utils/telemetry-client';

export type { TimelineEvent };

export interface CampaignTimelineWidgetProps {
  // Timeline events are provided most-recent first; we render oldest -> newest
  // so the horizontal rail reads naturally from left to right.
  events?: ReadonlyArray<Readonly<TimelineEvent>>;
  className?: string;
}

function getEventTone(event: TimelineEvent) {
  if (event.isCurrent) return 'current';
  if (event.importance === 'major') return 'major';
  return 'normal';
}

function getToneClasses(tone: ReturnType<typeof getEventTone>) {
  const isCurrent = tone === 'current';
  const isMajor = tone === 'major';

  return {
    isCurrent,
    isMajor,
    dotClasses: isCurrent
      ? 'h-4 w-4 bg-primary ring-[12px] ring-primary/10 animate-pulse motion-reduce:animate-none'
      : isMajor
        ? 'h-4 w-4 bg-blue-light ring-8 ring-blue-light/10'
        : 'h-3 w-3 bg-slate-500 ring-4 ring-white/[0.05]',
    dateClasses: isCurrent ? 'text-primary' : isMajor ? 'text-blue-light' : 'text-slate-500',
    titleClasses: isCurrent ? 'text-white' : isMajor ? 'text-blue-light' : 'text-slate-500',
    labelClasses: isCurrent ? 'text-primary' : isMajor ? 'text-blue-light' : 'text-slate-600',
    summaryClasses: isCurrent || isMajor ? 'text-slate-300' : 'text-slate-400',
  };
}

function toDisplayOrder(events: ReadonlyArray<TimelineEvent>) {
  // Mock/service data is most-recent first; reverse it so the rail reads left-to-right.
  return [...events].reverse();
}

export function CampaignTimelineWidget({ events, className = '' }: CampaignTimelineWidgetProps) {
  const [resolvedEvents, setResolvedEvents] = useState<TimelineEvent[] | null>(
    events ? events.map((event) => ({ ...event })) : null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (events) {
      setResolvedEvents(events.map((event) => ({ ...event })));
      setError(null);
      return;
    }

    let isMounted = true;
    setError(null);

    void getTimelineEvents()
      .then((nextEvents) => {
        if (isMounted) {
          setResolvedEvents(nextEvents);
        }
      })
      .catch((error) => {
        captureException(error, { source: 'CampaignTimelineWidget.load' });
        if (isMounted) {
          setError('Unable to load timeline.');
          setResolvedEvents([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [events]);

  const displayEvents = resolvedEvents ? toDisplayOrder(resolvedEvents) : [];

  return (
    <Widget title="Campaign Timeline" className={className}>
      {resolvedEvents === null ? (
        <div className="flex items-center justify-center py-8">
          <p className="font-sans font-semibold text-xs text-slate-500">Loading timeline...</p>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-8">
          <p className="font-sans font-semibold text-xs text-rose-400">{error}</p>
        </div>
      ) : resolvedEvents.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <p className="font-sans font-semibold text-xs text-slate-500">No timeline events</p>
        </div>
      ) : (
        <>
          <div className="relative md:hidden" data-testid="timeline-vertical">
            <div
              aria-hidden="true"
              data-part="timeline-rail"
              className="absolute bottom-2 left-[0.6875rem] top-2 w-px bg-white/[0.08]"
            />

            <ol className="relative flex flex-col gap-6 pl-8">
              {displayEvents.map((event) => {
                const tone = getEventTone(event);
                const {
                  isCurrent,
                  isMajor,
                  dotClasses,
                  dateClasses,
                  titleClasses,
                  labelClasses,
                  summaryClasses,
                } = getToneClasses(tone);

                return (
                  <li
                    key={event.id}
                    data-layout="vertical"
                    data-tone={tone}
                    className="relative pl-4 text-left"
                  >
                    <span
                      aria-hidden="true"
                      data-part="timeline-marker"
                      className={`absolute left-0 top-1.5 z-10 -translate-x-1/2 rounded-full ${dotClasses}`}
                    />

                    <p
                      className={`font-sans font-semibold text-[0.6rem] tracking-[0.16em] ${dateClasses}`}
                    >
                      {event.calendarDate}
                    </p>

                    <h3
                      className={`mt-2 max-w-[13rem] font-sans text-xs font-bold uppercase leading-tight ${titleClasses}`}
                    >
                      {event.sessionName}
                    </h3>

                    {isCurrent ? (
                      <p
                        className={`mt-2 font-sans text-[0.5rem] font-bold tracking-[0.18em] ${labelClasses}`}
                      >
                        CURRENT SESSION
                      </p>
                    ) : isMajor ? (
                      <p
                        className={`mt-2 font-sans text-[0.5rem] font-bold tracking-[0.18em] ${labelClasses}`}
                      >
                        MAJOR EVENT
                      </p>
                    ) : null}

                    <p
                      className={`mt-2 max-w-[15rem] text-[0.58rem] leading-relaxed ${summaryClasses}`}
                      title={event.summary}
                    >
                      {event.summary}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>

          <div
            data-testid="timeline-scroll"
            className="relative hidden overflow-x-auto overflow-y-hidden pb-2 md:block"
            role="region"
            tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- intentional: keyboard users need tabIndex to scroll this horizontally-overflowing region with arrow keys
            aria-label="Campaign timeline, horizontally scrollable events"
          >
            <div className="relative min-w-[760px] px-4 pt-2">
              <div
                aria-hidden="true"
                data-part="timeline-rail"
                className="absolute left-4 right-4 top-16 z-0 h-px bg-white/[0.08]"
              />

              <ol className="grid grid-flow-col auto-cols-[minmax(10.5rem,1fr)] gap-4">
                {displayEvents.map((event) => {
                  const tone = getEventTone(event);
                  const {
                    isCurrent,
                    isMajor,
                    dotClasses,
                    dateClasses,
                    titleClasses,
                    labelClasses,
                    summaryClasses,
                  } = getToneClasses(tone);

                  return (
                    <li
                      key={event.id}
                      data-layout="horizontal"
                      data-tone={tone}
                      className="grid min-h-[12rem] grid-rows-[2.5rem_2rem_1fr] px-1 text-center"
                    >
                      <div className="flex items-end justify-center pb-3">
                        <p
                          className={`font-sans font-semibold text-[0.6rem] tracking-[0.16em] ${dateClasses}`}
                        >
                          {event.calendarDate}
                        </p>
                      </div>

                      <div
                        data-part="timeline-marker-row"
                        className="relative z-10 flex items-center justify-center"
                      >
                        <span
                          aria-hidden="true"
                          data-part="timeline-marker"
                          className={`rounded-full ${dotClasses}`}
                        />
                      </div>

                      <div className="flex flex-col items-center justify-start pt-3">
                        <h3
                          className={`max-w-[9rem] font-sans text-xs font-bold uppercase leading-tight ${titleClasses}`}
                        >
                          {event.sessionName}
                        </h3>

                        {isCurrent ? (
                          <p
                            className={`mt-2 font-sans text-[0.5rem] font-bold tracking-[0.18em] ${labelClasses}`}
                          >
                            CURRENT SESSION
                          </p>
                        ) : isMajor ? (
                          <p
                            className={`mt-2 font-sans text-[0.5rem] font-bold tracking-[0.18em] ${labelClasses}`}
                          >
                            MAJOR EVENT
                          </p>
                        ) : null}

                        <p
                          className={`mt-2 max-w-[9rem] text-[0.58rem] leading-relaxed line-clamp-3 ${summaryClasses}`}
                          title={event.summary}
                        >
                          {event.summary}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </>
      )}
    </Widget>
  );
}
