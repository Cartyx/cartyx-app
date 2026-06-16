import { describe, it, expect } from 'vitest';
import {
  daysInMonth,
  daysInYear,
  toOrdinal,
  fromOrdinal,
  validateDate,
  compareDates,
  addDays,
  weekdayOf,
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

  it('fromOrdinal throws on a degenerate zero-length-year config', () => {
    const zeroCfg: CalendarConfig = {
      months: [{ name: 'Z', days: 0 }],
      weekdays: ['d1'],
      weekdayMode: 'continuous',
      epoch: { year: 1, weekdayIndex: 0 },
      leapDays: [],
    };
    expect(() => fromOrdinal(zeroCfg, 5)).toThrow();
  });
});

function daysInMonthHelper(year: number, m: number): number {
  return daysInMonth(cfg, year, m);
}

describe('validateDate', () => {
  it('accepts an in-range date', () => {
    expect(validateDate(cfg, { year: 1, monthIndex: 0, day: 30 }).ok).toBe(true);
  });
  it('rejects a day beyond the month length', () => {
    expect(validateDate(cfg, { year: 1, monthIndex: 0, day: 31 }).ok).toBe(false);
  });
  it('rejects an out-of-range month', () => {
    expect(validateDate(cfg, { year: 1, monthIndex: 9, day: 1 }).ok).toBe(false);
  });
  it('rejects a day in a zero-length (non-leap) month', () => {
    const z: CalendarConfig = {
      ...cfg,
      months: [
        { name: 'A', days: 30 },
        { name: 'Z', days: 0 },
      ],
    };
    expect(validateDate(z, { year: 1, monthIndex: 1, day: 1 }).ok).toBe(false);
  });
});

describe('compareDates / addDays', () => {
  it('orders dates', () => {
    expect(
      compareDates(cfg, { year: 1, monthIndex: 0, day: 1 }, { year: 1, monthIndex: 0, day: 2 })
    ).toBe(-1);
    expect(
      compareDates(cfg, { year: 2, monthIndex: 0, day: 1 }, { year: 1, monthIndex: 0, day: 1 })
    ).toBe(1);
  });
  it('adds days across a month boundary', () => {
    expect(addDays(cfg, { year: 1, monthIndex: 0, day: 30 }, 1)).toEqual({
      year: 1,
      monthIndex: 1,
      day: 1,
    });
  });
});

describe('weekdayOf', () => {
  it('continuous mode flows across months', () => {
    expect(weekdayOf(cfg, { year: 1, monthIndex: 0, day: 1 })).toBe(0);
    expect(weekdayOf(cfg, { year: 1, monthIndex: 0, day: 6 })).toBe(0); // 5-day week
  });
  it('resetEachMonth mode resets day 1 to weekday 0 and returns -1 for intercalary', () => {
    const r: CalendarConfig = {
      ...cfg,
      weekdayMode: 'resetEachMonth',
      months: [
        { name: 'A', days: 30 },
        { name: 'Fest', days: 1, isIntercalary: true },
      ],
    };
    expect(weekdayOf(r, { year: 1, monthIndex: 0, day: 1 })).toBe(0);
    expect(weekdayOf(r, { year: 1, monthIndex: 0, day: 7 })).toBe(1);
    expect(weekdayOf(r, { year: 1, monthIndex: 1, day: 1 })).toBe(-1);
  });
});
