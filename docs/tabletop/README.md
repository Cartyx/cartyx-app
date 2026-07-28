# Tabletop VTT

The Tabletop is a shared virtual surface where the GM and players interact during a
campaign session. It renders an uploaded map (or a plain configurable grid when no
map is active), supports tokens, drawings, text and spell-effect templates,
displays wiki documents as floating windows, and synchronises changes in real time
via the `realtime/` service.

## Surfaces

Which surface renders is decided by whether the active tab has a **map**, not by
the screen's `mode` field:

| Condition          | Renderer         | What it is                                      |
| ------------------ | ---------------- | ----------------------------------------------- |
| Active map present | `ActiveMapStage` | DOM `<img>` + SVG overlays; the primary surface |
| No active map      | `DefaultGrid`    | Konva `<Stage>` drawing a square grid           |

`TABLETOP_MODES` (`grid` / `map` / `battlemap`) still exists in
`app/types/tabletop.ts` and is persisted and schema-validated, but **nothing reads
it** — it is a dead field.

> Historical note: earlier revisions described a mode-keyed renderer table with
> Leaflet serving `map` mode. Leaflet was never adopted and has never been a
> dependency; maps shipped as DOM + SVG instead.

## Key Concepts

- **Screen** -- A single tabletop surface. A campaign can have multiple screens
  organised as tabs. Stored as `TabletopScreen` in MongoDB.
- **Layer** -- The GM-only Layers panel lists four layers (Fog of War, Public
  Tokens, GM-Private Tokens, Map). Spell effects, drawings and text are **not**
  layers — each has its own per-viewer zoom-toolbar toggle. See
  [architecture.md](./architecture.md).
- **Player State** -- Per-user preferences (active tab, viewport zoom/pan, window
  overrides, active GM screen, private windows). Stored as `TabletopPlayerState`
  in MongoDB.
- **Session Event** -- Write-once records that capture GM actions during a session
  (reveal document, start battle, etc.). Used for timeline and recap.
- **Floating Window** -- A draggable/resizable panel on the tabletop that shows
  hydrated content from any wiki collection (notes, characters, races, rules,
  players).
- **Private Window** -- A window only its owner can see, added from a wiki card's
  overflow menu ("Show on Tab"). Stored in `TabletopPlayerState.privateWindows[]`,
  never broadcast. Contrast with the shared windows on `TabletopScreen.windows[]`
  / `GMScreen.windows[]`, which a GM opens for everyone ("Push to Tabletop").

## Documentation

| File                                       | Content                                    |
| ------------------------------------------ | ------------------------------------------ |
| [architecture.md](./architecture.md)       | Component tree, compositing, permissions   |
| [data-flow.md](./data-flow.md)             | State ownership, persistence, reconnect    |
| [real-time-sync.md](./real-time-sync.md)   | Realtime service, message types, conflicts |
| [adding-features.md](./adding-features.md) | How to extend the tabletop                 |
| [dice-roller.md](./dice-roller.md)         | Dice roller feature, architecture, flow    |

## Status

**Shipped:** tab management, floating windows, real-time sync, "Show on Tabletop",
session events, map upload + active map per tab, public and GM-private tokens,
drawing tools (GM-only), map text, spell AoE templates, ruler, dice roller,
per-user private windows via the wiki-card overflow menu.

Every wiki card (characters, players, locations, organizations, quests, events,
lore, races, spells, rules, monsters) has an overflow menu with up to four
actions: Edit (per-item `canEdit`, or `isGM` for races/rules/monsters, or
`isGM && homebrew` for spells), "Show on Tab" (any member, private, current
tab), "Push to Tabletop" (GM only, shared, always the Tabletop), and Delete (GM
only — deliberately not `canEdit`, since a creator may edit but only a GM
deletes). Calendar has no cards; maps keep their own overflow menu
(`MapCard`), not this one.

**Known limitation:** opening a window — by push, drag-drop, or "Show on Tab"
— is persisted but not broadcast live. Other users see it on their next fetch
or reload, not in real time. `window:show` has a realtime message type and a
receive-side handler, but no client emits it yet; this predates private
windows (drag-drop had the same gap).

**Not built:** fog of war (a placeholder row in the Layers panel), battle map
mode, pings, shared cursors.
