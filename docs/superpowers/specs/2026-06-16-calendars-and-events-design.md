# Calendars & Events — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorm), ready for implementation plan
**Branch:** feature work off `wiki-updates`; PRs target `dev`

## Summary

Two new wiki datatypes, modeled closely on the existing **Lore** vertical slice:

1. **Calendar** — a GM-authored custom calendar (custom months, custom weekdays/tendays, named years, leap days, moons, seasons, holidays) with full Kanka-style fidelity. Exactly **one calendar per campaign**. Viewable by all members; editable only by the GM.
2. **Event** — a dated world/campaign happening with public + GM-only markdown, placed on the calendar, linkable to characters, players, races, locations, lore, and sessions. **GM-only to create and manage.** Players consume events through the Calendar view and the dashboard's epic timeline.

A single pure **calendar engine** module owns all date math. Moons, seasons, and holidays are display-only derivations and never affect storage or sorting. The dashboard's epic timeline widget is rewired to read real events the GM tags as epic.

The seed dataset ships the authentic **Calendar of Harptos** (Forgotten Realms) plus ~10 sample events, including real FR world events and Phandalin-campaign events linked to existing seeded entities.

## Goals / Non-goals

**Goals**
- Faithful custom-calendar support: custom months & lengths, custom weekday/tenday count, named years/epochs, leap days, moons, seasons, holidays.
- Events with exact start day + optional end day (multi-day spans), public/GM text, per-event visibility, an `isEpic` flag, and links to 5 entity kinds + sessions.
- Calendar view (list/agenda default, toggle to month grid) for all members; GM-only Events management UI.
- Dramatically fewer date-math defects than Kanka by isolating all date arithmetic in one pure, exhaustively tested module.
- Authentic Harptos seed calendar + sample events.
- Rewire the dashboard epic timeline to real epic events.

**Non-goals (deferred)**
- Multiple calendars per campaign (schema carries `calendarId` so this is a non-breaking future addition).
- Recurring events (annual recurrence is covered by calendar **holidays**; one-off events are not recurring).
- Partial/fuzzy event dates (year-only / month-only). All event dates are exact days.
- Time-of-day on events.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Calendar fidelity | Full: custom months/weekdays/years **+ leap days, moons, seasons, holidays** |
| Calendars per campaign | **One** (events still carry `calendarId`) |
| Event date model | **Start day + optional end day, exact days** (multi-day spans) |
| Event visibility | **Per-event `isPublic`** + public `content` / GM-only `gmContent` (mirrors Lore) |
| `isEpic` | Independent GM-only flag; drives the timeline; independent of `isPublic` |
| Default calendar view | **List/agenda**, with a toggle to month grid |
| Date representation | **Approach 1:** structured `{year,month,day}` = source of truth; denormalized integer ordinal = derived sort index; one pure engine |
| Seed calendar | **Calendar of Harptos** (verified) |

## Architecture & file layout

Mirrors the Lore slice, plus one shared pure module.

- **Shared types:** `app/types/calendar.ts`, `app/types/event.ts`
- **Zod schemas:** `app/types/schemas/calendars.ts`, `app/types/schemas/events.ts`
- **DB models:** `app/server/db/models/Calendar.ts`, `app/server/db/models/Event.ts`
- **Calendar engine (the crux):** `app/utils/calendarEngine.ts` — pure functions only; no DB, React, or IO; imported by **both** client and server
- **Server functions:** `app/server/functions/calendars.ts`, `app/server/functions/events.ts`
- **Hooks:** `app/hooks/useCalendar.ts`, `app/hooks/useEvents.ts`
- **Components:** `app/components/wiki/calendar/` — `CalendarPanel`, `CalendarGridView`, `EventListView`, `CalendarEditorModal`, `EventsPanel`, `EventCard`, `EventModal`, `EventViewModal`, `EventWindow`, `EventLinksEditor`, `EventWindowWrapper`
- **Seed:** extend `scripts/dev_seed.py` (`build_calendar_doc`, `build_event_docs`); new `scripts/gen_seed_event_images.mjs`
- **Tests:** `tests/utils/calendarEngine.test.ts`, `tests/server/functions/{calendars,events}.test.ts`, `e2e/calendar/*.spec.ts`

**The invariant that prevents the Kanka bug class:** no date arithmetic exists anywhere except `calendarEngine.ts`. Components, server functions, the timeline, and the Python seed all go through the engine (the Python seed ports `toOrdinal`, asserted equal to the TS engine in a test).

## Data model

### `Calendar` (one per campaign)
```
campaignId
name, description?
months:    [{ name, days, isIntercalary?: boolean }]   // ordered; intercalary = festival day outside the week cycle
weekdays:  [string]                                    // ordered names; length = days per week/tenday
weekdayMode: 'continuous' | 'resetEachMonth'           // Harptos = resetEachMonth
epoch:     { year, weekdayIndex }                      // ordinal 0 = day 1 of this year; weekday it lands on (continuous mode)
yearSuffix?: string                                    // e.g. "DR"
namedYears?: [{ year, name }]                          // optional ("Year of ...")
leapDays:  [{ name, monthIndex, interval, offset, addDays }]  // adds days to a month in matching years
moons:     [{ name, cycleLength, offsetDays, color? }]        // display-only
seasons:   [{ name, startMonthIndex, startDay, color? }]      // display-only; runs until next season start
holidays:  [{ name, monthIndex, day, color? }]                // recurring annually; display-only
currentDate: { year, monthIndex, day }                 // GM-set "now"; drives ringed day + timeline isCurrent
createdBy, createdAt, updatedAt
```

### `Event`
```
campaignId, calendarId
title
content     // public markdown
gmContent   // GM-only markdown
isPublic, isEpic
start:  { year, monthIndex, day }
end:    { year, monthIndex, day } | null
startOrdinal, endOrdinal           // denormalized ints computed by the engine; INDEXED
links:  [{ kind: 'character'|'player'|'race'|'location'|'lore', id }]
sessionId?                         // optional "happened during session N"
images?, tags?, color?
createdBy, createdAt, updatedAt
```
**Indexes:** `campaignId`, `{campaignId, startOrdinal}`, `isPublic`, `isEpic`, `links.id`, `tags`, `sessionId`.

## The calendar engine — `app/utils/calendarEngine.ts`

Pure functions; config in, values out. This is where correctness is won.

- `toOrdinal(cal, {year,month,day}) → int` and `fromOrdinal(cal, n) → {year,month,day}` — exact inverses
- `daysInMonth(cal, year, monthIndex)` / `daysInYear(cal, year)` — leap-aware (leap rule matches a year when `(year - offset) % interval === 0`)
- `weekdayOf(cal, ordinal)` — respects `weekdayMode`; intercalary days return no weekday slot
- `monthGrid(cal, year, monthIndex)` — week rows of day cells (leading blanks) for the grid view
- `moonPhase(cal, moon, ordinal)`, `seasonOf(cal, ordinal)`, `holidaysOn(cal, year, month, day)` — display helpers, never persisted
- `compareDates`, `addDays`
- `validateDate(cal, date) → {ok} | {error}` — rejects out-of-range months/days (e.g. day 31 in a 30-day month, a day in a 0-length Shieldmeet in a non-leap year)

### Two server-enforced integrity rules (the second Kanka killer)
1. **On event create/update:** server calls `validateDate`, then computes `startOrdinal`/`endOrdinal` via the engine. Client-supplied ordinals are ignored.
2. **On calendar update:** in one transaction, re-validate every event's dates against the new config and recompute all ordinals. Events whose dates became invalid (e.g. a shortened month) are **flagged back to the GM**, never silently moved.

## Permissions & visibility

Via the existing `requireCampaignMember` → `{ userId, isGM }`.

| Action | Who |
|---|---|
| View calendar (config, grid, list) | Any member |
| Create / edit / delete calendar, set `currentDate` | GM only |
| Create / edit / delete events, set `isEpic` | GM only |
| View events | Members: `isPublic` events with public `content` only. GM: all events + `gmContent`. |

`gmContent` is stripped from non-GM responses and never persisted from a non-GM writer (defensive parity with Lore). Wiki categories: **Calendar** visible to all; **Events** is `gmOnly`.

## Server functions & hooks

**`calendars.ts`:** `getCalendar(campaignId)`, `upsertCalendar(input)` *(GM; runs the re-validate + recompute-all-events transaction)*, `setCurrentDate(input)` *(GM)*, `deleteCalendar` *(GM)*.

**`events.ts`:** `listEvents(campaignId, filters)` *(visibility-filtered; sorted by `startOrdinal`; filters: search, tags, linkedKind/Id, epicOnly, visibility, date range)*, `getEvent(id)`, `createEvent` *(GM)*, `updateEvent` *(GM)*, `deleteEvent` *(GM; + GM-screen ref cleanup)*. Create/update validate dates + recompute ordinals and resolve link labels (Lore's `resolveLinkLabels`, extended with `lore` kind and optional `session`).

**Link pruning:** extend the `pruneLoreLinks` pattern so deleting a character/player/race/location/lore `$pull`s that link from events too. Deleting an event clears its GM-screen references.

**Hooks (React Query, `createMutationHook`):** `useCalendar`, `useUpsertCalendar`, `useSetCurrentDate`, `useDeleteCalendar`; `useEvents`, `useEvent`, `useLinkedEvents`, `useCreateEvent`, `useUpdateEvent`, `useDeleteEvent`. Keys under `['calendar', campaignId]` and `['events', …]`; mutations invalidate list/detail/linked + the timeline query.

## UI components

**Wiki integration** (`WikiPanel.tsx` `WIKI_CATEGORIES`): add `{ id:'calendar', label:'Calendar', icon: CalendarDays }` (all members) and `{ id:'events', label:'Events', icon: CalendarClock, gmOnly:true }`.

**Calendar category → `CalendarPanel`:**
- **List/agenda view (default)** + toggle to **grid view**.
- *List:* events grouped by year → month (engine-ordered); each row shows title, day(s), epic badge, public/private (GM only), holiday markers, linked-entity chips. Members see public events only.
- *Grid:* `monthGrid(...)` renders the dynamic month (Harptos: 10-wide tenday rows); holidays tinted, `currentDate` ringed, multi-day events as spanning chips, moon/season indicators from the engine; festival/intercalary days render as single banners between months. Month/year nav; click a day → that day's events.
- Clicking an event → `EventViewModal` (public content + linked entities; `gmContent` and edit only if GM).
- **GM-only "Configure calendar"** → `CalendarEditorModal` (months, weekdays, leap days, moons, seasons, holidays, current date). All date inputs everywhere are calendar-aware Year/Month/Day pickers driven by the config.

**Events category (GM only) → `EventsPanel`:** standard management list — `WikiFilterBar` (search/tags/epic filter), draggable `EventCard` list (like `LoreCard`), `EventModal` (title, public content, GM content, start/optional-end pickers, `isPublic`, `isEpic`, links via `EventLinksEditor`, optional session, images, tags), delete-with-confirm. `EventWindow` + `EventWindowWrapper` so events display on tabletop/GM screens like Lore.

## Epic timeline fix

`CampaignTimelineWidget.tsx` is currently fed by mock `services/mocks/timelineService.ts`.
- Replace the mock with a real query: epic events for the campaign, ordered by `startOrdinal`, visibility-filtered (players see only public epic events).
- Map `Event → TimelineEvent`: `calendarDate` = engine-formatted start-date string, `sessionName`/`summary` from title/content, `importance: 'major'` for epic, `isCurrent` when the event span contains the calendar's `currentDate`.
- Keep the widget's render/props shape unchanged; only the data source changes. Add an empty state when no epic events exist.

## Seed data — Calendar of Harptos (verified)

Sources: realmshelps.net (Time and Seasons), Forgotten Realms Wiki (Calendar of Harptos).

**Structure:** 12 months × 30 days (three 10-day tendays each); 5 festival days between specific months; Shieldmeet leap day after Midsummer every 4 years. 365 days/year, 366 in a Shieldmeet year. `weekdayMode: 'resetEachMonth'` (each month starts a fresh tenday; festival days have no tenday slot).

**Internal `months` array (ordered, with `isIntercalary`):**

| idx | name | days | intercalary |
|----|------|------|----|
| 0 | Hammer (Deepwinter) | 30 | |
| 1 | Midwinter | 1 | ✓ |
| 2 | Alturiak (Claw of Winter) | 30 | |
| 3 | Ches (Claw of Sunsets) | 30 | |
| 4 | Tarsakh (Claw of Storms) | 30 | |
| 5 | Greengrass | 1 | ✓ |
| 6 | Mirtul (The Melting) | 30 | |
| 7 | Kythorn (Time of Flowers) | 30 | |
| 8 | Flamerule (Summertide) | 30 | |
| 9 | Midsummer | 1 | ✓ |
| 10 | Shieldmeet | 0 (→1 leap) | ✓ |
| 11 | Eleasis (Highsun) | 30 | |
| 12 | Eleint (The Fading) | 30 | |
| 13 | Highharvestide | 1 | ✓ |
| 14 | Marpenoth (Leaffall) | 30 | |
| 15 | Uktar (The Rotting) | 30 | |
| 16 | Feast of the Moon | 1 | ✓ |
| 17 | Nightal (Drawing Down) | 30 | |

- **Leap rule:** `{ name:'Shieldmeet', monthIndex:10, interval:4, offset:0, addDays:1 }` (a day exists only when `year % 4 === 0`).
- **weekdays:** 10 tenday day-names (e.g. "First"…"Tenth").
- **yearSuffix:** `"DR"`. **namedYears:** a few canonical ones (e.g. 1358 "Year of Shadows", 1385 "Year of Blue Fire").
- **moons:** Selûne, ~30-day cycle (display-only).
- **seasons:** Winter / Spring / Summer / Autumn at reasonable month starts.
- **holidays:** the five festivals (display markers; the festival days themselves).
- **currentDate:** current era ~1491 DR (e.g. Mirtul 1491 DR). 1491 is not a Shieldmeet year, so the leap path is instead exercised by a seeded 1488 DR event.

### Sample events (~10; Harptos dates; linked to existing seeded entities)
Mix of public/private, a couple epic, one multi-day span, links across all 5 entity kinds + sessions:
- **The Time of Troubles** — 1358 DR — epic, public (world-lore; Mystra falls)
- **The Spellplague** — 1385 DR — epic, public (world-lore)
- **Shieldmeet Grand Council** — 1488 DR (real Shieldmeet/leap year — exercises the leap day)
- **Founding of Phandalin** — links Phandalin location + phandalin-history lore
- **The Siege of Phandalin** — multi-day (start+end), epic — links Gundren, Redbrands, Phandalin
- **Gundren's Disappearance** — private (GM-only) — links Gundren + Black Spider lore
- **Wave Echo Cave Rediscovered** — links a location + dragon-legend lore
- **Greengrass in Phandalin** — falls on the Greengrass festival day — links players
- **+ ~2 more** covering a session link and a race link

Ordinals are computed in the Python seed via a small port of `toOrdinal`; a test asserts the Python and TS engines agree on the seed dates (prevents drift). Event banner images via `scripts/gen_seed_event_images.mjs` (mirrors `gen_seed_lore_images.mjs`).

## Testing strategy

- **Engine (priority):** exhaustive unit + property tests in `tests/utils/calendarEngine.test.ts` — round-trip `fromOrdinal(toOrdinal(d)) === d` across thousands of dates incl. leap and negative years; month/leap boundaries; weekday continuity in both modes; intercalary-day handling; `validateDate` rejections; moon/season/holiday spot-checks vs hand-computed values; Harptos-specific assertions (365/366-day years, Shieldmeet only in `year % 4 === 0`).
- **Server:** `tests/server/functions/{calendars,events}.test.ts` — visibility filtering (GM vs member), `gmContent` stripping, GM-only mutation guards, ordinal recompute on event write, and the calendar-edit re-validation/recompute transaction incl. invalid-date flag-back.
- **Cross-language:** test asserting the Python seed's `toOrdinal` matches the TS engine for the seed dates.
- **E2E:** `e2e/calendar/` — GM configures calendar + creates an event; player sees a public event on the list/grid but not a private one; an epic event appears on the dashboard timeline; drag an event onto a GM screen. Requires the `VITE_PUBLIC_FF_*` flags (per repo memory) so the Wiki/Calendar tabs render.

## Build phasing (each phase independently shippable & tested)

1. **Engine + types/schemas** — pure module, fully tested, before any UI or DB.
2. **DB models + server functions + hooks** — with server tests.
3. **Calendar viewing** (list + grid, read-only) + wiki "Calendar" category.
4. **Calendar editor** (GM config) + **Events management** (GM CRUD, links).
5. **Seed data** (Harptos calendar + sample events) + event seed images.
6. **Epic timeline widget** swap to real epic events.
7. **E2E** specs.

## Risks & mitigations

- **Leap-day / intercalary off-by-one (Kanka's #1 bug):** all math in one pure engine; round-trip property tests; Harptos seed exercises the leap path; festivals modeled as in-order intercalary months so ordinal math stays a simple sum.
- **Stale event dates after a calendar edit:** server transaction re-validates + recomputes all ordinals; invalid dates flagged to the GM, never silently moved.
- **Python/TS date drift in seed:** cross-language equality test on seed dates.
- **Scope creep toward Kanka parity:** multiple calendars, recurring events, fuzzy dates, and time-of-day are explicit non-goals; schema leaves room for multiple calendars without migration.
