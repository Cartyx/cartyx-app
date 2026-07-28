# Architecture

## Renderer Selection

A tabletop screen renders one of two surfaces, chosen in `TabletopView` by
whether the screen has an **active map** — not by the screen's `mode` field:

```
                      TabletopView
                           |
              +------------+------------+
              |                         |
        activeMap != null          activeMap == null
              |                         |
        ActiveMapStage            TabletopCanvas
     DOM: <img> + SVG overlays      +-- DefaultGrid
                                        Konva <Stage>
```

- **`ActiveMapStage`** is the primary surface and where nearly all tabletop
  features live. It is plain DOM: an `<img>` for the map image, a CSS
  `linear-gradient` grid overlay, SVG overlays for AoE/drawings/text, and
  absolutely-positioned token components. No canvas library is involved.
- **`TabletopCanvas` → `DefaultGrid`** is the fallback when a screen has no map.
  This is the only place Konva is used in the app: a `<Stage>` drawing a `<Rect>`
  background and `<Line>` grid lines, and nothing else.

The two take different props (`ActiveMapStage` takes a `MapData` plus campaign
context; `TabletopCanvas` takes a `TabletopScreenDetailData`).

> Historical note: earlier revisions of this document described a Konva/Leaflet
> dual-renderer keyed on a `mode` enum, with Leaflet serving map tiles. Leaflet
> was never adopted — it has never been a dependency — and the map surface is
> DOM, not Konva. The `mode` field and `TABLETOP_MODES` in `app/types/tabletop.ts`
> still exist and are schema-validated, but nothing reads them.

## Compositing Order

Inside `ActiveMapStage`, DOM order bottom → top. Each element has its own
visibility gate:

| #   | Element                           | Gate                       |
| --- | --------------------------------- | -------------------------- |
| 1   | Map image (`<img>`)               | `!hiddenLayers.has('map')` |
| 2   | Grid overlay (CSS gradient)       | `showGrid && hasGrid`      |
| 3   | Spell AoE (`MapAoELayer`, SVG)    | `showSpellEffects`         |
| 4   | Drawings (`MapDrawingLayer`, SVG) | `isGM && showDrawings`     |
| 5   | Tokens (`MapToken[]`)             | per-layer (see below)      |
| 6   | Map text (`MapTextLayer`)         | `showText`                 |
| 7   | Ruler (`RulerOverlay`)            | active measurement         |

Tokens are individually positioned, not a single layer; `tokenLayerRenderOrder`
in `app/types/mapLayer.ts` sorts GM-private tokens beneath public ones.

## Layers Panel

`MAP_LAYERS` in `app/types/mapLayer.ts` is the single source of truth, ordered
**highest → lowest**:

| Layer        | Label             | Status      |
| ------------ | ----------------- | ----------- |
| `fog`        | Fog of War        | placeholder |
| `public`     | Public Tokens     | shipped     |
| `gm-private` | GM-Private Tokens | shipped     |
| `map`        | Map               | shipped     |

Token layer membership is **derived**, not stored: `tokenLayerId()` computes
`gm-private` vs `public` from the token's `hiddenFromPlayers` flag, so there is
no parallel `layer` field to keep in sync.

Spell effects, drawings, and map text are deliberately **not** layers here. They
don't render on a surface of their own, and each is shown/hidden by its own
per-viewer toggle in the zoom toolbar (`showSpellEffects`, `showDrawings`,
`showText`).

**Everything on this panel is per-viewer and ephemeral.** The panel is GM-only,
and `activeLayer` / `hiddenLayers` are local `useState` — never persisted, never
broadcast. Hiding a layer changes what _the GM_ sees, not what players see.
Selecting a layer is currently cosmetic: nothing reads `activeLayer` to route
input.

Four grid themes exist: `dark`, `parchment`, `hex`, `whiteboard`. Note that
`hex` currently renders an ordinary square grid identical to `dark` — the theme
is declared but not implemented.

## Component Tree

```
  TabletopView                  Root orchestrator (mainview/tabletop/)
  |                             mainview/TabletopView.tsx is a re-export shim
  |-- TabletopTabBar            Tab strip with badge dots + GM controls
  |   |-- TabBar (shared)       Generic reusable tab bar component
  |   +-- [+ button / Focus]    GM-only: add tab, focus all players
  |
  |-- ActiveMapStage            Primary surface when a map is active
  |   |-- MapAoELayer           Spell AoE templates (SVG)
  |   |-- MapDrawingLayer       Freehand + shapes (SVG, GM-only)
  |   |-- MapToken[]            Tokens (public + gm-private)
  |   |-- MapTextLayer          Map text
  |   |-- RulerOverlay          Active measurement
  |   +-- ToolWindow[]          LayersPanel, AoeSettingsPanel,
  |                             DrawingSettingsPanel, TextSettingsPanel,
  |                             RulerSettingsPanel
  |
  |-- TabletopCanvas            Fallback when no map is active
  |   +-- DefaultGrid           Konva Stage: Rect background + Line[] grid
  |
  +-- FloatingWindowManager     Manages draggable/resizable windows
      |-- FloatingWindow[]      One per open wiki ref
      +-- FloatingWindowTray    Minimized window strip
```

Supporting hooks/helpers alongside `ActiveMapStage`: `useViewport`,
`useTokenInteractions`, `useAoeTool`, `useRulerTool`, `useToolWindows`,
`useMapDropTarget`, plus `ActiveMapStage.geometry.ts`, `aoeGeometry.ts`,
`viewportMath.ts`, `placeToolWindow.ts`, `toolWindowState.ts`.

## Permissions Model

| Action                       | GM  | Player | Enforcement    |
| ---------------------------- | --- | ------ | -------------- |
| Create / rename / delete tab | Y   | N      | UI + server    |
| Change grid style / size     | Y   | N      | UI + server    |
| Open window on tabletop      | Y   | N      | UI + server    |
| Close window on tabletop     | Y   | N      | server only\*  |
| Draw on the map              | Y   | N      | UI + server    |
| Use the Layers panel         | Y   | N      | UI only        |
| Focus all players to a tab   | Y   | N      | UI only\*      |
| Switch active tab            | Y   | Y      | member check   |
| Pan / zoom viewport          | Y   | Y      | member check   |
| See notification badges      | Y   | Y      | member check   |
| Override window position     | Y   | Y      | member check   |
| Show item on tab (private)   | Y   | Y      | member check   |
| Push item to tabletop (all)  | Y   | N      | UI + server    |
| Delete wiki item from card   | Y   | N      | UI, server\*\* |

\* Known gaps: the window close button renders for players and fires the
mutation, which the server rejects with `Forbidden` — the window disappears
locally and silently returns. And `tab:focus-all` is relayed by the realtime
service with no role check, so the GM-only restriction is UI-side only.

\*\* The overflow menu's Delete button is deliberately gated on `isGM`, not
`canEdit` — a creator may edit their own item but only a GM removes it from
the card menu. The underlying per-collection delete server functions are less
uniform and predate this feature: `characters`, `locations`, `lore`,
`organizations`, and `quests` still accept the original creator as well as a
GM (`createdBy === userId || member.isGM`), while `players`, `events`, `races`,
`rules`, `monsters`, and `spells` require `isGM` (or `requireCampaignGM`)
outright. This menu doesn't change that — it only
adds a GM-only entry point in front of whichever check the target collection
already enforces.

### Shared vs. private windows

A wiki card's overflow menu can add a window to two different places:

- **Shared** — `TabletopScreen.windows[]` / `GMScreen.windows[]`. Opened only
  by a GM ("Push to Tabletop"), persisted, and visible to every campaign
  member. Uses the existing `openTabletopWindow` mutation and always targets
  the Tabletop's active screen, even from GM Screens.
- **Private** — `TabletopPlayerState.privateWindows[]`. Added by any member
  ("Show on Tab"), persisted, but visible only to its owner and never
  broadcast. Targets whichever surface (Tabletop or GM Screens) is the
  caller's _current_ tab, via the new `activeGMScreenId` field mirroring
  `activeScreenId` on `TabletopPlayerState`.

Because `addPrivateWindow` accepts any collection/id from any member, it and
the private-window hydration path share one deny-set, `canHydratePrivately`
(`app/server/functions/tabletop-hydration.ts`): GM-only collections (`monster`,
`events`) are denied outright for non-GMs, and any hydrated doc with
`isPublic === false` is stripped for non-GM viewers. The write-side check in
`addPrivateWindow` intentionally mirrors the read-side hydration filter so
the two can't drift — a mismatch previously let a player accumulate windows
that hydration silently filtered back out, still counting against the
per-screen window cap.

**Known limitation:** opening a window (push, drag-drop, or "Show on Tab") is
persisted but not broadcast live over the realtime channel — other campaign
members see it on their next fetch or reload, not immediately. `window:show`
exists as a message type and has a receive-side handler in `TabletopView`, but
no client currently emits it. This gap predates private windows (drag-drop had
the same limitation) and is a follow-up, not part of this feature's scope.

Authentication is a **self-issued HS256 JWT** signed with `SESSION_SECRET` via
`jose`, carried in a `cartyx_session` cookie (`app/server/session.ts`).
Authorisation is MongoDB campaign membership: `gameMasterId`, or a `members[]`
entry with `role === 'gm'`. Note `requireCampaignGM` is not a shared helper — it
is redefined per server-function file.

## File Organisation

```
app/
  types/
    tabletop.ts                 Screen types + const arrays
    mapLayer.ts                 MAP_LAYERS + token layer derivation
    map.ts, mapToken.ts, mapDrawing.ts, mapText.ts, mapAoe.ts
    schemas/                    Zod validation schemas
  hooks/
    useTabletopScreens.ts       Screen list/detail queries + mutations
    useTabletopPlayerState.ts   Player state query + mutation
    useTabletopParty.ts         Realtime WebSocket connection (partysocket)
    useTabletopMapParty.ts      Map-room WebSocket connection
    useTabletopMapSync.ts       Map realtime cache application
    useMaps.ts, useMapTokens.ts, useMapDrawings.ts,
    useMapTexts.ts, useMapAoE.ts
  server/
    session.ts                  JWT mint/verify (cartyx_session cookie)
    functions/
      tabletop.ts               Screen CRUD + player state server fns
      tabletop-hydration.ts     Batch-hydrate wiki refs for windows
      maps.ts, mapTokens.ts, mapDrawings.ts, mapTexts.ts, mapAoE.ts
      session-events.ts         Session event create/list server fns
    db/models/
      TabletopScreen.ts         Mongoose model (screens + windows)
      TabletopPlayerState.ts    Mongoose model (per-user state)
      Map.ts, MapToken.ts, MapDrawing.ts, MapText.ts, MapAoE.ts
      SessionEvent.ts           Mongoose model (session timeline)
  components/
    mainview/tabletop/          TabletopView, ActiveMapStage + map layers,
                                tool windows, settings panels, tool hooks
    mainview/
      ToolBar.tsx                Map tool selection
      FloatingWindowManager.tsx  Window lifecycle manager
      FloatingWindow.tsx         Single draggable/resizable window
      FloatingWindowTray.tsx     Minimized window strip
    wiki/shared/
      ShowOnTabletopButton.tsx   GM button to push wiki items to tabletop
  utils/
    queryKeys.ts                React Query key factory (tabletop namespace)

realtime/                       Standalone Node `ws` service
  src/server.ts                 Socket server + room routing
  src/parties/                  tabletop.ts, tabletopMap.ts, session.ts
  src/auth.ts, rooms.ts, history.ts, logger.ts

e2e/
  tabletop/                     Playwright E2E tests
```

> Historical note: the realtime relay previously lived in a `party/` directory
> running on PartyKit. That directory was removed in the self-host migration and
> replaced by the `realtime/` service above. Only `partysocket` (the client
> library) remains.
