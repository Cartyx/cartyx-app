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
