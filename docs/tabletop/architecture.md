# Architecture

## Dual Renderer Strategy

The tabletop uses two rendering engines depending on the screen mode:

```
                     TabletopCanvas
                          |
             +------------+------------+
             |                         |
        mode=grid/battlemap       mode=map
             |                         |
         Konva (Stage)           Leaflet (Map)
    react-konva canvas        react-leaflet tiles
```

- **Konva** handles grid and battle map modes. It renders a `<Stage>` with
  layered `<Layer>` components for the grid, tokens, drawings, and UI overlays.
- **Leaflet** (Phase 2) will handle the map mode with tile layers and marker
  overlays.

Both renderers receive the same `TabletopScreenDetailData` and produce output
inside the same container `<div>`. Only one renderer is active per screen.

## 6-Layer Compositing Stack

Layers are rendered bottom-to-top. Phase 1 implements the base and UI layers;
the rest are scaffolded for later phases.

```
  +---------------------------------------------+
  |  6. UI Layer          (pings, cursors)       |  <- PingOverlay (Konva Layer)
  +---------------------------------------------+
  |  5. Token Layer       (character tokens)     |  <- Phase 3
  +---------------------------------------------+
  |  4. Drawing Layer     (freehand, shapes)     |  <- Phase 3
  +---------------------------------------------+
  |  3. Fog of War Layer  (reveal/hide regions)  |  <- Phase 2
  +---------------------------------------------+
  |  2. GM Hidden Layer   (GM-only annotations)  |  <- Phase 3
  +---------------------------------------------+
  |  1. Base Layer        (grid / map tiles)     |  <- DefaultGrid (Konva Stage)
  +---------------------------------------------+
```

The base layer is rendered by `DefaultGrid` in grid mode, which draws a Konva
`<Rect>` background and `<Line>` elements for the grid. Four grid themes are
available: `dark`, `parchment`, `hex`, `whiteboard`.

## Component Tree

```
  TabletopView
  |-- TabletopTabBar            Tab strip with badge dots + GM controls
  |   |-- TabBar (shared)       Generic reusable tab bar component
  |   +-- [+ button / Focus]    GM-only: add tab, focus all players
  |
  +-- TabletopCanvas            Measures container, selects renderer
  |   +-- DefaultGrid           Konva Stage with grid lines (Phase 1)
  |       |-- Stage
  |       +-- Layer
  |           |-- Rect          Background fill
  |           +-- Line[]        Grid lines (vertical + horizontal)
  |
  +-- FloatingWindowManager     Manages draggable/resizable windows
  |   |-- FloatingWindow[]      One per open wiki ref
  |   +-- FloatingWindowTray    Minimized window strip
  |
  +-- PingOverlay (Phase 1)     Ephemeral ping animations (Konva Layer)
      |-- Circle (ring)
      |-- Circle (dot)
      +-- Text (user name)
```

## Permissions Model

| Action                       | GM  | Player |
| ---------------------------- | --- | ------ |
| Create / rename / delete tab | Y   | N      |
| Focus all players to a tab   | Y   | N      |
| Change grid style / size     | Y   | N      |
| Open window on tabletop      | Y   | N      |
| Close window on tabletop     | Y   | N      |
| Switch active tab            | Y   | Y      |
| Pan / zoom viewport          | Y   | Y      |
| Send ping                    | Y   | Y      |
| See notification badges      | Y   | Y      |
| Override window position     | Y   | Y      |

GM checks are enforced both in the UI (`isGM` prop) and on the server
(`requireCampaignGM` helper). The server functions use Clerk session
tokens to authenticate and MongoDB campaign membership to authorise.

## File Organisation

```
app/
  types/
    tabletop.ts                 Type definitions and const arrays
    schemas/
      tabletop.ts               Zod validation schemas
  hooks/
    useTabletopScreens.ts       Screen list/detail queries + mutations
    useTabletopPlayerState.ts   Player state query + mutation
    useTabletopParty.ts         PartyKit WebSocket connection
  server/
    functions/
      tabletop.ts               Screen CRUD + player state server fns
      tabletop-hydration.ts     Batch-hydrate wiki refs for windows
      session-events.ts         Session event create/list server fns
    db/models/
      TabletopScreen.ts         Mongoose model (screens + windows)
      TabletopPlayerState.ts    Mongoose model (per-user state)
      SessionEvent.ts           Mongoose model (session timeline)
  components/
    mainview/tabletop/
      TabletopView.tsx           Root orchestrator component
      TabletopTabBar.tsx         Tab strip with badges
      TabletopCanvas.tsx         Container + renderer selector
      DefaultGrid.tsx            Konva grid renderer
      PingOverlay.tsx            Ephemeral ping animations
    mainview/
      FloatingWindowManager.tsx  Window lifecycle manager
      FloatingWindow.tsx         Single draggable/resizable window
      FloatingWindowTray.tsx     Minimized window strip
    wiki/shared/
      ShowOnTabletopButton.tsx   GM button to push wiki items to tabletop
  utils/
    queryKeys.ts                React Query key factory (tabletop namespace)

party/
  tabletop.ts                   PartyKit server (broadcast relay)
  index.ts                      Main PartyKit server (chat/dice)

e2e/
  tabletop/                     Playwright E2E tests
```
