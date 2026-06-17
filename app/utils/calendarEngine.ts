export interface CalMonth {
  name: string;
  days: number;
  /** Festival/intercalary day: sits between months, outside the week cycle. */
  isIntercalary?: boolean;
}

export interface CalLeapRule {
  name: string;
  /** Index into `months` that the extra day(s) attach to. */
  monthIndex: number;
  /** Rule fires when ((year - offset) mod interval) === 0. interval >= 1. */
  interval: number;
  offset: number;
  addDays: number;
}

export interface CalMoon {
  name: string;
  cycleLength: number;
  offsetDays: number;
  color?: string;
}

export interface CalSeason {
  name: string;
  startMonthIndex: number;
  startDay: number;
  color?: string;
}

export interface CalHoliday {
  name: string;
  monthIndex: number;
  day: number;
  color?: string;
}

/** The subset of a Calendar the pure engine needs. */
export interface CalendarConfig {
  months: CalMonth[];
  weekdays: string[];
  weekdayMode: 'continuous' | 'resetEachMonth';
  /** Ordinal 0 === { year: epoch.year, monthIndex: 0, day: 1 }. */
  epoch: { year: number; weekdayIndex: number };
  leapDays: CalLeapRule[];
  yearSuffix?: string;
  moons?: CalMoon[];
  seasons?: CalSeason[];
  holidays?: CalHoliday[];
}

/** A human calendar date. `day` is 1-based; `monthIndex` is 0-based. */
export interface CalDate {
  year: number;
  monthIndex: number;
  day: number;
}

/** True modulo (always non-negative for positive m). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function leapRuleApplies(rule: CalLeapRule, year: number): boolean {
  if (rule.interval < 1) return false;
  return mod(year - rule.offset, rule.interval) === 0;
}

export function daysInMonth(cfg: CalendarConfig, year: number, monthIndex: number): number {
  const base = cfg.months[monthIndex]?.days ?? 0;
  let extra = 0;
  for (const rule of cfg.leapDays) {
    if (rule.monthIndex === monthIndex && leapRuleApplies(rule, year)) extra += rule.addDays;
  }
  return base + extra;
}

export function daysInYear(cfg: CalendarConfig, year: number): number {
  let total = 0;
  for (let m = 0; m < cfg.months.length; m++) total += daysInMonth(cfg, year, m);
  return total;
}

/** Signed day count from the epoch-year's first day to `year`'s first day. */
function yearStartOrdinal(cfg: CalendarConfig, year: number): number {
  let total = 0;
  if (year >= cfg.epoch.year) {
    for (let y = cfg.epoch.year; y < year; y++) total += daysInYear(cfg, y);
  } else {
    for (let y = year; y < cfg.epoch.year; y++) total -= daysInYear(cfg, y);
  }
  return total;
}

function daysBeforeMonth(cfg: CalendarConfig, year: number, monthIndex: number): number {
  let total = 0;
  for (let m = 0; m < monthIndex; m++) total += daysInMonth(cfg, year, m);
  return total;
}

export function toOrdinal(cfg: CalendarConfig, date: CalDate): number {
  return (
    yearStartOrdinal(cfg, date.year) +
    daysBeforeMonth(cfg, date.year, date.monthIndex) +
    (date.day - 1)
  );
}

export function fromOrdinal(cfg: CalendarConfig, ordinal: number): CalDate {
  // A calendar whose year has zero total days would make the walks below loop forever.
  if (daysInYear(cfg, cfg.epoch.year) <= 0) {
    throw new RangeError('Calendar has a zero-length year; cannot map ordinals to dates.');
  }
  let year = cfg.epoch.year;
  let rem = ordinal;
  if (rem >= 0) {
    while (rem >= daysInYear(cfg, year)) {
      rem -= daysInYear(cfg, year);
      year++;
    }
  } else {
    while (rem < 0) {
      year--;
      rem += daysInYear(cfg, year);
    }
  }
  // rem is now in [0, daysInYear(year)). Walk months; 0-length months are skipped.
  let monthIndex = 0;
  while (rem >= daysInMonth(cfg, year, monthIndex)) {
    rem -= daysInMonth(cfg, year, monthIndex);
    monthIndex++;
  }
  return { year, monthIndex, day: rem + 1 };
}

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

export function validateDate(cfg: CalendarConfig, date: CalDate): ValidateResult {
  if (!Number.isInteger(date.year)) {
    return { ok: false, error: 'Year must be an integer' };
  }
  if (
    !Number.isInteger(date.monthIndex) ||
    date.monthIndex < 0 ||
    date.monthIndex >= cfg.months.length
  ) {
    return { ok: false, error: 'Month is out of range' };
  }
  if (!Number.isInteger(date.day) || date.day < 1) {
    return { ok: false, error: 'Day must be 1 or greater' };
  }
  const dim = daysInMonth(cfg, date.year, date.monthIndex);
  if (date.day > dim) {
    return {
      ok: false,
      error: `Day ${date.day} exceeds ${dim} for ${cfg.months[date.monthIndex]!.name}`,
    };
  }
  return { ok: true };
}

export function compareDates(cfg: CalendarConfig, a: CalDate, b: CalDate): -1 | 0 | 1 {
  const d = toOrdinal(cfg, a) - toOrdinal(cfg, b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

export function addDays(cfg: CalendarConfig, date: CalDate, n: number): CalDate {
  return fromOrdinal(cfg, toOrdinal(cfg, date) + n);
}

/**
 * Weekday index, or -1 for intercalary days in resetEachMonth mode.
 * Precondition: cfg.weekdays is non-empty (enforced by the calendar schema).
 */
export function weekdayOf(cfg: CalendarConfig, date: CalDate): number {
  const w = cfg.weekdays.length;
  if (cfg.weekdayMode === 'resetEachMonth') {
    if (cfg.months[date.monthIndex]?.isIntercalary) return -1;
    return mod(date.day - 1, w);
  }
  return mod(cfg.epoch.weekdayIndex + toOrdinal(cfg, date), w);
}

/**
 * Rows of week-length cells; null = padding (leading/trailing blanks).
 * Not meaningful for isIntercalary months (those render as a single banner, not a grid).
 */
export function monthGrid(
  cfg: CalendarConfig,
  year: number,
  monthIndex: number
): (number | null)[][] {
  const total = daysInMonth(cfg, year, monthIndex);
  const w = cfg.weekdays.length;
  const lead =
    cfg.weekdayMode === 'continuous'
      ? mod(cfg.epoch.weekdayIndex + toOrdinal(cfg, { year, monthIndex, day: 1 }), w)
      : 0;
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % w !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += w) rows.push(cells.slice(i, i + w));
  return rows;
}

/** Phase as a 0..1 fraction (0 = new). Display-only. */
export function moonPhase(_cfg: CalendarConfig, moon: CalMoon, ordinal: number): number {
  return mod(ordinal - moon.offsetDays, moon.cycleLength) / moon.cycleLength;
}

/** The active season for an ordinal, or null if no seasons configured. */
export function seasonOf(cfg: CalendarConfig, ordinal: number): CalSeason | null {
  if (!cfg.seasons?.length) return null;
  const date = fromOrdinal(cfg, ordinal);
  // Start ordinal of each season within this date's year.
  const starts = cfg.seasons.map((s) => ({
    s,
    o: toOrdinal(cfg, { year: date.year, monthIndex: s.startMonthIndex, day: s.startDay }),
  }));
  starts.sort((a, b) => a.o - b.o);
  let active: CalSeason = starts[starts.length - 1]!.s; // wraps from previous year
  for (const { s, o } of starts) {
    if (ordinal >= o) active = s;
  }
  return active;
}

export function holidaysOn(
  cfg: CalendarConfig,
  _year: number,
  monthIndex: number,
  day: number
): CalHoliday[] {
  return (cfg.holidays ?? []).filter((h) => h.monthIndex === monthIndex && h.day === day);
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatDate(cfg: CalendarConfig, date: CalDate): string {
  const m = cfg.months[date.monthIndex];
  const yearLabel = `${date.year}${cfg.yearSuffix ? ` ${cfg.yearSuffix}` : ''}`;
  if (!m) return yearLabel;
  if (m.isIntercalary) return `${m.name}, ${yearLabel}`;
  return `${ordinalSuffix(date.day)} ${m.name}, ${yearLabel}`;
}
