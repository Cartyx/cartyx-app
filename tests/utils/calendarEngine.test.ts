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
  monthGrid,
  moonPhase,
  seasonOf,
  holidaysOn,
  formatDate,
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
  it('rejects a non-integer year', () => {
    expect(validateDate(cfg, { year: 1.5, monthIndex: 0, day: 1 }).ok).toBe(false);
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
  it('returns 0 for equal dates', () => {
    expect(
      compareDates(cfg, { year: 1, monthIndex: 0, day: 5 }, { year: 1, monthIndex: 0, day: 5 })
    ).toBe(0);
  });
  it('adds days across a month boundary', () => {
    expect(addDays(cfg, { year: 1, monthIndex: 0, day: 30 }, 1)).toEqual({
      year: 1,
      monthIndex: 1,
      day: 1,
    });
  });
  it('subtracts days across a month boundary (negative n)', () => {
    expect(addDays(cfg, { year: 1, monthIndex: 1, day: 1 }, -1)).toEqual({
      year: 1,
      monthIndex: 0,
      day: 30,
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

describe('monthGrid', () => {
  it('chunks days into week rows, padding the last row with null', () => {
    const grid = monthGrid(cfg, 1, 0); // 30 days, 5-day week, continuous, day1 weekday 0
    expect(grid.length).toBe(6);
    expect(grid[0]).toEqual([1, 2, 3, 4, 5]);
    expect(grid[5]).toEqual([26, 27, 28, 29, 30]);
  });
  it('adds leading blanks in continuous mode when day 1 is mid-week', () => {
    // epoch weekdayIndex:2 -> day 1 of year 1 (ordinal 0) is weekday 2 -> 2 leading nulls
    const off: CalendarConfig = { ...cfg, epoch: { year: 1, weekdayIndex: 2 } };
    const grid = monthGrid(off, 1, 0);
    expect(grid[0]!.slice(0, 2)).toEqual([null, null]);
    expect(grid[0]![2]).toBe(1);
  });
  it('pads the final row with trailing nulls when days do not fill a week', () => {
    // 31-day month, 5-day week, continuous, day1 weekday 0 -> last row [31, null, null, null, null]
    const c31: CalendarConfig = { ...cfg, months: [{ name: 'Long', days: 31 }] };
    const grid = monthGrid(c31, 1, 0);
    expect(grid[grid.length - 1]).toEqual([31, null, null, null, null]);
  });
});

describe('moonPhase / seasonOf / holidaysOn / formatDate', () => {
  const dcfg: CalendarConfig = {
    ...cfg,
    moons: [{ name: 'Luna', cycleLength: 10, offsetDays: 0 }],
    seasons: [
      { name: 'Cold', startMonthIndex: 0, startDay: 1 },
      { name: 'Warm', startMonthIndex: 1, startDay: 1 },
    ],
    holidays: [{ name: 'Feast', monthIndex: 0, day: 15 }],
    yearSuffix: 'DR',
  };
  it('moonPhase returns a 0..1 fraction', () => {
    expect(moonPhase(dcfg, dcfg.moons![0]!, 0)).toBeCloseTo(0, 5);
    expect(moonPhase(dcfg, dcfg.moons![0]!, 5)).toBeCloseTo(0.5, 5);
  });
  it('seasonOf picks the active season', () => {
    expect(seasonOf(dcfg, toOrdinal(dcfg, { year: 1, monthIndex: 0, day: 5 }))?.name).toBe('Cold');
    expect(seasonOf(dcfg, toOrdinal(dcfg, { year: 1, monthIndex: 1, day: 5 }))?.name).toBe('Warm');
  });
  it("seasonOf wraps the previous year's last season before the first season start", () => {
    const wrapCfg: CalendarConfig = {
      ...cfg,
      seasons: [
        { name: 'Spring', startMonthIndex: 0, startDay: 10 },
        { name: 'Autumn', startMonthIndex: 1, startDay: 10 },
      ],
    };
    // year 1, month 0, day 1 is before Spring's day-10 start -> should carry over Autumn (last season)
    expect(seasonOf(wrapCfg, toOrdinal(wrapCfg, { year: 1, monthIndex: 0, day: 1 }))?.name).toBe(
      'Autumn'
    );
    // and a date after Spring start but before Autumn is Spring
    expect(seasonOf(wrapCfg, toOrdinal(wrapCfg, { year: 1, monthIndex: 0, day: 15 }))?.name).toBe(
      'Spring'
    );
  });
  it('holidaysOn returns matching holidays', () => {
    expect(holidaysOn(dcfg, 1, 0, 15).map((h) => h.name)).toEqual(['Feast']);
    expect(holidaysOn(dcfg, 1, 0, 16)).toEqual([]);
  });
  it('formatDate renders normal vs intercalary', () => {
    expect(formatDate(dcfg, { year: 1482, monthIndex: 0, day: 11 })).toBe('11th Alpha, 1482 DR');
    const ic: CalendarConfig = {
      ...dcfg,
      months: [{ name: 'Midsummer', days: 1, isIntercalary: true }],
    };
    expect(formatDate(ic, { year: 1482, monthIndex: 0, day: 1 })).toBe('Midsummer, 1482 DR');
  });
});
