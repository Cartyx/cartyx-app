# Calendars & Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GM-authored custom **Calendar** (Calendar of Harptos fidelity: custom months, tendays, named years, leap days, moons, seasons, holidays) and a dated **Event** datatype (public/GM text, links to characters/players/races/locations/lore/sessions, `isEpic`), surfaced through a calendar list/grid view for all members and a GM-only events manager — then rewire the dashboard epic timeline to read real epic events.

**Architecture:** All date arithmetic lives in ONE pure module, `app/utils/calendarEngine.ts` (no DB/React/IO), imported by client, server, and a Python port in the seed. Events store structured `{year,monthIndex,day}` dates as the source of truth plus denormalized integer ordinals for sorting; the server recomputes ordinals on every event write and re-validates all events when the calendar changes. Everything else mirrors the existing **Lore** vertical slice (model → schema → server fn → hook → wiki panel/card/modal).

**Tech Stack:** TanStack Start (`createServerFn` RPC), Mongoose/MongoDB, React + TanStack Query, Zod, Vitest (happy-dom, globals), Playwright e2e, Python (pymongo) seed, `@resvg/resvg-js` for seed images.

**Spec:** `docs/superpowers/specs/2026-06-16-calendars-and-events-design.md`

**Conventions (verified in repo):**
- `~` alias → `app/`. Server fns use `createServerFn({method}).inputValidator(zodSchema).handler(...)`.
- Permissions via `requireCampaignMember(campaignId) → { userId, sessionUserId, isGM }`.
- Mutations use `createMutationHook` from `~/hooks/createMutationHook`.
- Mongoose pluralizes models → collections `calendars`, `events`.
- Run a single unit test: `npm test -- tests/path/to/file.test.ts`. Full suite: `npm test`. Typecheck: `npm run typecheck`. Lint: `npm run lint`. Single e2e: `npx playwright test e2e/calendar/<file>.spec.ts`.
- Commits: the lefthook pre-commit `format` task fails to re-stage files under the gitignored `docs/superpowers/`; for commits that touch ONLY plan/spec docs use `git commit --no-verify`. Code commits run hooks normally.

---

## File Structure

**Create:**
- `app/utils/calendarEngine.ts` — pure date-math engine (the crux)
- `app/types/calendar.ts`, `app/types/event.ts` — shared TS types
- `app/types/schemas/calendars.ts`, `app/types/schemas/events.ts` — Zod schemas
- `app/server/db/models/Calendar.ts`, `app/server/db/models/Event.ts` — Mongoose models
- `app/server/functions/calendars.ts`, `app/server/functions/events.ts` — server fns
- `app/server/utils/pruneEventLinks.ts` — link pruning helper
- `app/hooks/useCalendar.ts`, `app/hooks/useEvents.ts` — query/mutation hooks
- `app/services/eventsTimeline.ts` — maps epic Events → `TimelineEvent[]`
- `app/components/wiki/calendar/` — `CalendarPanel.tsx`, `CalendarGridView.tsx`, `EventListView.tsx`, `CalendarEditorModal.tsx`, `EventsPanel.tsx`, `EventCard.tsx`, `EventModal.tsx`, `EventViewModal.tsx`, `EventWindow.tsx`, `EventLinksEditor.tsx`, `CalDatePicker.tsx`
- `app/components/mainview/gmscreens/EventWindowWrapper.tsx`
- `scripts/gen_seed_event_images.mjs` — event banner generator
- Tests: `tests/utils/calendarEngine.test.ts`, `tests/server/functions/calendars.test.ts`, `tests/server/functions/events.test.ts`, `tests/utils/calendarEngine.parity.test.ts`, `e2e/calendar/calendar-events.spec.ts`, `e2e/calendar/event-drag-drop.spec.ts`

**Modify:**
- `app/utils/queryKeys.ts` — add `calendar`, `events` keys
- `app/components/wiki/WikiPanel.tsx` — add Calendar (all) + Events (gmOnly) categories
- `app/server/functions/gmscreens.ts` — register `events` collection fetcher
- `app/server/functions/{characters,players,locations,races,lore}.ts` — call `pruneEventLinks` on delete
- `app/components/mainview/widgets/CampaignTimelineWidget.tsx` — read real epic events
- `scripts/dev_seed.py` — `build_calendar_doc`, `build_event_docs`, orchestration + a Python `to_ordinal` port
- `package.json` — add event image generator to the `dev:seed` chain
- `app/services/mocks/timelineService.ts` — leave as fallback; widget no longer depends on it for campaigns with events

---

# PHASE 1 — Calendar engine + types + schemas

The engine is pure and must be exhaustively tested BEFORE anything else uses it.

## Task 1: Engine types and leap/length math

**Files:**
- Create: `app/utils/calendarEngine.ts`
- Test: `tests/utils/calendarEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/utils/calendarEngine.test.ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: FAIL — `daysInMonth is not a function` / module not found.

- [ ] **Step 3: Implement the types + length math**

```typescript
// app/utils/calendarEngine.ts
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
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/calendarEngine.ts tests/utils/calendarEngine.test.ts
git commit -m "feat(calendar): engine length + leap math"
```

## Task 2: `toOrdinal` / `fromOrdinal` (exact inverses)

**Files:**
- Modify: `app/utils/calendarEngine.ts`
- Test: `tests/utils/calendarEngine.test.ts`

- [ ] **Step 1: Write the failing tests (incl. round-trip property)**

```typescript
// append to tests/utils/calendarEngine.test.ts
import { toOrdinal, fromOrdinal } from '~/utils/calendarEngine';

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
    // last day of year 0 (60 days) is ordinal -1
    expect(toOrdinal(cfg, { year: 0, monthIndex: 1, day: 30 })).toBe(-1);
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
    (r) => r.monthIndex === m && ((((year - r.offset) % r.interval) + r.interval) % r.interval) === 0
  );
  return base + (leap ? 1 : 0);
}
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: FAIL — `toOrdinal is not a function`.

- [ ] **Step 3: Implement**

```typescript
// append to app/utils/calendarEngine.ts

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
  return yearStartOrdinal(cfg, date.year) + daysBeforeMonth(cfg, date.year, date.monthIndex) + (date.day - 1);
}

export function fromOrdinal(cfg: CalendarConfig, ordinal: number): CalDate {
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
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/calendarEngine.ts tests/utils/calendarEngine.test.ts
git commit -m "feat(calendar): toOrdinal/fromOrdinal with round-trip tests"
```

## Task 3: `validateDate`, `compareDates`, `addDays`, `weekdayOf`

**Files:**
- Modify: `app/utils/calendarEngine.ts`
- Test: `tests/utils/calendarEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// append to tests/utils/calendarEngine.test.ts
import { validateDate, compareDates, addDays, weekdayOf } from '~/utils/calendarEngine';

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
    const z: CalendarConfig = { ...cfg, months: [{ name: 'A', days: 30 }, { name: 'Z', days: 0 }] };
    expect(validateDate(z, { year: 1, monthIndex: 1, day: 1 }).ok).toBe(false);
  });
});

describe('compareDates / addDays', () => {
  it('orders dates', () => {
    expect(compareDates(cfg, { year: 1, monthIndex: 0, day: 1 }, { year: 1, monthIndex: 0, day: 2 })).toBe(-1);
    expect(compareDates(cfg, { year: 2, monthIndex: 0, day: 1 }, { year: 1, monthIndex: 0, day: 1 })).toBe(1);
  });
  it('adds days across a month boundary', () => {
    expect(addDays(cfg, { year: 1, monthIndex: 0, day: 30 }, 1)).toEqual({ year: 1, monthIndex: 1, day: 1 });
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
      months: [{ name: 'A', days: 30 }, { name: 'Fest', days: 1, isIntercalary: true }],
    };
    expect(weekdayOf(r, { year: 1, monthIndex: 0, day: 1 })).toBe(0);
    expect(weekdayOf(r, { year: 1, monthIndex: 0, day: 7 })).toBe(1);
    expect(weekdayOf(r, { year: 1, monthIndex: 1, day: 1 })).toBe(-1);
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Implement**

```typescript
// append to app/utils/calendarEngine.ts
export interface ValidateResult {
  ok: boolean;
  error?: string;
}

export function validateDate(cfg: CalendarConfig, date: CalDate): ValidateResult {
  if (!Number.isInteger(date.monthIndex) || date.monthIndex < 0 || date.monthIndex >= cfg.months.length) {
    return { ok: false, error: 'Month is out of range' };
  }
  if (!Number.isInteger(date.day) || date.day < 1) {
    return { ok: false, error: 'Day must be 1 or greater' };
  }
  const dim = daysInMonth(cfg, date.year, date.monthIndex);
  if (date.day > dim) {
    return { ok: false, error: `Day ${date.day} exceeds ${dim} for ${cfg.months[date.monthIndex]!.name}` };
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

/** Weekday index, or -1 for intercalary days in resetEachMonth mode. */
export function weekdayOf(cfg: CalendarConfig, date: CalDate): number {
  const w = cfg.weekdays.length;
  if (cfg.weekdayMode === 'resetEachMonth') {
    if (cfg.months[date.monthIndex]?.isIntercalary) return -1;
    return mod(date.day - 1, w);
  }
  return mod(cfg.epoch.weekdayIndex + toOrdinal(cfg, date), w);
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/calendarEngine.ts tests/utils/calendarEngine.test.ts
git commit -m "feat(calendar): validateDate, compareDates, addDays, weekdayOf"
```

## Task 4: Display helpers — `monthGrid`, `moonPhase`, `seasonOf`, `holidaysOn`, `formatDate`

**Files:**
- Modify: `app/utils/calendarEngine.ts`
- Test: `tests/utils/calendarEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// append to tests/utils/calendarEngine.test.ts
import { monthGrid, moonPhase, seasonOf, holidaysOn, formatDate } from '~/utils/calendarEngine';

describe('monthGrid', () => {
  it('chunks days into week rows, padding the last row with null', () => {
    const grid = monthGrid(cfg, 1, 0); // 30 days, 5-day week, continuous, day1 weekday 0
    expect(grid.length).toBe(6);
    expect(grid[0]).toEqual([1, 2, 3, 4, 5]);
    expect(grid[5]).toEqual([26, 27, 28, 29, 30]);
  });
  it('adds leading blanks in continuous mode when day 1 is mid-week', () => {
    // month 1 of year 1 starts at ordinal 30 -> weekday 30 % 5 = 0; force offset
    const off: CalendarConfig = { ...cfg, epoch: { year: 1, weekdayIndex: 2 } };
    const grid = monthGrid(off, 1, 0);
    expect(grid[0]!.slice(0, 2)).toEqual([null, null]);
    expect(grid[0]![2]).toBe(1);
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
  it('holidaysOn returns matching holidays', () => {
    expect(holidaysOn(dcfg, 1, 0, 15).map((h) => h.name)).toEqual(['Feast']);
    expect(holidaysOn(dcfg, 1, 0, 16)).toEqual([]);
  });
  it('formatDate renders normal vs intercalary', () => {
    expect(formatDate(dcfg, { year: 1482, monthIndex: 0, day: 11 })).toBe('11th Alpha, 1482 DR');
    const ic: CalendarConfig = { ...dcfg, months: [{ name: 'Midsummer', days: 1, isIntercalary: true }] };
    expect(formatDate(ic, { year: 1482, monthIndex: 0, day: 1 })).toBe('Midsummer, 1482 DR');
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// append to app/utils/calendarEngine.ts

/** Rows of week-length cells; null = padding (leading/trailing blanks). */
export function monthGrid(cfg: CalendarConfig, year: number, monthIndex: number): (number | null)[][] {
  const total = daysInMonth(cfg, year, monthIndex);
  const w = cfg.weekdays.length;
  const lead =
    cfg.weekdayMode === 'continuous' ? mod(cfg.epoch.weekdayIndex + toOrdinal(cfg, { year, monthIndex, day: 1 }), w) : 0;
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

export function holidaysOn(cfg: CalendarConfig, _year: number, monthIndex: number, day: number): CalHoliday[] {
  return (cfg.holidays ?? []).filter((h) => h.monthIndex === monthIndex && h.day === day);
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function formatDate(cfg: CalendarConfig, date: CalDate): string {
  const m = cfg.months[date.monthIndex];
  const yearLabel = `${date.year}${cfg.yearSuffix ? ` ${cfg.yearSuffix}` : ''}`;
  if (!m) return yearLabel;
  if (m.isIntercalary) return `${m.name}, ${yearLabel}`;
  return `${ordinalSuffix(date.day)} ${m.name}, ${yearLabel}`;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/calendarEngine.ts tests/utils/calendarEngine.test.ts
git commit -m "feat(calendar): monthGrid, moonPhase, seasonOf, holidaysOn, formatDate"
```

## Task 5: Harptos-specific engine assertions

**Files:**
- Modify: `tests/utils/calendarEngine.test.ts`
- Create: `app/utils/harptos.ts` (the canonical Harptos config, reused by seed + a future "preset" button)

- [ ] **Step 1: Write the Harptos config + failing tests**

```typescript
// app/utils/harptos.ts
import type { CalendarConfig } from '~/utils/calendarEngine';

// 12 months x 30 days, 5 festivals as length-1 intercalary "months", Shieldmeet
// as a length-0 intercalary month that gains a day every 4 years. weekdayMode
// resetEachMonth: each month is three fresh 10-day tendays; festivals have no slot.
export const HARPTOS_MONTHS = [
  { name: 'Hammer', days: 30 },
  { name: 'Midwinter', days: 1, isIntercalary: true },
  { name: 'Alturiak', days: 30 },
  { name: 'Ches', days: 30 },
  { name: 'Tarsakh', days: 30 },
  { name: 'Greengrass', days: 1, isIntercalary: true },
  { name: 'Mirtul', days: 30 },
  { name: 'Kythorn', days: 30 },
  { name: 'Flamerule', days: 30 },
  { name: 'Midsummer', days: 1, isIntercalary: true },
  { name: 'Shieldmeet', days: 0, isIntercalary: true },
  { name: 'Eleasis', days: 30 },
  { name: 'Eleint', days: 30 },
  { name: 'Highharvestide', days: 1, isIntercalary: true },
  { name: 'Marpenoth', days: 30 },
  { name: 'Uktar', days: 30 },
  { name: 'The Feast of the Moon', days: 1, isIntercalary: true },
  { name: 'Nightal', days: 30 },
];

export const HARPTOS_CONFIG: CalendarConfig = {
  months: HARPTOS_MONTHS,
  weekdays: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'],
  weekdayMode: 'resetEachMonth',
  epoch: { year: 1372, weekdayIndex: 0 },
  leapDays: [{ name: 'Shieldmeet', monthIndex: 10, interval: 4, offset: 0, addDays: 1 }],
  yearSuffix: 'DR',
  moons: [{ name: 'Selûne', cycleLength: 30, offsetDays: 0 }],
  seasons: [
    { name: 'Winter', startMonthIndex: 0, startDay: 1 },
    { name: 'Spring', startMonthIndex: 3, startDay: 1 },
    { name: 'Summer', startMonthIndex: 8, startDay: 1 },
    { name: 'Autumn', startMonthIndex: 13, startDay: 1 },
  ],
  holidays: [],
};
```

```typescript
// append to tests/utils/calendarEngine.test.ts
import { HARPTOS_CONFIG } from '~/utils/harptos';

describe('Harptos', () => {
  it('a normal year has 365 days', () => {
    expect(daysInYear(HARPTOS_CONFIG, 1373)).toBe(365); // 1373 % 4 !== 0
  });
  it('a Shieldmeet year has 366 days', () => {
    expect(daysInYear(HARPTOS_CONFIG, 1372)).toBe(366); // 1372 % 4 === 0
  });
  it('Shieldmeet has no placeable day in a non-leap year', () => {
    expect(validateDate(HARPTOS_CONFIG, { year: 1373, monthIndex: 10, day: 1 }).ok).toBe(false);
  });
  it('Shieldmeet day 1 is valid in a leap year', () => {
    expect(validateDate(HARPTOS_CONFIG, { year: 1488, monthIndex: 10, day: 1 }).ok).toBe(true);
  });
  it('round-trips across a Shieldmeet year', () => {
    for (let m = 0; m < HARPTOS_CONFIG.months.length; m++) {
      for (let day = 1; day <= daysInMonth(HARPTOS_CONFIG, 1488, m); day++) {
        const d = { year: 1488, monthIndex: m, day };
        expect(fromOrdinal(HARPTOS_CONFIG, toOrdinal(HARPTOS_CONFIG, d))).toEqual(d);
      }
    }
  });
});
```

- [ ] **Step 2: Run and confirm fail, then pass (config already satisfies the engine)**

Run: `npm test -- tests/utils/calendarEngine.test.ts`
Expected: initially FAIL (missing `~/utils/harptos`); after creating the file, PASS.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/utils/harptos.ts tests/utils/calendarEngine.test.ts
git commit -m "feat(calendar): canonical Harptos config + engine assertions"
```

## Task 6: Shared TS types + Zod schemas

**Files:**
- Create: `app/types/calendar.ts`, `app/types/event.ts`, `app/types/schemas/calendars.ts`, `app/types/schemas/events.ts`

- [ ] **Step 1: Write the types**

```typescript
// app/types/calendar.ts
import type {
  CalMonth, CalLeapRule, CalMoon, CalSeason, CalHoliday, CalDate,
} from '~/utils/calendarEngine';

export type { CalMonth, CalLeapRule, CalMoon, CalSeason, CalHoliday, CalDate };

export interface CalendarData {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  description: string;
  months: CalMonth[];
  weekdays: string[];
  weekdayMode: 'continuous' | 'resetEachMonth';
  epoch: { year: number; weekdayIndex: number };
  yearSuffix: string;
  namedYears: { year: number; name: string }[];
  leapDays: CalLeapRule[];
  moons: CalMoon[];
  seasons: CalSeason[];
  holidays: CalHoliday[];
  currentDate: CalDate;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}
```

```typescript
// app/types/event.ts
import type { CalDate } from '~/utils/calendarEngine';

export type EventLinkKind = 'character' | 'player' | 'race' | 'location' | 'lore';

export interface EventLink {
  kind: EventLinkKind;
  id: string;
  label?: string;
}

export interface EventImage {
  url: string;
  caption: string;
  crop: { x: number; y: number; width: number; height: number } | null;
}

export interface EventData {
  id: string;
  campaignId: string;
  calendarId: string;
  createdBy: string;
  title: string;
  content: string;
  gmContent: string;
  isPublic: boolean;
  isEpic: boolean;
  start: CalDate;
  end: CalDate | null;
  startOrdinal: number;
  endOrdinal: number;
  links: EventLink[];
  sessionId: string | null;
  images: EventImage[];
  tags: string[];
  color: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export type EventListItem = Omit<EventData, 'gmContent'>;
```

- [ ] **Step 2: Write the Zod schemas**

```typescript
// app/types/schemas/calendars.ts
import { z } from 'zod';

const calDate = z.object({
  year: z.number().int(),
  monthIndex: z.number().int().min(0),
  day: z.number().int().min(0),
});

const month = z.object({
  name: z.string().trim().min(1),
  days: z.number().int().min(0),
  isIntercalary: z.boolean().optional(),
});

const leapRule = z.object({
  name: z.string().trim().min(1),
  monthIndex: z.number().int().min(0),
  interval: z.number().int().min(1),
  offset: z.number().int(),
  addDays: z.number().int().min(1),
});

const moon = z.object({
  name: z.string().trim().min(1),
  cycleLength: z.number().positive(),
  offsetDays: z.number(),
  color: z.string().optional(),
});

const season = z.object({
  name: z.string().trim().min(1),
  startMonthIndex: z.number().int().min(0),
  startDay: z.number().int().min(1),
  color: z.string().optional(),
});

const holiday = z.object({
  name: z.string().trim().min(1),
  monthIndex: z.number().int().min(0),
  day: z.number().int().min(1),
  color: z.string().optional(),
});

const calendarFields = {
  name: z.string().trim().min(1),
  description: z.string().default(''),
  months: z.array(month).min(1),
  weekdays: z.array(z.string().trim().min(1)).min(1),
  weekdayMode: z.enum(['continuous', 'resetEachMonth']).default('continuous'),
  epoch: z.object({ year: z.number().int(), weekdayIndex: z.number().int().min(0) }),
  yearSuffix: z.string().default(''),
  namedYears: z.array(z.object({ year: z.number().int(), name: z.string().trim().min(1) })).default([]),
  leapDays: z.array(leapRule).default([]),
  moons: z.array(moon).default([]),
  seasons: z.array(season).default([]),
  holidays: z.array(holiday).default([]),
  currentDate: calDate,
};

export const getCalendarSchema = z.object({ campaignId: z.string().trim().min(1) });
export const upsertCalendarSchema = z.object({ campaignId: z.string().trim().min(1), ...calendarFields });
export const setCurrentDateSchema = z.object({ campaignId: z.string().trim().min(1), currentDate: calDate });
export const deleteCalendarSchema = z.object({ campaignId: z.string().trim().min(1) });
```

```typescript
// app/types/schemas/events.ts
import { z } from 'zod';

const linkKind = z.enum(['character', 'player', 'race', 'location', 'lore']);
const eventLink = z.object({ kind: linkKind, id: z.string().trim().min(1) });
const calDate = z.object({
  year: z.number().int(),
  monthIndex: z.number().int().min(0),
  day: z.number().int().min(1),
});
const eventImage = z.object({
  url: z.string().trim().min(1),
  caption: z.string().trim().default(''),
  crop: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable()
    .default(null),
});

const eventFields = {
  title: z.string().trim().min(1),
  content: z.string().default(''),
  gmContent: z.string().default(''),
  isPublic: z.boolean().default(false),
  isEpic: z.boolean().default(false),
  start: calDate,
  end: calDate.nullable().default(null),
  links: z.array(eventLink).default([]),
  sessionId: z.string().trim().min(1).nullable().default(null),
  images: z.array(eventImage).default([]),
  tags: z.array(z.string()).default([]),
  color: z.string().trim().min(1).nullable().default(null),
};

export const listEventsSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().trim().optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['all', 'public', 'private']).optional(),
  epicOnly: z.boolean().optional(),
  linkedKind: linkKind.optional(),
  linkedId: z.string().trim().min(1).optional(),
});
export const getEventSchema = z.object({ id: z.string().trim().min(1), campaignId: z.string().trim().min(1) });
export const createEventSchema = z.object({ campaignId: z.string().trim().min(1), ...eventFields });
export const updateEventSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  ...eventFields,
});
export const deleteEventSchema = getEventSchema;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/types/calendar.ts app/types/event.ts app/types/schemas/calendars.ts app/types/schemas/events.ts
git commit -m "feat(calendar): shared types + zod schemas for calendar and events"
```

---

# PHASE 2 — DB models, server functions, hooks

## Task 7: Mongoose models

**Files:**
- Create: `app/server/db/models/Calendar.ts`, `app/server/db/models/Event.ts`

- [ ] **Step 1: Implement `Calendar.ts`** (mirrors `Lore.ts` sub-schema style)

```typescript
// app/server/db/models/Calendar.ts
import mongoose from 'mongoose';

const monthSchema = new mongoose.Schema(
  { name: { type: String, required: true }, days: { type: Number, required: true }, isIntercalary: { type: Boolean, default: false } },
  { _id: false }
);
const leapSchema = new mongoose.Schema(
  { name: String, monthIndex: Number, interval: Number, offset: Number, addDays: Number },
  { _id: false }
);
const moonSchema = new mongoose.Schema(
  { name: String, cycleLength: Number, offsetDays: Number, color: String },
  { _id: false }
);
const seasonSchema = new mongoose.Schema(
  { name: String, startMonthIndex: Number, startDay: Number, color: String },
  { _id: false }
);
const holidaySchema = new mongoose.Schema(
  { name: String, monthIndex: Number, day: Number, color: String },
  { _id: false }
);
const calDateSchema = new mongoose.Schema(
  { year: Number, monthIndex: Number, day: Number },
  { _id: false }
);

const calendarSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  months: { type: [monthSchema], default: [] },
  weekdays: { type: [String], default: [] },
  weekdayMode: { type: String, enum: ['continuous', 'resetEachMonth'], default: 'continuous' },
  epoch: { year: { type: Number, default: 1 }, weekdayIndex: { type: Number, default: 0 } },
  yearSuffix: { type: String, default: '' },
  namedYears: { type: [new mongoose.Schema({ year: Number, name: String }, { _id: false })], default: [] },
  leapDays: { type: [leapSchema], default: [] },
  moons: { type: [moonSchema], default: [] },
  seasons: { type: [seasonSchema], default: [] },
  holidays: { type: [holidaySchema], default: [] },
  currentDate: { type: calDateSchema, default: () => ({ year: 1, monthIndex: 0, day: 1 }) },
  campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

calendarSchema.pre('save', function () {
  this.updatedAt = new Date();
});

export const Calendar = mongoose.models.Calendar || mongoose.model('Calendar', calendarSchema);
```

- [ ] **Step 2: Implement `Event.ts`**

```typescript
// app/server/db/models/Event.ts
import mongoose from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const linkSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['character', 'player', 'race', 'location', 'lore'], required: true },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);
const cropSchema = new mongoose.Schema(
  { x: Number, y: Number, width: Number, height: Number },
  { _id: false }
);
const imageSchema = new mongoose.Schema(
  { url: { type: String, required: true }, caption: { type: String, default: '' }, crop: { type: cropSchema, default: null } },
  { _id: false }
);
const calDateSchema = new mongoose.Schema(
  { year: Number, monthIndex: Number, day: Number },
  { _id: false }
);

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: '' },
  gmContent: { type: String, default: '' },
  isPublic: { type: Boolean, default: false },
  isEpic: { type: Boolean, default: false },
  start: { type: calDateSchema, required: true },
  end: { type: calDateSchema, default: null },
  startOrdinal: { type: Number, required: true },
  endOrdinal: { type: Number, required: true },
  links: { type: [linkSchema], default: [] },
  sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  images: { type: [imageSchema], default: [] },
  tags: { type: [String], default: [] },
  color: { type: String, default: null },
  campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  calendarId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// istanbul ignore next
if (typeof (eventSchema as { index?: unknown }).index === 'function') {
  eventSchema.index({ campaignId: 1, startOrdinal: 1 });
  eventSchema.index({ isPublic: 1 });
  eventSchema.index({ isEpic: 1 });
  eventSchema.index({ 'links.id': 1 });
  eventSchema.index({ tags: 1 });
  eventSchema.index({ sessionId: 1 });
  eventSchema.index({ title: 'text', content: 'text' });
}

eventSchema.pre('save', function () {
  if (this.isModified('tags')) this.tags = normalizeTags(this.tags as string[]);
  this.updatedAt = new Date();
});

export const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add app/server/db/models/Calendar.ts app/server/db/models/Event.ts
git commit -m "feat(calendar): Calendar and Event mongoose models"
```

## Task 8: Calendar server functions (with edit re-validation transaction)

**Files:**
- Create: `app/server/functions/calendars.ts`
- Test: `tests/server/functions/calendars.test.ts`

- [ ] **Step 1: Write the failing test** (mirror the `lore.test.ts` mock harness exactly)

```typescript
// tests/server/functions/calendars.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ inputValidator: () => ({ handler: (fn: unknown) => fn }), handler: (fn: unknown) => fn }),
}));
vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/db/models/User', () => ({ User: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Campaign', () => ({ Campaign: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Calendar', () => ({
  Calendar: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('~/server/db/models/Event', () => ({ Event: { find: vi.fn(), bulkWrite: vi.fn() } }));
vi.mock('~/server/utils/posthog', () => ({ serverCaptureException: vi.fn(), serverCaptureEvent: vi.fn() }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Calendar } from '~/server/db/models/Calendar';
import { upsertCalendar, getCalendar } from '~/server/functions/calendars';

const session = { id: 'sess-1' } as never;
const gmCampaign = { _id: 'camp-1', gameMasterId: 'user-1', members: [{ userId: 'user-1', role: 'gm' }] };
const playerCampaign = { _id: 'camp-1', gameMasterId: 'gm-x', members: [{ userId: 'user-1', role: 'player' }] };

const _upsert = upsertCalendar as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown>;
const _get = getCalendar as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown>;

const baseInput = {
  campaignId: 'camp-1',
  name: 'Harptos',
  description: '',
  months: [{ name: 'A', days: 30 }],
  weekdays: ['d1'],
  weekdayMode: 'continuous',
  epoch: { year: 1, weekdayIndex: 0 },
  yearSuffix: 'DR',
  namedYears: [],
  leapDays: [],
  moons: [],
  seasons: [],
  holidays: [],
  currentDate: { year: 1, monthIndex: 0, day: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(User.findOne).mockResolvedValue({ _id: 'user-1' } as never);
  vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
});

describe('upsertCalendar', () => {
  it('forbids a non-GM from saving', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(_upsert({ data: baseInput })).rejects.toThrow('Forbidden');
  });
  it('upserts for a GM', async () => {
    vi.mocked(Calendar.findOneAndUpdate).mockResolvedValue({ _id: 'cal-1', ...baseInput } as never);
    vi.mocked((await import('~/server/db/models/Event')).Event.find).mockReturnValue({ lean: vi.fn().mockResolvedValue([]) } as never);
    const res = (await _upsert({ data: baseInput })) as Record<string, unknown>;
    expect(res.success).toBe(true);
  });
});

describe('getCalendar', () => {
  it('returns null when none exists', async () => {
    vi.mocked(Calendar.findOne).mockReturnValue({ lean: vi.fn().mockResolvedValue(null) } as never);
    expect(await _get({ data: { campaignId: 'camp-1' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm test -- tests/server/functions/calendars.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `calendars.ts`**

```typescript
// app/server/functions/calendars.ts
import { createServerFn } from '@tanstack/react-start';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { serverCaptureException } from '../utils/posthog';
import { Calendar } from '../db/models/Calendar';
import { Event } from '../db/models/Event';
import {
  getCalendarSchema, upsertCalendarSchema, setCurrentDateSchema, deleteCalendarSchema,
} from '~/types/schemas/calendars';
import type { CalendarData } from '~/types/calendar';
import { toOrdinal, validateDate, type CalendarConfig, type CalDate } from '~/utils/calendarEngine';

type AnyDoc = Record<string, unknown> & { _id: unknown };

function toConfig(doc: Record<string, unknown>): CalendarConfig {
  return {
    months: doc.months as CalendarConfig['months'],
    weekdays: doc.weekdays as string[],
    weekdayMode: doc.weekdayMode as CalendarConfig['weekdayMode'],
    epoch: doc.epoch as CalendarConfig['epoch'],
    yearSuffix: doc.yearSuffix as string,
    leapDays: doc.leapDays as CalendarConfig['leapDays'],
    moons: doc.moons as CalendarConfig['moons'],
    seasons: doc.seasons as CalendarConfig['seasons'],
    holidays: doc.holidays as CalendarConfig['holidays'],
  };
}

function serialize(doc: AnyDoc, canEdit: boolean): CalendarData {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    createdBy: String(doc.createdBy),
    name: (doc.name as string) ?? '',
    description: (doc.description as string) ?? '',
    months: (doc.months as CalendarData['months']) ?? [],
    weekdays: (doc.weekdays as string[]) ?? [],
    weekdayMode: (doc.weekdayMode as CalendarData['weekdayMode']) ?? 'continuous',
    epoch: (doc.epoch as CalendarData['epoch']) ?? { year: 1, weekdayIndex: 0 },
    yearSuffix: (doc.yearSuffix as string) ?? '',
    namedYears: (doc.namedYears as CalendarData['namedYears']) ?? [],
    leapDays: (doc.leapDays as CalendarData['leapDays']) ?? [],
    moons: (doc.moons as CalendarData['moons']) ?? [],
    seasons: (doc.seasons as CalendarData['seasons']) ?? [],
    holidays: (doc.holidays as CalendarData['holidays']) ?? [],
    currentDate: (doc.currentDate as CalDate) ?? { year: 1, monthIndex: 0, day: 1 },
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? '',
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? '',
    canEdit,
  };
}

export const getCalendar = createServerFn({ method: 'GET' })
  .inputValidator(getCalendarSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const doc = (await Calendar.findOne({ campaignId: data.campaignId }).lean()) as AnyDoc | null;
      if (!doc) return null;
      return serialize(doc, member.isGM);
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'getCalendar', campaignId: data.campaignId });
      throw e;
    }
  });

export const upsertCalendar = createServerFn({ method: 'POST' })
  .inputValidator(upsertCalendarSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      if (!member.isGM) throw new Error('Forbidden');

      const cfg = toConfig(data);
      const doc = (await Calendar.findOneAndUpdate(
        { campaignId: data.campaignId },
        {
          $set: {
            name: data.name, description: data.description, months: data.months,
            weekdays: data.weekdays, weekdayMode: data.weekdayMode, epoch: data.epoch,
            yearSuffix: data.yearSuffix, namedYears: data.namedYears, leapDays: data.leapDays,
            moons: data.moons, seasons: data.seasons, holidays: data.holidays,
            currentDate: data.currentDate, updatedAt: new Date(),
          },
          $setOnInsert: { campaignId: data.campaignId, createdBy: member.userId, createdAt: new Date() },
        },
        { new: true, upsert: true, lean: true }
      )) as AnyDoc;

      // Re-validate every event against the new config and recompute ordinals.
      const events = (await Event.find({ campaignId: data.campaignId }).lean()) as AnyDoc[];
      const invalidEventIds: string[] = [];
      const ops: Record<string, unknown>[] = [];
      for (const ev of events) {
        const start = ev.start as CalDate;
        const end = (ev.end as CalDate | null) ?? null;
        const startOk = validateDate(cfg, start).ok;
        const endOk = end ? validateDate(cfg, end).ok : true;
        if (!startOk || !endOk) {
          invalidEventIds.push(String(ev._id));
          continue;
        }
        ops.push({
          updateOne: {
            filter: { _id: ev._id },
            update: {
              $set: { startOrdinal: toOrdinal(cfg, start), endOrdinal: toOrdinal(cfg, end ?? start) },
            },
          },
        });
      }
      if (ops.length) await Event.bulkWrite(ops);

      return { success: true, calendar: serialize(doc, true), invalidEventIds };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'upsertCalendar', campaignId: data.campaignId });
      throw e;
    }
  });

export const setCurrentDate = createServerFn({ method: 'POST' })
  .inputValidator(setCurrentDateSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      if (!member.isGM) throw new Error('Forbidden');
      const doc = (await Calendar.findOneAndUpdate(
        { campaignId: data.campaignId },
        { $set: { currentDate: data.currentDate, updatedAt: new Date() } },
        { new: true, lean: true }
      )) as AnyDoc | null;
      if (!doc) throw new Error('Not found');
      return { success: true, calendar: serialize(doc, true) };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'setCurrentDate', campaignId: data.campaignId });
      throw e;
    }
  });

export const deleteCalendar = createServerFn({ method: 'POST' })
  .inputValidator(deleteCalendarSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      if (!member.isGM) throw new Error('Forbidden');
      await Calendar.deleteOne({ campaignId: data.campaignId });
      return { success: true };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'deleteCalendar', campaignId: data.campaignId });
      throw e;
    }
  });
```

- [ ] **Step 4: Run and confirm pass + typecheck**

Run: `npm test -- tests/server/functions/calendars.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/calendars.ts tests/server/functions/calendars.test.ts
git commit -m "feat(calendar): calendar server fns + edit re-validation transaction"
```

## Task 9: Event server functions (ordinal recompute + visibility + gmContent gating)

**Files:**
- Create: `app/server/functions/events.ts`
- Test: `tests/server/functions/events.test.ts`

- [ ] **Step 1: Write failing tests** (mirror `lore.test.ts`; add ordinal + GM-only assertions)

```typescript
// tests/server/functions/events.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ inputValidator: () => ({ handler: (fn: unknown) => fn }), handler: (fn: unknown) => fn }),
}));
vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/db/models/User', () => ({ User: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Campaign', () => ({ Campaign: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Calendar', () => ({ Calendar: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Event', () => ({
  Event: { find: vi.fn(), findById: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('~/server/functions/gmscreens-helpers', () => ({ removeDocumentRefsFromScreens: vi.fn() }));
vi.mock('~/server/utils/posthog', () => ({ serverCaptureException: vi.fn(), serverCaptureEvent: vi.fn() }));
vi.mock('~/server/db/models/Character', () => ({ Character: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Player', () => ({ Player: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Location', () => ({ Location: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { findById: vi.fn() } }));
vi.mock('~/server/db/models/Lore', () => ({ Lore: { findById: vi.fn() } }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Calendar } from '~/server/db/models/Calendar';
import { Event } from '~/server/db/models/Event';
import { listEvents, createEvent } from '~/server/functions/events';

const gmCampaign = { _id: 'camp-1', gameMasterId: 'user-1', members: [{ userId: 'user-1', role: 'gm' }] };
const playerCampaign = { _id: 'camp-1', gameMasterId: 'gm-x', members: [{ userId: 'user-1', role: 'player' }] };
const calDoc = {
  months: [{ name: 'A', days: 30 }], weekdays: ['d1'], weekdayMode: 'continuous',
  epoch: { year: 1, weekdayIndex: 0 }, yearSuffix: 'DR', leapDays: [], moons: [], seasons: [], holidays: [],
  _id: 'cal-1',
};

const _list = listEvents as unknown as (a: { data: Record<string, unknown> }) => Promise<unknown[]>;
const _create = createEvent as unknown as (a: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;

function mockEventFind(docs: unknown[]) {
  vi.mocked(Event.find).mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(docs) }) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 'sess-1' } as never);
  vi.mocked(User.findOne).mockResolvedValue({ _id: 'user-1' } as never);
  vi.mocked(Campaign.findById).mockResolvedValue(gmCampaign as never);
  vi.mocked(Calendar.findOne).mockReturnValue({ lean: vi.fn().mockResolvedValue(calDoc) } as never);
});

describe('listEvents', () => {
  it('restricts non-GM to public events', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    mockEventFind([]);
    await _list({ data: { campaignId: 'camp-1' } });
    const filter = vi.mocked(Event.find).mock.calls[0][0] as Record<string, unknown>;
    expect(filter.isPublic).toBe(true);
  });
  it('adds epicOnly filter', async () => {
    mockEventFind([]);
    await _list({ data: { campaignId: 'camp-1', epicOnly: true } });
    const filter = vi.mocked(Event.find).mock.calls[0][0] as Record<string, unknown>;
    expect(filter.isEpic).toBe(true);
  });
  it('never returns gmContent', async () => {
    mockEventFind([{ _id: 'e1', title: 'T', content: 'c', gmContent: 'secret', isPublic: true, isEpic: false, start: { year: 1, monthIndex: 0, day: 1 }, end: null, startOrdinal: 0, endOrdinal: 0, links: [], images: [], tags: [], campaignId: 'camp-1', calendarId: 'cal-1', createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date() }]);
    const res = (await _list({ data: { campaignId: 'camp-1' } })) as Record<string, unknown>[];
    expect(res[0]).not.toHaveProperty('gmContent');
  });
});

describe('createEvent', () => {
  it('forbids a non-GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(playerCampaign as never);
    await expect(_create({ data: { campaignId: 'camp-1', title: 'T', start: { year: 1, monthIndex: 0, day: 1 } } })).rejects.toThrow('Forbidden');
  });
  it('computes startOrdinal/endOrdinal from the calendar', async () => {
    vi.mocked(Event.create).mockImplementation(async (doc: Record<string, unknown>) => ({ _id: 'e1', ...doc }) as never);
    await _create({ data: { campaignId: 'camp-1', title: 'T', start: { year: 1, monthIndex: 0, day: 2 }, end: null } });
    const arg = vi.mocked(Event.create).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.startOrdinal).toBe(1);
    expect(arg.endOrdinal).toBe(1);
  });
  it('rejects an out-of-range date', async () => {
    await expect(_create({ data: { campaignId: 'camp-1', title: 'T', start: { year: 1, monthIndex: 0, day: 99 } } })).rejects.toThrow(/Day/);
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm test -- tests/server/functions/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `events.ts`**

```typescript
// app/server/functions/events.ts
import { createServerFn } from '@tanstack/react-start';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { serverCaptureException } from '../utils/posthog';
import { Event } from '../db/models/Event';
import { Calendar } from '../db/models/Calendar';
import { Character } from '../db/models/Character';
import { Player } from '../db/models/Player';
import { Location } from '../db/models/Location';
import { Race } from '../db/models/Race';
import { Lore } from '../db/models/Lore';
import {
  listEventsSchema, getEventSchema, createEventSchema, updateEventSchema, deleteEventSchema,
} from '~/types/schemas/events';
import type { EventData, EventLink, EventListItem } from '~/types/event';
import { toOrdinal, validateDate, type CalendarConfig, type CalDate } from '~/utils/calendarEngine';

type AnyDoc = Record<string, unknown> & { _id: unknown };

async function loadConfig(campaignId: string): Promise<CalendarConfig> {
  const cal = (await Calendar.findOne({ campaignId }).lean()) as AnyDoc | null;
  if (!cal) throw new Error('No calendar exists for this campaign. Create one first.');
  return {
    months: cal.months as CalendarConfig['months'],
    weekdays: cal.weekdays as string[],
    weekdayMode: cal.weekdayMode as CalendarConfig['weekdayMode'],
    epoch: cal.epoch as CalendarConfig['epoch'],
    yearSuffix: cal.yearSuffix as string,
    leapDays: cal.leapDays as CalendarConfig['leapDays'],
    moons: cal.moons as CalendarConfig['moons'],
    seasons: cal.seasons as CalendarConfig['seasons'],
    holidays: cal.holidays as CalendarConfig['holidays'],
  };
}

function baseSerialize(doc: AnyDoc) {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    calendarId: String(doc.calendarId),
    createdBy: String(doc.createdBy),
    title: (doc.title as string) ?? '',
    content: (doc.content as string) ?? '',
    isPublic: Boolean(doc.isPublic),
    isEpic: Boolean(doc.isEpic),
    start: doc.start as CalDate,
    end: (doc.end as CalDate | null) ?? null,
    startOrdinal: Number(doc.startOrdinal ?? 0),
    endOrdinal: Number(doc.endOrdinal ?? 0),
    links: ((doc.links as unknown[]) ?? []).map((l) => {
      const lk = l as Record<string, unknown>;
      return { kind: lk.kind as EventLink['kind'], id: String(lk.id) };
    }) as EventLink[],
    sessionId: doc.sessionId ? String(doc.sessionId) : null,
    images: ((doc.images as unknown[]) ?? []).map((i) => {
      const img = i as Record<string, unknown>;
      return { url: String(img.url), caption: (img.caption as string) ?? '', crop: (img.crop as EventData['images'][number]['crop']) ?? null };
    }),
    tags: (doc.tags as string[]) ?? [],
    color: (doc.color as string | null) ?? null,
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? '',
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? '',
  };
}

async function resolveLinkLabels(links: EventLink[]): Promise<EventLink[]> {
  return Promise.all(
    links.map(async (link) => {
      let label = '';
      try {
        if (link.kind === 'character') {
          const c = (await Character.findById(link.id, 'firstName lastName').lean()) as AnyDoc | null;
          if (c) label = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
        } else if (link.kind === 'player') {
          const p = (await Player.findById(link.id, 'firstName lastName').lean()) as AnyDoc | null;
          if (p) label = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
        } else if (link.kind === 'location') {
          const loc = (await Location.findById(link.id, 'name').lean()) as AnyDoc | null;
          if (loc) label = String(loc.name ?? '');
        } else if (link.kind === 'race') {
          const r = (await Race.findById(link.id, 'title').lean()) as AnyDoc | null;
          if (r) label = String(r.title ?? '');
        } else if (link.kind === 'lore') {
          const l = (await Lore.findById(link.id, 'title').lean()) as AnyDoc | null;
          if (l) label = String(l.title ?? '');
        }
      } catch {
        label = '';
      }
      return { ...link, label };
    })
  );
}

export const listEvents = createServerFn({ method: 'GET' })
  .inputValidator(listEventsSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const filter: Record<string, unknown> = { campaignId: data.campaignId };
      if (!member.isGM) filter.isPublic = true;
      else if (data.visibility === 'public') filter.isPublic = true;
      else if (data.visibility === 'private') filter.isPublic = false;
      if (data.epicOnly) filter.isEpic = true;
      if (data.tags?.length) filter.tags = { $all: data.tags };
      if (data.search) filter.$text = { $search: data.search };
      if (data.linkedKind && data.linkedId) filter.links = { $elemMatch: { kind: data.linkedKind, id: data.linkedId } };

      const docs = (await Event.find(filter).sort({ startOrdinal: 1 }).lean()) as AnyDoc[];
      const items: EventListItem[] = docs.map((doc) => ({
        ...baseSerialize(doc),
        canEdit: member.isGM,
      }));
      return items;
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'listEvents', campaignId: data.campaignId });
      throw e;
    }
  });

export const getEvent = createServerFn({ method: 'GET' })
  .inputValidator(getEventSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      const doc = (await Event.findById(data.id).lean()) as AnyDoc | null;
      if (!doc || String(doc.campaignId) !== data.campaignId) return null;
      if (!member.isGM && !doc.isPublic) return null;
      const links = await resolveLinkLabels(
        ((doc.links as unknown[]) ?? []).map((l) => {
          const lk = l as Record<string, unknown>;
          return { kind: lk.kind as EventLink['kind'], id: String(lk.id) };
        })
      );
      const result: EventData = {
        ...baseSerialize(doc),
        gmContent: member.isGM ? ((doc.gmContent as string) ?? '') : '',
        links,
        canEdit: member.isGM,
      };
      return result;
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'getEvent', eventId: data.id });
      throw e;
    }
  });

export const createEvent = createServerFn({ method: 'POST' })
  .inputValidator(createEventSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      if (!member.isGM) throw new Error('Forbidden');
      const cfg = await loadConfig(data.campaignId);
      const cal = (await Calendar.findOne({ campaignId: data.campaignId }, '_id').lean()) as AnyDoc;
      const sv = validateDate(cfg, data.start);
      if (!sv.ok) throw new Error(sv.error);
      if (data.end) {
        const ev = validateDate(cfg, data.end);
        if (!ev.ok) throw new Error(ev.error);
      }
      const doc = (await Event.create({
        title: data.title, content: data.content, gmContent: data.gmContent,
        isPublic: data.isPublic, isEpic: data.isEpic,
        start: data.start, end: data.end,
        startOrdinal: toOrdinal(cfg, data.start),
        endOrdinal: toOrdinal(cfg, data.end ?? data.start),
        links: data.links, sessionId: data.sessionId, images: data.images, tags: data.tags, color: data.color,
        campaignId: data.campaignId, calendarId: cal._id, createdBy: member.userId,
      })) as AnyDoc;
      return { success: true, event: { ...baseSerialize(doc), gmContent: data.gmContent, canEdit: true } };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'createEvent', campaignId: data.campaignId });
      throw e;
    }
  });

export const updateEvent = createServerFn({ method: 'POST' })
  .inputValidator(updateEventSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      if (!member.isGM) throw new Error('Forbidden');
      const existing = (await Event.findById(data.id).lean()) as AnyDoc | null;
      if (!existing || String(existing.campaignId) !== data.campaignId) throw new Error('Not found');
      const cfg = await loadConfig(data.campaignId);
      const sv = validateDate(cfg, data.start);
      if (!sv.ok) throw new Error(sv.error);
      if (data.end) {
        const ev = validateDate(cfg, data.end);
        if (!ev.ok) throw new Error(ev.error);
      }
      const updated = (await Event.findOneAndUpdate(
        { _id: data.id, campaignId: data.campaignId },
        {
          $set: {
            title: data.title, content: data.content, gmContent: data.gmContent,
            isPublic: data.isPublic, isEpic: data.isEpic, start: data.start, end: data.end,
            startOrdinal: toOrdinal(cfg, data.start), endOrdinal: toOrdinal(cfg, data.end ?? data.start),
            links: data.links, sessionId: data.sessionId, images: data.images, tags: data.tags, color: data.color,
            updatedAt: new Date(),
          },
        },
        { new: true, lean: true }
      )) as AnyDoc;
      return { success: true, event: { ...baseSerialize(updated), gmContent: data.gmContent, canEdit: true } };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'updateEvent', eventId: data.id });
      throw e;
    }
  });

export const deleteEvent = createServerFn({ method: 'POST' })
  .inputValidator(deleteEventSchema)
  .handler(async ({ data }) => {
    try {
      const member = await requireCampaignMember(data.campaignId);
      if (!member.isGM) throw new Error('Forbidden');
      const existing = (await Event.findById(data.id).lean()) as AnyDoc | null;
      if (!existing || String(existing.campaignId) !== data.campaignId) throw new Error('Not found');
      await Event.deleteOne({ _id: data.id, campaignId: data.campaignId });
      await removeDocumentRefsFromScreens(data.campaignId, 'events', data.id);
      return { success: true };
    } catch (e) {
      serverCaptureException(e, undefined, { action: 'deleteEvent', eventId: data.id });
      throw e;
    }
  });
```

- [ ] **Step 4: Run and confirm pass + typecheck**

Run: `npm test -- tests/server/functions/events.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/server/functions/events.ts tests/server/functions/events.test.ts
git commit -m "feat(calendar): event server fns with ordinal recompute + visibility gating"
```

## Task 10: Link pruning + gmscreens registration + query keys

**Files:**
- Create: `app/server/utils/pruneEventLinks.ts`
- Modify: `app/server/functions/{characters,players,locations,races,lore}.ts`, `app/server/functions/gmscreens.ts`, `app/utils/queryKeys.ts`

- [ ] **Step 1: Create `pruneEventLinks.ts`**

```typescript
// app/server/utils/pruneEventLinks.ts
import { Event } from '../db/models/Event';
import type { EventLinkKind } from '~/types/event';

/** Remove any event links pointing at a deleted entity so chips don't dangle. */
export async function pruneEventLinks(kind: EventLinkKind, id: string, campaignId: string) {
  await Event.updateMany({ campaignId, 'links.id': id }, { $pull: { links: { kind, id } } });
}
```

- [ ] **Step 2: Add a `pruneEventLinks` call beside each existing `pruneLoreLinks` call**

In `app/server/functions/locations.ts`, immediately after `await pruneLoreLinks('location', data.id, data.campaignId);` add:
```typescript
      await pruneEventLinks('location', data.id, data.campaignId);
```
And add the import at the top: `import { pruneEventLinks } from '../utils/pruneEventLinks';`

Repeat the same pattern (matching `kind`) in:
- `app/server/functions/characters.ts` → `await pruneEventLinks('character', data.id, data.campaignId);`
- `app/server/functions/players.ts` → `await pruneEventLinks('player', data.id, data.campaignId);`
- `app/server/functions/races.ts` → `await pruneEventLinks('race', data.id, data.campaignId);`
- `app/server/functions/lore.ts` (in `deleteLore`, after the screen-ref cleanup) → add `import { pruneEventLinks } from '../utils/pruneEventLinks';` and `await pruneEventLinks('lore', data.id, data.campaignId);`

- [ ] **Step 3: Register the `events` collection in `gmscreens.ts`**

In `app/server/functions/gmscreens.ts`, add to `COLLECTION_REGISTRY` (next to the `lore` entry):
```typescript
  events: {
    async fetch(ids: string[], campaignId: string) {
      const { Event } = await import('../db/models/Event');
      return Event.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
```

- [ ] **Step 4: Add query keys**

In `app/utils/queryKeys.ts`, add inside the `queryKeys` object (after `lore`):
```typescript
  calendar: {
    all: ['calendar'] as const,
    detail: (campaignId: string) => ['calendar', 'detail', campaignId] as const,
  },
  events: {
    all: ['events'] as const,
    list: (campaignId: string, filters?: string) => ['events', 'list', campaignId, filters ?? ''] as const,
    detail: (id: string, campaignId: string) => ['events', 'detail', id, campaignId] as const,
    linked: (campaignId: string, kind: string, id: string) => ['events', 'linked', campaignId, kind, id] as const,
    epic: (campaignId: string) => ['events', 'epic', campaignId] as const,
  },
```

- [ ] **Step 5: Typecheck, run affected suites, commit**

Run: `npm run typecheck && npm test`
Expected: PASS.
```bash
git add app/server/utils/pruneEventLinks.ts app/server/functions/ app/utils/queryKeys.ts
git commit -m "feat(calendar): prune event links on entity delete, gmscreen fetch, query keys"
```

## Task 11: Hooks

**Files:**
- Create: `app/hooks/useCalendar.ts`, `app/hooks/useEvents.ts`

- [ ] **Step 1: Implement `useCalendar.ts`** (mirror `useLore.ts` server-fn wrapper + `createMutationHook` pattern)

```typescript
// app/hooks/useCalendar.ts
import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { CalendarData, CalDate } from '~/types/calendar';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  getCalendarSchema, upsertCalendarSchema, setCurrentDateSchema, deleteCalendarSchema,
} from '~/types/schemas/calendars';

const getCalendarFn = createServerFn({ method: 'GET' })
  .inputValidator(getCalendarSchema)
  .handler(async ({ data }) => {
    const { getCalendar } = await import('~/server/functions/calendars');
    return getCalendar({ data });
  });
const upsertCalendarFn = createServerFn({ method: 'POST' })
  .inputValidator(upsertCalendarSchema)
  .handler(async ({ data }) => {
    const { upsertCalendar } = await import('~/server/functions/calendars');
    return upsertCalendar({ data });
  });
const setCurrentDateFn = createServerFn({ method: 'POST' })
  .inputValidator(setCurrentDateSchema)
  .handler(async ({ data }) => {
    const { setCurrentDate } = await import('~/server/functions/calendars');
    return setCurrentDate({ data });
  });
const deleteCalendarFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteCalendarSchema)
  .handler(async ({ data }) => {
    const { deleteCalendar } = await import('~/server/functions/calendars');
    return deleteCalendar({ data });
  });

export function useCalendar(campaignId: string) {
  const { data: calendar = null, isLoading, error } = useQuery({
    queryKey: queryKeys.calendar.detail(campaignId),
    queryFn: () => getCalendarFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });
  return { calendar: calendar as CalendarData | null, isLoading, error: extractErrorMessage(error) };
}

export type UpsertCalendarInput = { campaignId: string } & Omit<
  CalendarData,
  'id' | 'createdBy' | 'createdAt' | 'updatedAt' | 'canEdit'
>;

export const useUpsertCalendar = createMutationHook({
  actionName: 'save',
  mutationFn: async (input: UpsertCalendarInput) => upsertCalendarFn({ data: input }),
  onSuccess: (qc, _d, { campaignId }) => {
    qc.invalidateQueries({ queryKey: queryKeys.calendar.detail(campaignId) });
    qc.invalidateQueries({ queryKey: ['events', 'list', campaignId], exact: false });
    qc.invalidateQueries({ queryKey: queryKeys.events.epic(campaignId) });
  },
  errorContext: () => ({ action: 'upsertCalendar' }),
});

export const useSetCurrentDate = createMutationHook({
  actionName: 'setCurrentDate',
  mutationFn: async (input: { campaignId: string; currentDate: CalDate }) => setCurrentDateFn({ data: input }),
  onSuccess: (qc, _d, { campaignId }) => {
    qc.invalidateQueries({ queryKey: queryKeys.calendar.detail(campaignId) });
    qc.invalidateQueries({ queryKey: queryKeys.events.epic(campaignId) });
  },
  errorContext: () => ({ action: 'setCurrentDate' }),
});

export const useDeleteCalendar = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: { campaignId: string }) => deleteCalendarFn({ data: input }),
  onSuccess: (qc, _d, { campaignId }) => qc.invalidateQueries({ queryKey: queryKeys.calendar.detail(campaignId) }),
  errorContext: () => ({ action: 'deleteCalendar' }),
});
```

- [ ] **Step 2: Implement `useEvents.ts`** (mirror `useLore.ts` exactly, swapping types/keys; add `useEpicEvents`)

```typescript
// app/hooks/useEvents.ts
import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { EventData, EventListItem, EventLinkKind } from '~/types/event';
import type { CalDate } from '~/types/calendar';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  listEventsSchema, getEventSchema, createEventSchema, updateEventSchema, deleteEventSchema,
} from '~/types/schemas/events';

const listEventsFn = createServerFn({ method: 'GET' })
  .inputValidator(listEventsSchema)
  .handler(async ({ data }) => {
    const { listEvents } = await import('~/server/functions/events');
    return listEvents({ data });
  });
const getEventFn = createServerFn({ method: 'GET' })
  .inputValidator(getEventSchema)
  .handler(async ({ data }) => {
    const { getEvent } = await import('~/server/functions/events');
    return getEvent({ data });
  });
const createEventFn = createServerFn({ method: 'POST' })
  .inputValidator(createEventSchema)
  .handler(async ({ data }) => {
    const { createEvent } = await import('~/server/functions/events');
    return createEvent({ data });
  });
const updateEventFn = createServerFn({ method: 'POST' })
  .inputValidator(updateEventSchema)
  .handler(async ({ data }) => {
    const { updateEvent } = await import('~/server/functions/events');
    return updateEvent({ data });
  });
const deleteEventFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteEventSchema)
  .handler(async ({ data }) => {
    const { deleteEvent } = await import('~/server/functions/events');
    return deleteEvent({ data });
  });

export interface EventFilters {
  search?: string;
  tags?: string[];
  visibility?: 'all' | 'public' | 'private';
  epicOnly?: boolean;
  linkedKind?: EventLinkKind;
  linkedId?: string;
}

export function useEvents(campaignId: string, filters?: EventFilters) {
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: queryKeys.events.list(campaignId, JSON.stringify(filters ?? {})),
    queryFn: () => listEventsFn({ data: { campaignId, ...filters } }),
    enabled: !!campaignId,
  });
  return { events: events as EventListItem[], isLoading, error: extractErrorMessage(error) };
}

export function useEpicEvents(campaignId: string) {
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: queryKeys.events.epic(campaignId),
    queryFn: () => listEventsFn({ data: { campaignId, epicOnly: true } }),
    enabled: !!campaignId,
  });
  return { events: events as EventListItem[], isLoading, error: extractErrorMessage(error) };
}

export function useEvent(id: string, campaignId: string) {
  const { data: event = null, isLoading, error } = useQuery({
    queryKey: queryKeys.events.detail(id, campaignId),
    queryFn: () => getEventFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });
  return { event: event as EventData | null, isLoading, error: extractErrorMessage(error) };
}

export function useLinkedEvents(campaignId: string, kind: string, id: string) {
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: queryKeys.events.linked(campaignId, kind, id),
    queryFn: () => listEventsFn({ data: { campaignId, linkedKind: kind as EventLinkKind, linkedId: id } }),
    enabled: !!campaignId && !!kind && !!id,
  });
  return { events: events as EventListItem[], isLoading, error: extractErrorMessage(error) };
}

export interface EventMutationInput {
  id?: string;
  campaignId: string;
  title: string;
  content?: string;
  gmContent?: string;
  isPublic?: boolean;
  isEpic?: boolean;
  start: CalDate;
  end?: CalDate | null;
  links?: { kind: EventLinkKind; id: string }[];
  sessionId?: string | null;
  images?: { url: string; caption: string; crop: { x: number; y: number; width: number; height: number } | null }[];
  tags?: string[];
  color?: string | null;
}

function invalidateEvents(qc: import('@tanstack/react-query').QueryClient, campaignId: string) {
  qc.invalidateQueries({ queryKey: ['events', 'list', campaignId], exact: false });
  qc.invalidateQueries({ queryKey: ['events', 'linked', campaignId], exact: false });
  qc.invalidateQueries({ queryKey: queryKeys.events.epic(campaignId) });
  qc.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
}

export const useCreateEvent = createMutationHook({
  actionName: 'create',
  mutationFn: async (input: EventMutationInput) => createEventFn({ data: input }),
  onSuccess: (qc, _d, { campaignId }) => invalidateEvents(qc, campaignId),
  errorContext: () => ({ action: 'createEvent' }),
});

export const useUpdateEvent = createMutationHook({
  actionName: 'update',
  mutationFn: async (input: EventMutationInput & { id: string }) => updateEventFn({ data: input }),
  onSuccess: (qc, _d, v) => {
    invalidateEvents(qc, v.campaignId);
    qc.invalidateQueries({ queryKey: queryKeys.events.detail(v.id, v.campaignId) });
  },
  errorContext: (v) => ({ action: 'updateEvent', eventId: v.id }),
});

export const useDeleteEvent = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: { id: string; campaignId: string }) => deleteEventFn({ data: input }),
  onSuccess: (qc, _d, v) => {
    invalidateEvents(qc, v.campaignId);
    qc.removeQueries({ queryKey: queryKeys.events.detail(v.id, v.campaignId) });
  },
  errorContext: (v) => ({ action: 'deleteEvent', eventId: v.id }),
});
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add app/hooks/useCalendar.ts app/hooks/useEvents.ts
git commit -m "feat(calendar): calendar + events query/mutation hooks"
```

---

# PHASE 3 — Calendar viewing (read-only) + wiki category

> UI tasks mirror the existing Lore components named in each step. Where a step says "mirror `<File>`", copy that file's structure, styling classes, and imports, then swap the data hook/types. Keep the listed `data-testid`s — the e2e specs depend on them.

## Task 12: Add Calendar + Events wiki categories

**Files:**
- Modify: `app/components/wiki/WikiPanel.tsx`

- [ ] **Step 1: Add icons + categories**

Add `CalendarDays` and `CalendarClock` to the existing `lucide-react` import. Add to `WIKI_CATEGORIES` (after `lore`):
```typescript
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'events', label: 'Events', icon: CalendarClock, gmOnly: true },
```
Extend the `WikiCategoryId` union type to include `'calendar' | 'events'`.

- [ ] **Step 2: Add render branches** (next to the `lore` branch)

```tsx
) : selectedCategory === 'calendar' ? (
  <CalendarPanel onBack={() => setSelectedCategory(null)} />
) : selectedCategory === 'events' && isGM ? (
  <EventsPanel onBack={() => setSelectedCategory(null)} />
```
Add imports: `import { CalendarPanel } from './calendar/CalendarPanel';` and `import { EventsPanel } from './calendar/EventsPanel';`

- [ ] **Step 3: Update the WikiPanel category test**

Find the existing `tests/.../WikiPanel*.test.tsx` that asserts the category list (the lore commit `8abc94e` updated it). Add `Calendar` to the all-members assertion and `Events` to the GM-only assertion. Run: `npm test -- tests/components` and fix the assertion. Commit after Task 14 (panels must exist to import). For now, create stub panels in Task 13 first so this compiles.

## Task 13: `CalDatePicker` + `CalendarGridView` + `EventListView`

**Files:**
- Create: `app/components/wiki/calendar/CalDatePicker.tsx`, `CalendarGridView.tsx`, `EventListView.tsx`

- [ ] **Step 1: `CalDatePicker.tsx`** — calendar-aware Year/Month/Day picker

Props: `{ cfg: CalendarConfig; value: CalDate; onChange: (d: CalDate) => void; disabled?: boolean; idPrefix: string }`.
Render: a number input for `year`; a `<select>` of `cfg.months` (label = name; option value = index); a `<select>` of days `1..daysInMonth(cfg, value.year, value.monthIndex)`. On year/month change, clamp `day` to the new `daysInMonth`. For an intercalary month with `daysInMonth === 0` (e.g. Shieldmeet in a non-leap year), disable the day select and show "no days this year" — the parent must surface that the date is invalid via `validateDate`. Add `data-testid={`${idPrefix}-year`}`, `-month`, `-day`.

```tsx
// key logic
import { daysInMonth, type CalDate, type CalendarConfig } from '~/utils/calendarEngine';
const maxDay = daysInMonth(cfg, value.year, value.monthIndex);
// month options:
{cfg.months.map((m, i) => (<option key={i} value={i}>{m.name}</option>))}
// day options:
{Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (<option key={d} value={d}>{d}</option>))}
```

- [ ] **Step 2: `CalendarGridView.tsx`** — month grid driven by the engine

Props: `{ cfg: CalendarConfig; year: number; monthIndex: number; events: EventListItem[]; currentDate: CalDate; onPrev(): void; onNext(): void; onSelectDay(date: CalDate): void }`.
Logic:
- If `cfg.months[monthIndex].isIntercalary`, render a single festival banner card (the month name + any events on day 1) instead of a grid.
- Else render `weekdays` header row, then `monthGrid(cfg, year, monthIndex)` rows of cells. For each non-null cell day:
  - tint if `holidaysOn(cfg, year, monthIndex, day).length` (use holiday color),
  - ring if `compareDates(cfg, {year,monthIndex,day}, currentDate) === 0`,
  - render event chips for events whose `[startOrdinal,endOrdinal]` span contains `toOrdinal(cfg,{year,monthIndex,day})` (compute day ordinal once per cell). Multi-day events get a spanning style.
- Show moon phase + season for the month via `moonPhase`/`seasonOf` in a small footer.
- `data-testid="calendar-grid"`.

- [ ] **Step 3: `EventListView.tsx`** — agenda grouped by year → month

Props: `{ cfg: CalendarConfig; events: EventListItem[]; isGM: boolean; onSelect(e: EventListItem): void }`.
Logic: events arrive already sorted by `startOrdinal` (server). Group by `start.year`, then `start.monthIndex`. Each row: `formatDate(cfg, e.start)` (+ "– " + day(s) when `end`), title, `EPIC` badge when `e.isEpic`, public/private indicator when `isGM`, linked-entity count. Empty state "No events". `data-testid="event-list"`, each row `data-testid="event-row"` + `data-event-id`.

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add app/components/wiki/calendar/CalDatePicker.tsx app/components/wiki/calendar/CalendarGridView.tsx app/components/wiki/calendar/EventListView.tsx
git commit -m "feat(calendar): date picker, grid view, list view (engine-driven)"
```

## Task 14: `CalendarPanel` (list default, grid toggle) + `EventViewModal` + `EventWindow`

**Files:**
- Create: `app/components/wiki/calendar/CalendarPanel.tsx`, `EventViewModal.tsx`, `EventWindow.tsx`

- [ ] **Step 1: `EventWindow.tsx`** — read-only content display (mirror `LoreWindow.tsx`)

Renders title + epic/visibility badges, `formatDate(cfg, start)` (+ end), tags, images, public `content` via `ReactMarkdown` + `remarkGfm` with `MARKDOWN_PROSE_CLASSES`, a GM-only `gmContent` section (amber banner) when present, and linked-entity chips (reuse the kind→badge colors from `EventLinksEditor`). Needs the calendar via `useCalendar(campaignId)` to format the date. `data-testid="event-window"`.

- [ ] **Step 2: `EventViewModal.tsx`** — wraps `EventWindow` in a modal (mirror `LoreViewModal.tsx`)

Fetch via `useEvent(eventId, campaignId)`; loading/not-found states; "Edit" button only when `event.canEdit` (opens `EventModal` — created in Task 15).

- [ ] **Step 3: `CalendarPanel.tsx`** (mirror `LorePanel.tsx`)

```tsx
// behavior
const { campaign } = useCampaign(campaignId);
const isGM = campaign?.isGM ?? false;
const { calendar, isLoading } = useCalendar(campaignId);
const { events } = useEvents(campaignId); // visibility-filtered server-side
const [view, setView] = useState<'list' | 'grid'>('list');           // list default
const [cursor, setCursor] = useState<{ year: number; monthIndex: number } | null>(null);
const [viewEventId, setViewEventId] = useState<string | undefined>();
```
- Header `WikiCategoryHeader title="Calendar"` + a list/grid toggle (`data-testid="calendar-view-toggle"`).
- When no calendar exists: empty state. For GM, a "Set up calendar" button + a "Use Calendar of Harptos" button that calls `useUpsertCalendar().save({ campaignId, ...HARPTOS_CONFIG defaults })` (see Task 16 editor for the full payload); for players, "The GM hasn't set up a calendar yet."
- Build the engine `cfg` from `calendar` (it already matches `CalendarConfig` shape).
- `view === 'list'` → `<EventListView cfg events isGM onSelect={(e) => setViewEventId(e.id)} />`; `view === 'grid'` → `<CalendarGridView ... />` with `cursor` defaulting to `calendar.currentDate`'s year/month and `onPrev/onNext` stepping month index (wrap to prev/next year at the ends).
- GM-only "Configure calendar" button opens `CalendarEditorModal` (Task 16).
- Render `EventViewModal` when `viewEventId` set.

- [ ] **Step 4: Wire WikiPanel test + run**

Complete Task 12 Step 3 now (panels exist). Run: `npm run typecheck && npm test -- tests/components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/wiki/calendar/CalendarPanel.tsx app/components/wiki/calendar/EventViewModal.tsx app/components/wiki/calendar/EventWindow.tsx app/components/wiki/WikiPanel.tsx tests/
git commit -m "feat(calendar): Calendar wiki panel (list/grid), event view modal + window"
```

---

# PHASE 4 — Calendar editor + Events management (GM)

## Task 15: `EventLinksEditor`, `EventCard`, `EventModal`, `EventsPanel`

**Files:**
- Create: `app/components/wiki/calendar/EventLinksEditor.tsx`, `EventCard.tsx`, `EventModal.tsx`, `EventsPanel.tsx`

- [ ] **Step 1: `EventLinksEditor.tsx`** — copy `LoreLinksEditor.tsx` verbatim, then add the `lore` kind

Add `useLore` to the entity hooks and a `lore` branch to `candidates` (`lore.map((l) => ({ id: l.id, label: l.title }))`), extend `KIND_LABELS`/`KIND_BADGE_COLORS` with `lore: 'Lore'`. Change the type to `EventLinkKind`. `data-testid="event-links-editor"`.

- [ ] **Step 2: `EventCard.tsx`** — copy `LoreCard.tsx`, swap the drag payload + testids

Drag payload: `{ collection: 'events', documentId: event.id, title: event.title }`. Root `data-testid="event-card"`, `data-event-id={event.id}`, title span `data-testid="event-card-title"`. Show epic badge + public/private icon + `formatDate` start.

- [ ] **Step 3: `EventModal.tsx`** — copy `LoreModal.tsx` structure; swap fields

Fields/state: `title, content, gmContent, isPublic, isEpic, start, end (nullable), links, sessionId, images, tags, color`. Use `CalDatePicker` (from Task 13) for `start` and an optional `end` (a "multi-day" checkbox toggles the end picker). Always show the GM Notes (`gmContent`) editor since only GMs reach this panel. Validation: title required; on submit, run `validateDate(cfg, start)` (and `end` if set) client-side and show the engine's error message inline before calling the mutation. testids: `event-title-input`, `event-create-button` (on the panel), `event-epic-toggle`. Save via `useCreateEvent`/`useUpdateEvent`; delete via `useDeleteEvent` with confirm.

- [ ] **Step 4: `EventsPanel.tsx`** — copy `LorePanel.tsx`; GM-only management list

Use `useEvents(campaignId, { search, visibility, tags, epicOnly })`, `WikiFilterBar` with `createButtonTestId="event-create-button"` and an extra "Epic only" toggle, render `EventCard` list, open `EventModal` for create/edit. Requires a calendar to exist — if none, show "Create a calendar first" linking to the Calendar category.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck && npm test -- tests/components`
```bash
git add app/components/wiki/calendar/
git commit -m "feat(calendar): events management UI (links editor, card, modal, panel)"
```

## Task 16: `CalendarEditorModal` (GM config)

**Files:**
- Create: `app/components/wiki/calendar/CalendarEditorModal.tsx`

- [ ] **Step 1: Build the editor** (mirror `LoreModal.tsx` modal chrome)

Props: `{ isOpen; onClose; campaignId; calendar: CalendarData | null }`.
Sections (each a simple add/remove list editor):
- Name, description, `yearSuffix`, `weekdayMode` (radio).
- **Weekdays:** editable ordered string list.
- **Months:** ordered rows of `{ name, days, isIntercalary }`.
- **Leap days:** rows of `{ name, monthIndex (select from months), interval, offset, addDays }`.
- **Moons / Seasons / Holidays / Named years:** simple row editors matching their schemas.
- **Current date:** a `CalDatePicker` built from the in-progress config.
- A prominent **"Load Calendar of Harptos"** button that fills every field from `HARPTOS_CONFIG` + `{ name: 'Calendar of Harptos', currentDate: { year: 1491, monthIndex: 6, day: 15 } }` (Mirtul 1491 DR; `monthIndex` 6 = Mirtul in the intercalary-inclusive month list).
- On save call `useUpsertCalendar().save({ campaignId, ...config })`. If the response has `invalidEventIds.length`, show a warning toast/banner: "N events now have dates outside the new calendar and need fixing" (do not block the save).
- `data-testid="calendar-editor"`, save button `data-testid="calendar-save-button"`, Harptos button `data-testid="calendar-harptos-button"`.

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add app/components/wiki/calendar/CalendarEditorModal.tsx app/components/wiki/calendar/CalendarPanel.tsx
git commit -m "feat(calendar): GM calendar editor with Harptos preset + invalid-date warning"
```

## Task 17: Tabletop/GM-screen event window wrapper

**Files:**
- Create: `app/components/mainview/gmscreens/EventWindowWrapper.tsx`
- Modify: the gmscreens window renderer that maps `collection` → wrapper (find where `LoreWindowWrapper` is referenced and add an `events` case)

- [ ] **Step 1: Implement** (mirror `LoreWindowWrapper.tsx`) — fetch via `useEvent`, render `EventWindow`, loading/not-found states. Register the `events` collection in the renderer switch next to `lore`.

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add app/components/mainview/gmscreens/
git commit -m "feat(calendar): render event windows on tabletop/GM screens"
```

---

# PHASE 5 — Seed data (Calendar of Harptos + sample events)

## Task 18: Python `to_ordinal` port + parity test

**Files:**
- Modify: `scripts/dev_seed.py` (add a `harptos.py` sibling or inline helpers)
- Create: `scripts/seed_calendar_data.py`, `tests/utils/calendarEngine.parity.test.ts`

- [ ] **Step 1: Create `scripts/seed_calendar_data.py`** with the Harptos config + a faithful `to_ordinal` port

```python
# scripts/seed_calendar_data.py
"""Calendar of Harptos seed config + a port of calendarEngine.toOrdinal.

Mirrors app/utils/harptos.ts and app/utils/calendarEngine.ts EXACTLY. A vitest
parity test (calendarEngine.parity.test.ts) asserts the TS engine and these
numbers agree for the seeded dates, so the two ports cannot silently diverge.
"""

HARPTOS_MONTHS = [
    {"name": "Hammer", "days": 30},
    {"name": "Midwinter", "days": 1, "isIntercalary": True},
    {"name": "Alturiak", "days": 30},
    {"name": "Ches", "days": 30},
    {"name": "Tarsakh", "days": 30},
    {"name": "Greengrass", "days": 1, "isIntercalary": True},
    {"name": "Mirtul", "days": 30},
    {"name": "Kythorn", "days": 30},
    {"name": "Flamerule", "days": 30},
    {"name": "Midsummer", "days": 1, "isIntercalary": True},
    {"name": "Shieldmeet", "days": 0, "isIntercalary": True},
    {"name": "Eleasis", "days": 30},
    {"name": "Eleint", "days": 30},
    {"name": "Highharvestide", "days": 1, "isIntercalary": True},
    {"name": "Marpenoth", "days": 30},
    {"name": "Uktar", "days": 30},
    {"name": "The Feast of the Moon", "days": 1, "isIntercalary": True},
    {"name": "Nightal", "days": 30},
]

HARPTOS = {
    "name": "Calendar of Harptos",
    "description": "The calendar of the Forgotten Realms, devised by Harptos of Kaalinth.",
    "months": HARPTOS_MONTHS,
    "weekdays": ["First", "Second", "Third", "Fourth", "Fifth",
                 "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"],
    "weekdayMode": "resetEachMonth",
    "epoch": {"year": 1372, "weekdayIndex": 0},
    "yearSuffix": "DR",
    "namedYears": [
        {"year": 1358, "name": "Year of Shadows"},
        {"year": 1385, "name": "Year of Blue Fire"},
    ],
    "leapDays": [{"name": "Shieldmeet", "monthIndex": 10, "interval": 4, "offset": 0, "addDays": 1}],
    "moons": [{"name": "Selûne", "cycleLength": 30, "offsetDays": 0}],
    "seasons": [
        {"name": "Winter", "startMonthIndex": 0, "startDay": 1},
        {"name": "Spring", "startMonthIndex": 3, "startDay": 1},
        {"name": "Summer", "startMonthIndex": 8, "startDay": 1},
        {"name": "Autumn", "startMonthIndex": 13, "startDay": 1},
    ],
    "holidays": [],
    "currentDate": {"year": 1491, "monthIndex": 6, "day": 15},  # Mirtul 1491 DR
}


def _leap_applies(rule, year):
    if rule["interval"] < 1:
        return False
    return (year - rule["offset"]) % rule["interval"] == 0


def days_in_month(cfg, year, month_index):
    base = cfg["months"][month_index]["days"]
    extra = sum(r["addDays"] for r in cfg["leapDays"]
                if r["monthIndex"] == month_index and _leap_applies(r, year))
    return base + extra


def days_in_year(cfg, year):
    return sum(days_in_month(cfg, year, m) for m in range(len(cfg["months"])))


def to_ordinal(cfg, date):
    year, month_index, day = date["year"], date["monthIndex"], date["day"]
    epoch_year = cfg["epoch"]["year"]
    if year >= epoch_year:
        year_start = sum(days_in_year(cfg, y) for y in range(epoch_year, year))
    else:
        year_start = -sum(days_in_year(cfg, y) for y in range(year, epoch_year))
    before_month = sum(days_in_month(cfg, year, m) for m in range(month_index))
    return year_start + before_month + (day - 1)
```

- [ ] **Step 2: Write the parity test** (asserts TS engine matches the Python numbers for seed dates)

```typescript
// tests/utils/calendarEngine.parity.test.ts
import { describe, it, expect } from 'vitest';
import { toOrdinal } from '~/utils/calendarEngine';
import { HARPTOS_CONFIG } from '~/utils/harptos';

// These ordinals are produced by scripts/seed_calendar_data.py:to_ordinal for the
// seeded sample-event dates. If the engines diverge, this test fails.
// Regenerate with:  python3 -c "import sys; sys.path.insert(0,'scripts'); \
//   from seed_calendar_data import HARPTOS, to_ordinal; \
//   print(to_ordinal(HARPTOS, {'year':1491,'monthIndex':6,'day':15}))"
const EXPECTED: Array<[{ year: number; monthIndex: number; day: number }, number]> = [
  [{ year: 1491, monthIndex: 6, day: 15 }, /* fill from python */ 0],
  [{ year: 1488, monthIndex: 10, day: 1 }, /* fill from python */ 0],
  [{ year: 1358, monthIndex: 0, day: 1 }, /* fill from python */ 0],
];

describe('calendar engine parity (TS vs Python seed port)', () => {
  it('matches the Python to_ordinal for seed dates', () => {
    for (const [date, expected] of EXPECTED) {
      expect(toOrdinal(HARPTOS_CONFIG, date)).toBe(expected);
    }
  });
});
```

Then run the python one-liner shown in the comment for each date and paste the real numbers into `EXPECTED` (replace the `0` placeholders). Run: `npm test -- tests/utils/calendarEngine.parity.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed_calendar_data.py tests/utils/calendarEngine.parity.test.ts
git commit -m "feat(calendar): python Harptos seed config + TS/Python ordinal parity test"
```

## Task 19: `build_calendar_doc` + `build_event_docs` + orchestration

**Files:**
- Modify: `scripts/dev_seed.py`

- [ ] **Step 1: Add builders** near `build_lore_docs`

```python
from seed_calendar_data import HARPTOS, to_ordinal  # add to imports

def build_calendar_doc(*, campaign_id, gm_id, now):
    """One Calendar of Harptos document for the rich campaign."""
    doc = dict(HARPTOS)
    doc.update({
        "campaignId": campaign_id,
        "createdBy": gm_id,
        "createdAt": now,
        "updatedAt": now,
    })
    return doc


def build_event_docs(*, campaign_id, calendar_id, gm_id, now,
                     character_ids, location_ids, race_ids, player_ids, session_ids):
    """~10 sample events on the Harptos calendar, linked to seeded entities."""
    def ev(title, content, start, *, public, epic=False, end=None, links=None,
           gm_content="", tags=None, session_id=None, day_offset=0):
        ts = now - timedelta(days=day_offset)
        return {
            "title": title, "content": content, "gmContent": gm_content,
            "isPublic": public, "isEpic": epic,
            "start": start, "end": end,
            "startOrdinal": to_ordinal(HARPTOS, start),
            "endOrdinal": to_ordinal(HARPTOS, end or start),
            "links": links or [], "sessionId": session_id, "images": [],
            "tags": tags or [], "color": None,
            "campaignId": campaign_id, "calendarId": calendar_id, "createdBy": gm_id,
            "createdAt": ts, "updatedAt": ts,
        }

    phandalin = location_ids.get("Phandalin") or (next(iter(location_ids.values())) if location_ids else ObjectId())
    npc0 = character_ids[0] if character_ids else ObjectId()
    player0 = player_ids[0] if player_ids else ObjectId()
    elf = race_ids.get("Elf") or (next(iter(race_ids.values())) if race_ids else ObjectId())
    session0 = session_ids[0] if session_ids else None

    return [
        ev("The Time of Troubles", "The gods walked Faerûn as mortals; Mystra fell at Mistmere.",
           {"year": 1358, "monthIndex": 6, "day": 15}, public=True, epic=True,
           tags=["world", "history"]),
        ev("The Spellplague", "Blue fire swept the Weave; magic itself convulsed across the Realms.",
           {"year": 1385, "monthIndex": 8, "day": 1}, public=True, epic=True,
           tags=["world", "history"]),
        ev("Shieldmeet Grand Council", "Rulers renewed pacts on the leap-day festival of Shieldmeet.",
           {"year": 1488, "monthIndex": 10, "day": 1}, public=True,
           tags=["festival", "politics"]),
        ev("Founding of Phandalin", "Settlers rebuilt the ruined town atop the old Phandelver pact lands.",
           {"year": 1451, "monthIndex": 3, "day": 8}, public=True,
           links=[{"kind": "location", "id": phandalin}], tags=["history"]),
        ev("The Siege of Phandalin", "Redbrands stormed the town over two desperate days.",
           {"year": 1491, "monthIndex": 4, "day": 11}, end={"year": 1491, "monthIndex": 4, "day": 12},
           public=True, epic=True,
           links=[{"kind": "location", "id": phandalin}, {"kind": "character", "id": npc0}],
           tags=["campaign", "battle"], session_id=session0),
        ev("Gundren's Disappearance", "Gundren Rockseeker vanished on the Triboar Trail.",
           {"year": 1491, "monthIndex": 4, "day": 2}, public=False,
           gm_content="Captured by Cragmaw goblins on the Black Spider's orders.",
           links=[{"kind": "character", "id": npc0}], tags=["campaign", "secret"]),
        ev("Wave Echo Cave Rediscovered", "The lost mine and its Forge of Spells came to light again.",
           {"year": 1491, "monthIndex": 4, "day": 20}, public=True,
           links=[{"kind": "location", "id": phandalin}], tags=["campaign"]),
        ev("Greengrass in Phandalin", "The spring festival of Greengrass was kept with garlands and ale.",
           {"year": 1491, "monthIndex": 5, "day": 1}, public=True,
           links=[{"kind": "player", "id": player0}], tags=["festival"]),
        ev("The Elven Retreat", "The elves withdrew to their hidden refuges as the age turned.",
           {"year": 1344, "monthIndex": 12, "day": 20}, public=True,
           links=[{"kind": "race", "id": elf}], tags=["history", "elf"]),
        ev("Council Vote at Neverwinter", "A closed council set the season's trade compacts.",
           {"year": 1491, "monthIndex": 6, "day": 10}, public=False,
           gm_content="Sets up the next arc's politics.", tags=["politics", "secret"]),
    ]
```

- [ ] **Step 2: Call them in the orchestrator** (after lore insert, in the `rich_session_history` block)

```python
        cal_doc = build_calendar_doc(campaign_id=campaign_id, gm_id=gm_id, now=now)
        cal_result = db.calendars.insert_one(cal_doc)
        calendar_id = cal_result.inserted_id
        print(f"    calendar   inserted 1")

        event_docs = build_event_docs(
            campaign_id=campaign_id, calendar_id=calendar_id, gm_id=gm_id, now=now,
            character_ids=character_ids, location_ids=location_ids, race_ids=race_ids,
            player_ids=player_doc_ids, session_ids=session_ids,
        )
        if event_docs:
            db.events.insert_many(event_docs)
        print(f"    events     inserted {len(event_docs)}")
```
Note: confirm `session_ids` is available in that scope; if sessions are built earlier as `session_docs`, capture their ids (`[s["_id"] for s in session_docs]`) and pass them. If not readily available, pass `session_ids=[]` (the one session link simply becomes null).

- [ ] **Step 3: Run the seed against an ephemeral Mongo** (per repo memory: never the dev Atlas DB)

Run the seed integration the same way the repo tests `dev_seed.py` (throwaway `mongodb-memory-server`). Verify it inserts 1 calendar + 10 events with no exceptions and that `startOrdinal` values are integers.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev_seed.py
git commit -m "feat(calendar): seed Calendar of Harptos + 10 sample events"
```

## Task 20: Event seed banner images

**Files:**
- Create: `scripts/gen_seed_event_images.mjs`
- Modify: `package.json` (`dev:seed` chain)

- [ ] **Step 1: Copy `gen_seed_lore_images.mjs`** to `gen_seed_event_images.mjs`; change `LORE_SLUGS` → event slugs, output dir to `public/uploads/seed-events/`, and the glyph to a calendar/star motif. (Optional: only needed if seed events reference image URLs; current `build_event_docs` seeds `images: []`, so this is a nice-to-have. If keeping events imageless, skip this task.)

- [ ] **Step 2: Add to the seed chain** in `package.json`:
```
"dev:seed": "node scripts/run-python.cjs dev_seed.py && node scripts/gen_seed_avatars.mjs && node scripts/gen_seed_lore_images.mjs && node scripts/gen_seed_event_images.mjs",
```

- [ ] **Step 3: Commit**

```bash
git add scripts/gen_seed_event_images.mjs package.json
git commit -m "feat(calendar): generate seed event banner images"
```

---

# PHASE 6 — Epic timeline widget

## Task 21: Map epic events → `TimelineEvent` and feed the widget

**Files:**
- Create: `app/services/eventsTimeline.ts`
- Modify: `app/components/mainview/widgets/CampaignTimelineWidget.tsx`
- Test: `tests/services/eventsTimeline.test.ts`

- [ ] **Step 1: Write the failing mapper test**

```typescript
// tests/services/eventsTimeline.test.ts
import { describe, it, expect } from 'vitest';
import { eventsToTimeline } from '~/services/eventsTimeline';
import { HARPTOS_CONFIG } from '~/utils/harptos';
import type { EventListItem } from '~/types/event';

const cfg = HARPTOS_CONFIG;
const base: EventListItem = {
  id: 'e1', campaignId: 'c', calendarId: 'cal', createdBy: 'u', title: 'Siege',
  content: 'A great siege', isPublic: true, isEpic: true,
  start: { year: 1491, monthIndex: 4, day: 11 }, end: { year: 1491, monthIndex: 4, day: 12 },
  startOrdinal: 0, endOrdinal: 0, links: [], sessionId: null, images: [], tags: [], color: null,
  createdAt: '', updatedAt: '', canEdit: false,
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
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm test -- tests/services/eventsTimeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapper**

```typescript
// app/services/eventsTimeline.ts
import type { TimelineEvent } from '~/services/mocks/types';
import type { EventListItem } from '~/types/event';
import type { CalendarConfig, CalDate } from '~/utils/calendarEngine';
import { formatDate, toOrdinal } from '~/utils/calendarEngine';

export function eventsToTimeline(
  cfg: CalendarConfig,
  events: EventListItem[],
  currentDate: CalDate
): TimelineEvent[] {
  const cur = toOrdinal(cfg, currentDate);
  const sorted = [...events].sort((a, b) => b.startOrdinal - a.startOrdinal); // newest first
  return sorted.map((e) => {
    const isCurrent = cur >= e.startOrdinal && cur <= e.endOrdinal;
    const evt: TimelineEvent = {
      id: e.id,
      calendarDate: formatDate(cfg, e.start),
      sessionName: e.title,
      summary: (e.content || '').slice(0, 160),
      importance: 'major',
    };
    if (isCurrent) evt.isCurrent = true;
    return evt;
  });
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test -- tests/services/eventsTimeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Feed real epic events into the widget**

The widget already accepts an optional `events` prop and falls back to `getTimelineEvents()` (the mock). Create a small wrapper used on the dashboard so the widget stays presentational. In the dashboard render site (where `<CampaignTimelineWidget />` is used — `app/routes/campaigns/$campaignId/play.tsx` / `DashboardView`), add:

```tsx
import { useCalendar } from '~/hooks/useCalendar';
import { useEpicEvents } from '~/hooks/useEvents';
import { eventsToTimeline } from '~/services/eventsTimeline';
// ...
const { calendar } = useCalendar(campaignId);
const { events: epic } = useEpicEvents(campaignId);
const timelineEvents = calendar
  ? eventsToTimeline(
      {
        months: calendar.months, weekdays: calendar.weekdays, weekdayMode: calendar.weekdayMode,
        epoch: calendar.epoch, yearSuffix: calendar.yearSuffix, leapDays: calendar.leapDays,
        moons: calendar.moons, seasons: calendar.seasons, holidays: calendar.holidays,
      },
      epic,
      calendar.currentDate
    )
  : undefined; // undefined => widget keeps its mock fallback when no calendar exists
// ...
<CampaignTimelineWidget events={timelineEvents} />
```
The widget's existing empty/loading states cover the "calendar exists but no epic events" case (`timelineEvents` is `[]`).

- [ ] **Step 6: Typecheck, run, commit**

Run: `npm run typecheck && npm test -- tests/services/eventsTimeline.test.ts`
```bash
git add app/services/eventsTimeline.ts tests/services/eventsTimeline.test.ts app/routes/campaigns app/components/mainview
git commit -m "feat(calendar): epic timeline reads real epic events"
```

---

# PHASE 7 — E2E

## Task 22: Calendar/Events e2e (GM create + player visibility + timeline)

**Files:**
- Create: `e2e/calendar/calendar-events.spec.ts`

- [ ] **Step 1: Write the spec** (mirror `e2e/lore/lore-editor.spec.ts`; relies on seed from Task 19)

```typescript
// e2e/calendar/calendar-events.spec.ts
import { test, expect } from '../fixtures/tabletop-fixtures';
import { mockPostHog, blockPartyKit } from '../fixtures/network-mocks';

test.describe('Calendar & Events', () => {
  test.beforeEach(async ({ page }) => {
    await mockPostHog(page);
    await blockPartyKit(page);
  });

  test('GM sees seeded events on the calendar list', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    await page.getByRole('tab', { name: 'Wiki' }).click();
    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByTestId('event-list')).toBeVisible({ timeout: 10_000 });
    // A seeded public epic event is visible.
    await expect(page.getByText('The Siege of Phandalin').first()).toBeVisible();
  });

  test('GM can create an event via the Events manager', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    await page.getByRole('tab', { name: 'Wiki' }).click();
    await page.getByRole('button', { name: 'Events' }).click();
    await page.getByTestId('event-create-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByTestId('event-title-input').fill('E2E Festival');
    // Date pickers default to the calendar current date; just submit.
    await page.getByRole('button', { name: /Create Event/i }).click();
    await expect(page.getByText('E2E Festival').first()).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run** (requires `npm run dev:seed` + dev server, per the lore spec preconditions)

Run: `npx playwright test e2e/calendar/calendar-events.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/calendar/calendar-events.spec.ts
git commit -m "test(calendar): e2e for calendar list + event creation"
```

## Task 23: Event drag-drop e2e

**Files:**
- Create: `e2e/calendar/event-drag-drop.spec.ts`

- [ ] **Step 1: Copy `e2e/lore/lore-drag-drop.spec.ts`**, swapping: Wiki → **Events** category, `lore-card` → `event-card`, `data-lore-id` → `data-event-id`, `lore-card-title` → `event-card-title`, payload `collection: 'lore'` → `'events'`, and the asserted window testid `lore-window` → `event-window`.

- [ ] **Step 2: Run + commit**

Run: `npx playwright test e2e/calendar/event-drag-drop.spec.ts`
```bash
git add e2e/calendar/event-drag-drop.spec.ts
git commit -m "test(calendar): e2e for dragging an event onto the tabletop"
```

## Task 24: Final verification

- [ ] **Step 1:** `npm run typecheck` → no errors.
- [ ] **Step 2:** `npm run lint` → no errors (fix any with `npm run lint:fix`).
- [ ] **Step 3:** `npm test` → full unit suite passes (engine, parity, calendars, events, timeline, WikiPanel).
- [ ] **Step 4:** `npx playwright test e2e/calendar` → both specs pass.
- [ ] **Step 5:** Manual smoke: GM loads the Harptos preset, advances current date, creates an epic multi-day event, confirms it appears on the list, the grid (spanning chip), and the dashboard timeline; a player account sees public events only and no Events category.

---

## Notes on cross-cutting conventions

- **gmContent posture:** events are GM-only to write, but `getEvent`/`listEvents` still strip `gmContent` for non-GM viewers (defensive parity with Lore).
- **Ordinals are server-authoritative:** never trust client-sent `startOrdinal`/`endOrdinal`; the server always recomputes from the calendar config (mirrors the `gmContent` coercion pattern).
- **One source of date math:** if you find yourself adding/subtracting days or computing a weekday outside `calendarEngine.ts`, stop and add a function to the engine with a test instead.
