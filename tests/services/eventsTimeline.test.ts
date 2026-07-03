import { describe, it, expect } from 'vitest';
import { eventsToTimeline } from '~/services/eventsTimeline';
import { HARPTOS_CONFIG } from '~/utils/harptos';
import type { EventListItem } from '~/types/event';

const cfg = HARPTOS_CONFIG;
const base: EventListItem = {
  id: 'e1',
  campaignId: 'c',
  calendarId: 'cal',
  createdBy: 'u',
  title: 'Siege',
  content: 'A great siege',
  isPublic: true,
  isEpic: true,
  start: { year: 1491, monthIndex: 4, day: 11 },
  end: { year: 1491, monthIndex: 4, day: 12 },
  startOrdinal: 0,
  endOrdinal: 0,
  links: [],
  sessionId: null,
  images: [],
  tags: [],
  color: null,
  createdAt: '',
  updatedAt: '',
  canEdit: false,
};

describe('eventsToTimeline', () => {
  it('maps an epic event to a major TimelineEvent, newest first', () => {
    const older = { ...base, id: 'e0', start: { year: 1358, monthIndex: 0, day: 1 }, end: null };
    const out = eventsToTimeline(cfg, [base, older], { year: 1491, monthIndex: 4, day: 11 });
    expect(out[0].id).toBe('e1'); // newest first
    expect(out[0].importance).toBe('major');
    expect(out[0].calendarDate).toContain('Tarsakh');
    expect(out[0].isCurrent).toBe(true); // currentDate within the span
    expect(out[1].isCurrent).toBeUndefined();
  });
});
