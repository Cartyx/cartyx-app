# Tabletop Tab — Design Specification

## Overview

The Tabletop tab is a virtual tabletop (VTT) system within the campaign view that provides shared, real-time visual space for Game Masters and players. It supports three modes: default grid, regular maps (world/city), and battle maps (grid-based combat). The GM controls what's displayed, and all connected players see changes in real-time.

## Core Principles

- **Dual rendering engine**: Konva.js for battle maps (grid/token focused), Leaflet for regular maps (tile-zoom focused)
- **Layered compositing**: 6-layer stack from base image to UI overlay
- **Real-time sync**: All changes broadcast via PartyKit WebSocket
- **Persistent state**: Every element position saved to MongoDB; players resume exactly where they left off
- **Incremental delivery**: 4 phases, each independently shippable with manual testing gates between them

## Architecture Decisions

| Decision             | Choice                           | Rationale                                                     |
| -------------------- | -------------------------------- | ------------------------------------------------------------- |
| Battle map renderer  | Konva.js (react-konva)           | Snap-to-grid, drag-and-drop tokens, drawing shapes are native |
| Regular map renderer | Leaflet (react-leaflet)          | Tile-based multi-level zoom, pan, measurement built-in        |
| Real-time sync       | PartyKit (existing)              | Already used for chat/dice; session-scoped rooms              |
| Persistence          | MongoDB (existing)               | Follows GMScreen pattern; debounced saves                     |
| State management     | React Query + optimistic updates | Matches existing app patterns                                 |
| Image storage        | Cloudflare R2 (existing)         | Already used for avatars/campaign images                      |
| Responsive target    | Laptops, PCs, tablets            | Phones are not a priority for this feature                    |
| Unit system          | Campaign-level setting           | GM sets units once; gridScale is per-screen                   |

---

## Data Model

### Campaign Model Addition

Add to existing Campaign model:

```typescript
{
  // ... existing fields ...
  unitSystem: {
    smallUnit: string; // "feet", "meters" — used on battle maps
    largeUnit: string; // "miles", "km" — used on world maps
  }
}
```

### New Collections

#### Location

```typescript
{
  _id: ObjectId
  campaignId: ObjectId
  createdBy: ObjectId
  name: string                    // "Waterdeep", "Sword Coast"
  locationType: string            // references LocationType.name
  description: string             // public markdown text (rendered with markdown editor)
  gmNotes: string                 // GM-only markdown text
  isPublic: boolean               // visibility flag
  parentLocations: ObjectId[]     // linked parent locations (many-to-many)
  childLocations: ObjectId[]      // linked child locations
  mapImage: string | null         // R2 path to map image
  mapBounds: {                    // for tile positioning within parent map
    north: number
    south: number
    east: number
    west: number
  } | null
  tags: ObjectId[]
  createdAt: Date
  updatedAt: Date
}
```

**Access control**: If `isPublic: false`, only the creator and GMs can see it. If `isPublic: true`, everyone can see it but only the creator and GMs can edit.

#### LocationType

```typescript
{
  _id: ObjectId;
  campaignId: ObjectId;
  name: string; // "continent", "city", "cave", etc.
  isDefault: boolean; // system-provided vs GM-created
  sortOrder: number;
}
```

**Seeded defaults**: continent, country, region, state, province, city, town, village, cave, dungeon, planet

GMs can add custom types dynamically (e.g., "plane", "demiplane", "island").

#### TabletopScreen

```typescript
{
  _id: ObjectId
  campaignId: ObjectId
  name: string                // tab display name
  tabOrder: number
  createdBy: ObjectId

  // Display mode
  mode: 'grid' | 'map' | 'battlemap'
  locationId: ObjectId | null       // linked location (for mode='map')
  battleMapImage: string | null     // R2 path (for mode='battlemap')

  // Grid settings
  gridStyle: 'dark' | 'parchment' | 'hex' | 'whiteboard'
  gridSize: number                  // pixels per cell
  gridVisible: boolean

  // Scale (gridScale is per-screen; unit names come from Campaign.unitSystem)
  gridScale: number           // e.g. 5 (5ft per square) — per-screen

  // Layer data
  layers: {
    fogOfWar: [{
      id: string
      points: [number, number][]    // polygon vertices
      revealed: boolean
    }]
    drawings: [{
      id: string
      type: 'freeform' | 'circle' | 'rect' | 'square' | 'line' | 'arrow' | 'polygon' | 'cone' | 'text' | 'stamp'
      points: [number, number][]    // shape vertices/path
      color: string
      fillColor: string | null
      opacity: number
      lineWidth: number
      text: string | null           // for type='text'
      stampImage: string | null     // for type='stamp'
      createdBy: ObjectId
    }]
    tokens: [{
      id: string
      documentId: ObjectId
      collection: 'character' | 'player' | 'monster'
      x: number
      y: number                     // grid position
      size: number                  // 1=medium, 2=large, 3=huge, 4=gargantuan
      createdBy: ObjectId
    }]
    gmHidden: [{                    // GM-only elements (drawings, tokens, notes)
      id: string
      type: 'drawing' | 'token' | 'marker'
      data: object                  // same shape as drawings[] or tokens[]
    }]
  }

  // Floating windows (reuses GMScreen window schema)
  windows: WindowSchema[]

  createdAt: Date
  updatedAt: Date
}
```

#### TabletopPlayerState

```typescript
{
  _id: ObjectId
  campaignId: ObjectId
  userId: ObjectId
  activeScreenId: ObjectId | null   // which tab they're viewing
  viewports: [{
    screenId: ObjectId
    zoom: number
    panX: number
    panY: number
  }]
  windowOverrides: [{               // per-player window position overrides
    windowId: string
    x: number
    y: number
    width: number
    height: number
    state: 'open' | 'minimized' | 'hidden'
  }]
}
```

#### SessionEvent

```typescript
{
  _id: ObjectId;
  campaignId: ObjectId;
  sessionId: ObjectId;
  timestamp: Date;
  eventType: 'reveal_document' | 'reveal_location' | 'map_change' | 'battle_start' | 'token_placed';
  documentId: ObjectId; // the item shown/revealed
  collection: string; // 'character', 'location', 'monster', 'note', 'rule', 'race'
  tabletopScreenId: ObjectId; // which tab it appeared on
  triggeredBy: ObjectId; // who did it (usually GM)
  displayName: string; // snapshot of name at time of reveal
}
```

---

## Layer Architecture

Rendering order (bottom to top), consistent across both engines:

| Layer | Name       | Description                       | Visibility                       |
| ----- | ---------- | --------------------------------- | -------------------------------- |
| 0     | Base       | Map image or default grid pattern | Everyone                         |
| 1     | GM Hidden  | GM-only prep content              | GM only                          |
| 2     | Fog of War | Revealed/hidden polygon regions   | Everyone (GM controls)           |
| 3     | Drawing    | Shared annotation layer           | Everyone                         |
| 4     | Tokens     | Character/monster icons           | Everyone                         |
| 5     | UI         | Floating windows (wiki items)     | Everyone (with permission rules) |

---

## Component Architecture

```
TabletopView
├── TabletopTabBar
│   ├── Tab[] (name, active state, notification badge)
│   ├── AddTabButton (GM only)
│   └── FocusAllButton (GM only)
│
├── TabletopCanvas (switches renderer based on screen.mode)
│   ├── BattleMapCanvas (Konva/react-konva)
│   │   ├── BaseLayer (grid or battle map image)
│   │   ├── GMHiddenLayer
│   │   ├── FogOfWarLayer
│   │   ├── DrawingLayer
│   │   ├── TokenLayer
│   │   └── GridOverlay
│   │
│   ├── MapCanvas (Leaflet/react-leaflet)
│   │   ├── TileLayer / ImageOverlay
│   │   ├── GMHiddenLayer
│   │   ├── FogOfWarLayer
│   │   ├── DrawingLayer
│   │   └── LocationMarkers
│   │
│   └── DefaultGrid (Konva)
│       ├── GridPattern (styled)
│       └── DrawingLayer
│
├── TabletopToolbar
│   ├── SelectTool (select/move existing drawings)
│   ├── DrawingTools
���   │   ├── Freehand pen
│   │   ├── Line
│   │   ├── Arrow
│   │   ├── Rectangle
│   │   ├── Square
│   │   ├── Circle
│   │   ├── Polygon (arbitrary vertices)
│   │   ├── Cone/wedge
│   │   ├── Text
│   │   └── Stamp (place image)
│   ├── StyleControls
│   │   ├── Color picker (stroke)
│   │   ├── Fill color + opacity
│   │   └── Line thickness
│   ├── EraserTool
│   ├── RulerTool (measure distance)
│   ├── PingTool (flash attention circle)
│   ├── FogTools (GM only — reveal/hide polygon)
│   ├── UndoRedo
│   ├── ZoomControls
│   └── GridToggle
│
├── FloatingWindowManager (shared with GM Screens)
│   └── FloatingWindow[]
│
└── TabletopSidebar (collapsible)
    ├── TokenTray (drag tokens onto map)
    ├── LayerPanel (toggle visibility)
    └── MapNavigator (breadcrumb for zoom levels)
```

### Code Reuse Plan

| Component                | Current Location                   | Action                                               |
| ------------------------ | ---------------------------------- | ---------------------------------------------------- |
| FloatingWindow           | mainview/FloatingWindow.tsx        | Already shared — reuse as-is                         |
| FloatingWindowManager    | mainview/FloatingWindowManager.tsx | Refactor to shared/FloatingWindowManager.tsx         |
| TabBar                   | shared/TabBar.tsx                  | Already shared — extend with notification badge prop |
| Window persistence logic | hooks/useGMScreens.ts              | Extract into shared useWindowManager hook            |
| Document hydration       | server/functions/gmscreens.ts      | Extract into shared utility                          |
| Wiki drag source         | wiki components (dragStart)        | Already uses shared MIME type — works as-is          |

---

## Real-Time Sync

### PartyKit Message Types

```typescript
// Token movement
{ type: 'token:move', screenId, tokenId, x, y, movedBy }

// Drawing
{ type: 'draw:add', screenId, drawing: DrawingShape }
{ type: 'draw:remove', screenId, drawingId }
{ type: 'draw:clear', screenId, clearedBy }
{ type: 'draw:move', screenId, drawingId, x, y }

// Fog of war (GM only)
{ type: 'fog:reveal', screenId, polygon: Point[] }
{ type: 'fog:hide', screenId, polygon: Point[] }

// Floating windows
{ type: 'window:show', screenId, window: WindowData }
{ type: 'window:close', screenId, windowId }

// Tab management
{ type: 'tab:create', screen: TabletopScreen }
{ type: 'tab:rename', screenId, name }
{ type: 'tab:delete', screenId }
{ type: 'tab:focus-all', screenId }

// Ping (ephemeral — not persisted)
{ type: 'ping', screenId, x, y, userId, color }

// Notifications
{ type: 'tab:content-added', screenId }

// Session events (logged for timeline)
{ type: 'session:event', event: SessionEvent }

// Undo/redo
{ type: 'undo', screenId, userId }
{ type: 'redo', screenId, userId }
```

### Sync Flow

1. User action → update local state immediately (optimistic)
2. Broadcast via PartyKit to all connected clients
3. Other clients receive and apply update to their local state
4. Debounced save to MongoDB (500ms) for persistence
5. On reconnect/page load: full state loaded from MongoDB

### Ping Behavior

- Ephemeral — 2-3 second pulsing/flashing circle, then fades
- Not persisted to database
- Color-coded per player (use player's assigned color or avatar color)
- Shows small label with player name
- Any player can ping at any time (no permission restriction)
- Broadcasts to all players on the same tab

---

## Drawing Tools

### Full Tool List

| Tool        | Description                                     | Sync                       |
| ----------- | ----------------------------------------------- | -------------------------- |
| Select/Move | Click existing drawings to reposition or resize | Persisted                  |
| Freehand    | Pen tool for freeform drawing                   | Persisted                  |
| Line        | Straight line between two points                | Persisted                  |
| Arrow       | Line with arrowhead for direction               | Persisted                  |
| Rectangle   | Drag to create rectangle                        | Persisted                  |
| Square      | Drag to create square (constrained)             | Persisted                  |
| Circle      | Drag from center to create circle               | Persisted                  |
| Polygon     | Click vertices to create closed shape           | Persisted                  |
| Cone/Wedge  | Spell effect cone from origin point             | Persisted                  |
| Text        | Click to place text label on map                | Persisted                  |
| Stamp       | Place an image onto the map                     | Persisted                  |
| Eraser      | Click on drawings/stamps to remove              | Persisted                  |
| Ruler       | Measure distance between two points             | Ephemeral (not saved)      |
| Ping        | Flash attention circle at click point           | Ephemeral (broadcast only) |
| Fog Reveal  | Draw polygon to reveal area (GM only)           | Persisted                  |
| Fog Hide    | Draw polygon to hide area (GM only)             | Persisted                  |

### Style Controls

- Stroke color (color picker)
- Fill color (color picker + "no fill" option)
- Opacity slider (0-100%)
- Line thickness (thin, medium, thick, extra thick)

### Undo/Redo

- Per-user undo stack (you can only undo your own drawings)
- GM can undo any drawing (and has "clear all" for the annotation layer)
- Undo/redo broadcasts to all players so they see the change

---

## Permissions

| Action                     | Player | GM  |
| -------------------------- | ------ | --- |
| Move own token             | Yes    | Yes |
| Move other player's token  | No     | Yes |
| Move monster tokens        | No     | Yes |
| Draw on shared layer       | Yes    | Yes |
| Erase own drawings         | Yes    | Yes |
| Erase others' drawings     | No     | Yes |
| Clear all drawings         | No     | Yes |
| Reveal/hide fog            | No     | Yes |
| Create/delete tabs         | No     | Yes |
| Rename tabs                | No     | Yes |
| Place tokens               | No     | Yes |
| Remove tokens              | No     | Yes |
| Show wiki item on tabletop | No     | Yes |
| Ping                       | Yes    | Yes |
| Use ruler                  | Yes    | Yes |
| Draw on GM hidden layer    | No     | Yes |
| Focus all players to tab   | No     | Yes |

---

## Responsive Design

**Target platforms** (priority order):

1. Desktop (laptops, PCs) — full experience with toolbar, sidebar, floating windows
2. Tablets (iPad, Android tablets) — touch-friendly with collapsible toolbar/sidebar
3. Phones — not a priority; basic view-only mode at most

**Tablet considerations:**

- Touch gestures: pinch-to-zoom, two-finger pan, long-press for context menu
- Collapsible toolbar (expands on tap)
- Collapsible sidebar
- Floating windows may need a "drawer" mode on smaller tablets
- Drawing tools work with finger/stylus (Apple Pencil, S Pen)

---

## "Show on Tabletop" Feature

### UX Flow

1. User views any wiki item (note, character, location, race, rule) in the wiki panel
2. A "Show on Tabletop" button is visible (GM only)
3. GM clicks the button → item appears as a floating window on the currently active tabletop tab
4. The window broadcasts to all players via PartyKit
5. Players on other tabs see a notification badge flash on the target tab
6. A `SessionEvent` is logged with timestamp for the session history/recap

### Floating Window Permissions (on Tabletop)

- **Edit button visible**: Only to the GM and the player who created the item
- **Close button**: Visible to all (closes for that player only via TabletopPlayerState.windowOverrides)
- **GM close**: GM can close for everyone (removes from TabletopScreen.windows)

---

## Session Event Logging

### Purpose

Creates an ordered timeline of what was introduced/revealed during each session. Feeds into:

- Session recap ("Previously on...")
- Campaign timeline / epic history
- Player catch-up for missed sessions

### Logged Events

| Event Type        | Trigger                                         |
| ----------------- | ----------------------------------------------- |
| `reveal_document` | GM clicks "Show on Tabletop" for any wiki item  |
| `reveal_location` | GM switches a tab to show a new location/map    |
| `map_change`      | GM changes the map displayed on a tab           |
| `battle_start`    | GM switches a tab to battle map mode            |
| `token_placed`    | GM places a new monster/NPC token on battle map |

### Usage

Query `SessionEvent` by `sessionId`, ordered by `timestamp`, to produce:

- "In Session 12: The party discovered _The Sword Coast_ (location), met _Elminster_ (character), and fought _3 Ghouls_ (monsters)."

---

## Tile-Based Multi-Level Zoom (Regular Maps)

### How It Works

Leaflet with `CRS.Simple` (non-geographic coordinate system):

1. **Top-level map**: Continent/world image displayed as `L.ImageOverlay`
2. **Sub-maps**: Child locations with `mapBounds` defined relative to the parent
3. **Zoom behavior**: As user zooms in past a threshold, higher-detail child map images load and replace the parent view
4. **Coordinate mapping**: Each child location's `mapBounds` defines where it sits within its parent's coordinate space

### GM Setup Flow

1. Upload parent map image (e.g., continent)
2. Create child location (e.g., "Kingdom of Amn")
3. Upload child map image
4. Position the child on the parent map by defining bounds (drag corners or input coordinates)
5. Repeat for deeper levels (city within kingdom, district within city)

### Asset Requirements

- **Minimum**: One image per location that has a map
- **For seamless zoom**: Images at each zoom level should be progressively higher resolution for their area
- **Tile generation** (optional, for very large maps): Split large images into tile sets (256x256px tiles at each zoom level) using a preprocessing script. This is an optimization for maps > 4096x4096px.

---

## Default Grid (No Map)

When no map or battle map is assigned to a tab, the tabletop displays an attractive default grid.

### Grid Style Presets

| Style            | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `dark` (default) | Dark background (#0D1117) with subtle lighter grid lines (#1a2332). Matches app theme. |
| `parchment`      | Warm aged paper texture with ink-drawn grid lines. Fantasy feel.                       |
| `hex`            | Hexagonal grid on dark background. For hex-based game systems.                         |
| `whiteboard`     | Clean white background with light gray grid. Minimal, utilitarian.                     |

The GM selects a grid style per-tab. Can be changed anytime.

---

## Phased Implementation

### Phase 1: Foundation — Grid + Tabs + Floating Windows

**Goal**: A working tabletop with tabs, default grid, and "Show on Tabletop" from wiki.

**Deliverables**:

- TabletopScreen MongoDB model + CRUD server functions
- Tab system (GM creates/renames/deletes, players navigate independently)
- Default grid rendering (Konva) with style presets
- Refactor FloatingWindowManager to be shared between GM Screens and Tabletop
- "Show on Tabletop" button on wiki items
- Tab notification badges (flash when new content arrives)
- PartyKit integration for real-time window broadcasts
- TabletopPlayerState for per-player viewport/tab memory
- SessionEvent logging when items are revealed
- "Focus All" button for GM
- Ping tool (ephemeral broadcast)

**Testing gate**: Manual testing of tab creation, window display, real-time sync between multiple browser sessions, persistence across page reloads.

---

### Phase 2: Locations + Regular Maps (Leaflet)

**Goal**: Location hierarchy in wiki + map display with zoom and measurement.

**Deliverables**:

- Location + LocationType MongoDB models
- Wiki section for Locations (CRUD, search, public/private, markdown descriptions)
- Location hierarchy UI (parent/child linking, breadcrumb navigation)
- Map image upload for locations (R2)
- Leaflet MapCanvas component (mode='map')
- Single-image map display with zoom/pan
- Tile-based multi-level zoom (child locations as zoom targets)
- Ruler/measurement tool (campaign unit system)
- Location markers on maps (clickable POIs)
- Drawing tools on maps (full toolbar via Leaflet.draw / canvas overlay)
- Fog of war on maps (polygon reveal/hide)
- GM hidden layer for map prep
- Undo/redo for drawings

**Testing gate**: Manual testing of location creation, map display, multi-level zoom transitions, drawing tools, ruler accuracy, fog of war, real-time sync of all map operations.

---

### Phase 3: Battle Maps (Konva)

**Goal**: Grid-based combat with tokens, drawing, and fog of war.

**Deliverables**:

- Battle map image upload
- BattleMapCanvas component (Konva with grid overlay)
- Grid scale calibration wizard (DnD Beyond-style circle-in-square)
- Token system — drag characters/monsters onto grid, snap to cells
- Player token movement (own tokens only, real-time sync)
- Token tray sidebar (available characters/monsters to place)
- Full drawing toolbar (freeform, shapes, text, stamps, arrows, polygons, cones)
- Spell effect templates
- Fog of war (GM reveals/hides polygon regions)
- Ruler tool with grid-aware snapping (counts squares)
- Zoom controls for battle map
- Select/move tool for repositioning drawn elements
- Eraser tool
- Undo/redo

**Testing gate**: Manual testing of token placement/movement, snap-to-grid accuracy, scale calibration, drawing tools (all types), fog of war, real-time sync of token movement between players.

---

### Phase 4: Polish & Advanced Features (Future)

**Goal**: Enhanced VTT experience.

**Potential features** (each independent):

- Dynamic lighting (wall-based line-of-sight)
- Per-token vision (each player sees only what their character sees)
- Light sources (torches, darkvision ranges)
- Initiative tracker integration
- Token status effects (conditions, HP bars)
- Map linking (click a door → opens new map tab)
- Animated tokens/effects
- Map sharing between campaigns
- Session recap auto-generation from SessionEvents
- Stamp library management (upload custom stamps)

---

## Testing Strategy

This is a complex real-time multi-user system. Automated testing is critical at every level.

### Test Stack

| Level       | Tool                           | What It Tests                                                        |
| ----------- | ------------------------------ | -------------------------------------------------------------------- |
| Unit        | Vitest                         | Server functions, data validation, permission logic, coordinate math |
| Component   | Vitest + React Testing Library | Individual UI components in isolation                                |
| Integration | Vitest                         | Server function → MongoDB round-trips, PartyKit message handling     |
| E2E         | **Playwright**                 | Full multi-user flows across multiple browser sessions               |

### Playwright E2E Tests (Primary Focus)

Playwright is the core testing tool for this feature because it can simulate **multiple concurrent browser sessions** — essential for testing real-time sync between GM and players.

#### Multi-Browser Session Testing

```typescript
// Example: GM places token, player sees it in real-time
test('GM places token visible to player', async ({ browser }) => {
  const gmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const gmPage = await gmContext.newPage();
  const playerPage = await playerContext.newPage();

  // GM logs in, navigates to tabletop, places token
  // Player logs in, navigates to same campaign tabletop
  // Assert: player sees token appear at correct grid position
});
```

#### Phase 1 E2E Tests

- GM creates a tab → all connected players see the new tab appear
- GM renames/deletes a tab → reflected for all players
- Player switches tabs independently (does not affect others)
- GM clicks "Focus All" → all players switch to that tab
- GM clicks "Show on Tabletop" on a wiki item → floating window appears for all players on that tab
- Players on other tabs see notification badge flash
- Tab notification badge clears when player switches to that tab
- Player moves/resizes floating window → position persists on reload (personal)
- GM closes a floating window → removed for all players
- Player closes a floating window → only hidden for that player
- Ping tool → all players see flashing circle at correct position, fades after ~3s
- Full state persists: close browser, reopen → tabs, windows, positions all restored
- SessionEvent created when GM reveals wiki item (query DB to verify)
- Default grid renders with correct style preset
- GM changes grid style → all players see updated grid

#### Phase 2 E2E Tests

- CRUD locations (create, read, update, delete) with correct permissions
- Location hierarchy (link parent/child, breadcrumb navigation)
- Public/private location visibility (player can't see private locations they didn't create)
- GM uploads map image → map displays on tabletop tab
- Multi-level zoom: zoom in past threshold → child map loads
- Ruler tool: measure between two points → displays correct distance in campaign units
- Drawing tools (each type): draw shape → visible to all players in real-time
- Eraser: remove drawing → removed for all players
- Undo/redo: undo drawing → change reflected for all players
- Fog of war: GM reveals region → players see revealed area
- Fog of war: GM hides region → players can no longer see that area
- GM hidden layer: content invisible to player sessions
- Location markers: click POI → shows location info

#### Phase 3 E2E Tests

- Battle map image upload and display
- Grid scale calibration wizard flow
- Token placement: GM drags token from tray → snaps to grid
- Token movement: player drags own token → syncs to all other sessions
- Token permission: player cannot drag another player's token
- Token permission: GM can drag any token
- Snap-to-grid accuracy across zoom levels
- Drawing tools on battle map (all types — freeform, shapes, text, stamps, arrows, polygons, cones)
- Stamp placement and removal
- Select/move tool: reposition existing drawing
- Spell effect templates: place cone/circle at correct grid scale
- Fog of war on battle map: GM reveals/hides polygon
- Ruler with grid snapping: reports correct square count
- Zoom controls maintain correct token/drawing positions
- Full battle map state persistence across reload

#### Cross-Cutting E2E Tests

- Concurrent drawing: two players draw simultaneously → both drawings appear for everyone
- Rapid token movement: drag token quickly → final position syncs correctly (no jitter/desync)
- Disconnect/reconnect: player loses connection → on reconnect, state matches current truth
- Permission escalation: verify player cannot perform GM-only actions via manipulated messages
- Large state: 20+ tokens, 50+ drawings → renders without performance degradation
- Tab with many windows (max 20): all render and persist correctly

### Unit & Integration Tests

#### Server Functions (Vitest)

- TabletopScreen CRUD (create, list, get, update, delete)
- Location CRUD with permission checks
- LocationType management (create, list, seed defaults)
- TabletopPlayerState save/load
- SessionEvent creation and querying
- Permission enforcement (player vs GM role checks)
- Input validation (Zod schemas reject invalid data)

#### Coordinate & Grid Math (Vitest)

- Grid snap calculations (point → nearest grid cell)
- Distance measurement (pixel distance → game units)
- Polygon hit-testing (point inside/outside fog region)
- Map bounds calculations (child within parent coordinates)
- Zoom level → tile resolution mapping

#### PartyKit Message Handling (Vitest)

- Message serialization/deserialization
- Permission filtering (player can't send GM-only messages)
- Broadcast targeting (messages go to correct room/screen)
- Debounce batching (rapid updates coalesce correctly)

### Test Data & Fixtures

- Seed campaigns with pre-configured tabletop screens for E2E
- Test accounts: at least 1 GM + 2 players per test scenario
- Pre-uploaded map images in R2 test bucket
- Location hierarchy fixtures (continent → country → city)

### CI Integration

- E2E tests run on every PR (Playwright in headless mode)
- Unit/integration tests run on every push
- E2E tests tagged by phase so you can run subsets
- Screenshot capture on E2E failure for debugging

---

## Process

Each phase follows this cycle:

1. **Plan** — detailed implementation plan (writing-plans skill)
2. **Build** — implement the phase
3. **Test** — manual testing together, verify real-time sync, persistence, permissions
4. **Tweak** — fix issues discovered during testing
5. **Learn** — document what worked, what didn't, what to bring forward
6. **Next phase** — apply learnings to the next phase's plan

No phase starts until the previous one is manually tested and approved.
