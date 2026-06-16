import { describe, it, expect } from 'vitest';
import {
  daysInMonth,
  daysInYear,
  toOrdinal,
  fromOrdinal,
  type CalendarConfig,
} from '~/utils/calendarEngine';

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

describe('toOrdinal / fromOrdinal', () => {
  it('epoch first day is ordinal 0', () => {
    expect(toOrdinal(cfg, { year: 1, monthIndex: 0, day: 1 })).toBe(0);
  });
  it('counts within a year', () => {
    expect(toOrdinal(cfg, { year: 1, monthIndex: 0, day: 2 })).toBe(1);
    expect(toOrdinal(cfg, { year: 1, monthIndex: 1, day: 1 })).toBe(30);
  });
  it('crosses a leap year boundary', () => {
    // year 1,2,3 are 60 days; year 4 (leap) is 61. Start of year 5:
    expect(toOrdinal(cfg, { year: 5, monthIndex: 0, day: 1 })).toBe(60 * 3 + 61);
  });
  it('handles negative ordinals (before epoch)', () => {
    // year 0 IS a leap year (0 % 4 === 0, offset=0) → 61 days; last day is monthIndex=1, day=31
    expect(toOrdinal(cfg, { year: 0, monthIndex: 1, day: 31 })).toBe(-1);
  });
  it('round-trips fromOrdinal(toOrdinal(d)) === d across many dates', () => {
    for (let year = -6; year <= 8; year++) {
      for (let m = 0; m < cfg.months.length; m++) {
        for (let day = 1; day <= daysInMonthHelper(year, m); day++) {
          const d = { year, monthIndex: m, day };
          expect(fromOrdinal(cfg, toOrdinal(cfg, d))).toEqual(d);
        }
      }
    }
  });
});

function daysInMonthHelper(year: number, m: number): number {
  // mirror engine for the loop bound
  const base = cfg.months[m]!.days;
  const leap = cfg.leapDays.some(
    (r) => r.monthIndex === m && (((year - r.offset) % r.interval) + r.interval) % r.interval === 0
  );
  return base + (leap ? 1 : 0);
}
