# Real-Time Sync

## PartyKit Setup

The tabletop uses a dedicated PartyKit party named `tabletop`, separate from the
main session chat/dice party in `party/index.ts`.

```
party/tabletop.ts     TabletopParty server class
party/index.ts        SessionRoom server class (chat, dice, spell cards)
partykit.json         { "name": "cartyx-party", "main": "party/index.ts" }
```

### Room ID Convention

Each campaign gets one tabletop room:

```
Room ID = "tabletop-{campaignId}"
```

The client connects via `useTabletopParty(campaignId, getToken, onMessage)` which
uses `partysocket/react`'s `usePartySocket` hook with:

- `host`: `VITE_PUBLIC_PARTYKIT_HOST` (defaults to `localhost:1999`)
- `party`: `"tabletop"`
- `room`: `"tabletop-{campaignId}"`
- `query`: `{ token: await getToken() }` for authentication

### Server Behaviour

The `TabletopParty` server is a simple relay:

```typescript
onMessage(message: string, sender: Party.Connection) {
  this.room.broadcast(message, [sender.id]);  // send to all EXCEPT sender
}
```

No validation, no storage, no message history. The server trusts the client
payload and rebroadcasts it. All business logic lives on the client and in the
TanStack Start server functions.

## Message Types

All messages conform to the `TabletopMessage` discriminated union defined in
`app/types/tabletop.ts`:

### Tab Messages

```typescript
{
  type: 'tab:create';
  screen: TabletopScreenData;
}
{
  type: 'tab:rename';
  screenId: string;
  name: string;
}
{
  type: 'tab:delete';
  screenId: string;
}
{
  type: 'tab:focus-all';
  screenId: string;
}
{
  type: 'tab:content-added';
  screenId: string;
}
```

### Window Messages

```typescript
{
  type: 'window:show';
  screenId: string;
  window: WindowData;
  displayName: string;
}
{
  type: 'window:close';
  screenId: string;
  windowId: string;
}
```

### Canvas Messages

```typescript
{
  type: 'ping';
  screenId: string;
  x: number;
  y: number;
  userId: string;
  userName: string;
  color: string;
}

{
  type: 'grid:style-change';
  screenId: string;
  gridStyle: GridStyle;
}
```

## Broadcast Pattern

The sender performs the action locally and on the server, then broadcasts
to inform other clients:

```
  Client A (sender)                Server (PartyKit)            Client B (receiver)
  +-----------------------+        +------------------+         +-------------------+
  | 1. Execute action     |        |                  |         |                   |
  |    (optimistic UI +   |------->| 2. Broadcast to  |-------->| 3. Handle message |
  |     server function)  |        |    all except A  |         |    (invalidate    |
  | 4. send(message)      |        |                  |         |     queries, etc) |
  +-----------------------+        +------------------+         +-------------------+
```

The sender does NOT receive its own message back (PartyKit's `broadcast` excludes
the sender connection ID).

## Conflict Resolution

**Last-write-wins** for all mutable state. Since screen mutations are GM-only and
there is typically one GM, conflicts are rare. If two GMs modify the same screen,
the last `save()` to MongoDB wins. React Query cache invalidation ensures all
clients converge to the latest server state.

For player state, each user owns their own document, so conflicts cannot occur.

## Notification Badge Lifecycle

Badges alert a user that content was added to a tab they are not viewing.

```
  1. GM opens window on Screen B
     |
     v
  2. Server function succeeds, GM sends:
     { type: 'tab:content-added', screenId: 'B' }
     |
     v
  3. Client receives message. If screenId !== activeScreenId:
     - Add screenId to badgeScreenIds set
     - TabletopTabBar renders a dot on that tab
     |
     v
  4. User clicks on Screen B tab
     - handleScreenChange removes screenId from badgeScreenIds
     - Badge disappears
```

Badges are entirely client-side. They are not persisted and reset on page reload.

## Ping Lifecycle

Pings are ephemeral visual signals.

```
  1. User triggers ping at (x, y) on the canvas
     |
     v
  2. Client sends: { type: 'ping', screenId, x, y, userId, userName, color }
     |
     v
  3. Other clients receive the message and add a PingData entry
     |
     v
  4. PingOverlay renders:
     - Expanding ring (Circle, radius grows over 3s)
     - Center dot (Circle, radius 5)
     - Username label (Text)
     - All elements fade from opacity 1 -> 0 over 3 seconds
     |
     v
  5. After PING_DURATION_MS (3000ms), onPingExpired fires
     - PingData entry removed from state
     - Animation stops
```

Pings are never persisted. They exist only in React state for 3 seconds.
