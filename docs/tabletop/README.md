# Tabletop VTT

The Tabletop is a shared virtual surface where the GM and players interact during a
campaign session. It renders a configurable grid (with future support for world maps
and battle maps), displays wiki documents as floating windows, and synchronises all
changes in real time via PartyKit.

## Modes

| Mode        | Renderer | Purpose                                       | Phase |
| ----------- | -------- | --------------------------------------------- | ----- |
| `grid`      | Konva    | Default surface with a square grid for tokens | 1     |
| `map`       | Leaflet  | Pannable/zoomable world map from a location   | 2     |
| `battlemap` | Konva    | Grid overlaid on an uploaded battle map image | 3     |

Phase 1 implements the `grid` mode end-to-end. The `map` and `battlemap` modes are
defined in the type system but not yet rendered.

## Key Concepts

- **Screen** -- A single tabletop surface. A campaign can have multiple screens
  organised as tabs. Stored as `TabletopScreen` in MongoDB.
- **Layer** -- Screens are composited from six ordered layers (base through UI).
  See [architecture.md](./architecture.md) for the full stack.
- **Player State** -- Per-user preferences (active tab, viewport zoom/pan, window
  overrides). Stored as `TabletopPlayerState` in MongoDB.
- **Session Event** -- Write-once records that capture GM actions during a session
  (reveal document, start battle, etc.). Used for timeline and recap.
- **Ping** -- An ephemeral, 3-second animation at a point on the canvas. Never
  persisted; broadcast to all connected clients.
- **Floating Window** -- A draggable/resizable panel on the tabletop that shows
  hydrated content from any wiki collection (notes, characters, races, rules,
  players).

## Documentation

| File                                       | Content                                  |
| ------------------------------------------ | ---------------------------------------- |
| [architecture.md](./architecture.md)       | Component tree, layer stack, permissions |
| [data-flow.md](./data-flow.md)             | State ownership, persistence, reconnect  |
| [real-time-sync.md](./real-time-sync.md)   | PartyKit setup, message types, conflicts |
| [adding-features.md](./adding-features.md) | How to extend the tabletop               |

## Phased Implementation

**Phase 1 (current):** Grid mode, tab management, floating windows, real-time
sync, ping, "Show on Tabletop" button, session events.

**Phase 2:** Map mode via Leaflet, location binding, fog of war layer.

**Phase 3:** Battle map mode, token layer, drawing tools, GM hidden layer.
