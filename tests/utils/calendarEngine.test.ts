import { describe, it, expect } from 'vitest';
import { daysInMonth, daysInYear, type CalendarConfig } from '~/utils/calendarEngine';

// Minimal config: 2 months (30, 30), 5-day week, leap +1 to month 1 every 4 years.
const cfg: CalendarConfig = {
  months: [
    { name: 'Alpha', days: 30 },
    { name: 'Beta', days: 30 },
  ],
  weekdays: ['d1', 'd2', 'd3', 'd4', 'd5'],
  weekdayMode: 'continuous',
  epoch: { year: 1, weekdayIndex: 0 },
  leapDays: [{ name: 'Leap', monthIndex: 1, interval: 4, offset: 0, addDays: 1 }],
};

describe('daysInMonth / daysInYear', () => {
  it('returns base length in a non-leap year', () => {
    expect(daysInMonth(cfg, 1, 1)).toBe(30); // year 1 % 4 !== 0
    expect(daysInYear(cfg, 1)).toBe(60);
  });
  it('adds leap days in a matching year', () => {
    expect(daysInMonth(cfg, 4, 1)).toBe(31); // 4 % 4 === 0
    expect(daysInYear(cfg, 4)).toBe(61);
  });
  it('handles negative years for leap matching', () => {
    expect(daysInMonth(cfg, -4, 1)).toBe(31);
    expect(daysInMonth(cfg, -1, 1)).toBe(30);
  });
});
