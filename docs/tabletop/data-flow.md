# Data Flow

## State Ownership

The tabletop has two categories of persisted state:

```
  Shared State (TabletopScreen)         Personal State (TabletopPlayerState)
  +---------------------------------+   +----------------------------------+
  | Owned by the campaign           |   | Owned by a single user           |
  | Visible to all members          |   | Private to that user             |
  | Modified by GM only             |   | Modified by that user only       |
  +---------------------------------+   +----------------------------------+
  | - name, tabOrder, mode          |   | - activeScreenId                 |
  | - gridStyle, gridSize, gridScale|   | - viewports[] (per-screen)       |
  | - gridVisible                   |   |   { screenId, zoom, panX, panY } |
  | - windows[] (open wiki refs)    |   | - windowOverrides[]              |
  |   { collection, documentId,     |   |   { windowId, x, y, w, h, state }|
  |     state, x, y, w, h, zIndex } |   +----------------------------------+
  +---------------------------------+

  Write-Once State (SessionEvent)
  +---------------------------------+
  | Tied to a campaign + session    |
  | Created by GM, read by anyone   |
  +---------------------------------+
  | - eventType (reveal_document,   |
  |   reveal_location, map_change,  |
  |   battle_start, token_placed)   |
  | - documentId, collection        |
  | - tabletopScreenId              |
  | - triggeredBy, displayName      |
  | - timestamp                     |
  +---------------------------------+
```

## Persistence Flow

```
  User Action
      |
      v
  Local State (React)        <-- optimistic update for instant feedback
      |
      +---> PartyKit send()  <-- broadcast to other clients
      |
      +---> Server Function  <-- TanStack Start RPC (Zod-validated)
                |
                v
            MongoDB write    <-- Mongoose model .save() / .updateOne()
                |
                v
          React Query         <-- invalidateQueries() refreshes cache
          cache invalidation
```

### Example: GM Creates a New Tab

1. `handleCreateScreen("Battle")` calls `mutations.createScreen.mutateAsync("Battle")`.
2. The server function `createTabletopScreen` validates with Zod, checks GM auth,
   runs a Mongoose transaction to allocate the next `tabOrder`, and inserts the doc.
3. On success, the client sets the new screen as active and calls
   `send({ type: 'tab:create', screen })` to notify other clients.
4. Other clients receive the message, call `mutations.invalidateList()` to refetch
   the screen list, and the new tab appears.

### Example: Player Switches Tabs

1. `handleScreenChange(screenId)` sets local state immediately.
2. Clears the badge for that screen (if any).
3. Calls `updateState.mutate({ activeScreenId: screenId })` to persist via
   `updatePlayerState`, which upserts the player state doc in MongoDB.
4. No broadcast is needed -- tab selection is personal state.

## Hydration

When a screen is fetched with `getTabletopScreen`, the server:

1. Loads the `TabletopScreen` document (including embedded `windows[]`).
2. Collects all `{ collection, documentId }` refs from the windows.
3. Calls `hydrateRefs()` which groups refs by collection and batch-fetches from
   the appropriate Mongoose model (Note, Character, Race, Rule, Player).
4. Returns a `hydrated` map keyed by `"collection:documentId"` with title,
   content, and metadata.

The client uses this map to render floating window content without additional
round-trips.

## Reconnection

On page load (or reconnect), the full state is loaded from MongoDB:

1. `useTabletopScreenList` fetches all screens for the campaign.
2. `useTabletopPlayerState` fetches the user's personal state (active tab,
   viewports, window overrides).
3. The active screen is set from `playerState.activeScreenId` or falls back to
   the first screen.
4. `useTabletopScreenDetail` fetches the active screen's windows + hydrated docs.
5. `useTabletopParty` reconnects the WebSocket (partysocket handles automatic
   reconnection with exponential backoff).

There is no message replay from PartyKit. Any events that occurred while
disconnected are picked up by the MongoDB queries on reconnect.

## Query Keys

All tabletop queries use the `queryKeys.tabletop` namespace:

```typescript
queryKeys.tabletop.list(campaignId); // screen list
queryKeys.tabletop.detail(campaignId, screenId); // single screen + windows
queryKeys.tabletop.playerState(campaignId); // personal state
```

Mutations call `invalidateQueries` on the relevant key after success to keep
the cache fresh.
