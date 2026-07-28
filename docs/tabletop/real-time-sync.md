# Real-Time Sync

## The Realtime Service

Realtime is a standalone Node + `ws` service in `realtime/`, self-hosted
alongside the web app. It exposes three **parties** (independent message
surfaces), named on the wire in `realtime/src/auth.ts`:

```
realtime/src/
  index.ts                Entrypoint (reads env, starts the server)
  server.ts               HTTP + WS server, routing, heartbeat
  rooms.ts                In-process Room/RoomManager + broadcast
  auth.ts                 JWT verification + room binding
  history.ts              Memory/Mongo message history stores
  parties/
    tabletop.ts           Tab + window relay (this doc)
    tabletopMap.ts        Map contents: tokens, drawings, text, AoE
    session.ts            Chat / dice / spell cards (stateful, with history)
```

Run it locally with `npm run realtime:dev`. Env: `PORT` (default `1999`),
`SESSION_SECRET` (**required** — the process exits without it), `MONGODB_URI`
(optional; absent means in-memory history).

> Historical note: this was previously a PartyKit app in a `party/` directory
> with a `partykit.json`. Both are gone — see the self-host migration. Two
> legacy names survive deliberately and are **not** stale: the client env var
> `VITE_PUBLIC_PARTYKIT_HOST`, and the `tabletop_map` party's underscore on the
> wire (its room ids use hyphens).

### Routing and Room IDs

`server.ts` routes on `/parties/<party>/<room>`. Each party binds its room id to
the token's `sessionId` claim, so a peer cannot join another campaign's room:

| Party          | Room ID                     |
| -------------- | --------------------------- |
| `main`         | `<sessionId>`               |
| `tabletop`     | `tabletop-<campaignId>`     |
| `tabletop_map` | `tabletop-map-<campaignId>` |

Rooms live in process, keyed `party/roomId`, and are destroyed when the last peer
leaves. The server also runs a 30s heartbeat and terminates dead sockets.

### Authentication

**The relay authenticates; it is not an open pipe.** Two token paths:

- **Socket upgrade** — requires `?token=<JWT>`, verified HS256 against
  `SESSION_SECRET`. `sub` becomes the peer's `userId`; the `role` claim (`gm` or
  `player`, defaulting to `player`) is what the GM-only gates below check. A bad
  token or a room-binding mismatch fails the upgrade with `401`. Minted by
  `createPartyToken` in `app/server/session.ts`.
- **Server broadcast** — `POST /parties/<party>/<room>` with
  `Authorization: Bearer <JWT>` carrying scope `tabletop-broadcast`. Only
  `tabletop_map` implements this, for `map:active-changed`.

`GET /healthz` is also served.

### Per-Party Behaviour

The three parties behave **differently** — do not assume "dumb relay":

| Party          | Validates? | Persists?      | Role checks?                                            |
| -------------- | ---------- | -------------- | ------------------------------------------------------- |
| `tabletop`     | type only  | no             | yes — GM-only types (below)                             |
| `tabletop_map` | JSON parse | no             | yes — GM-only types; POST-only for `map:active-changed` |
| `main`         | per-type   | yes (+ replay) | yes — gm-channel fan-out                                |

`tabletop` (this doc's party) parses each frame, drops GM-only types from
non-GM peers, and otherwise rebroadcasts verbatim to everyone but the sender:

```typescript
onMessage(raw, sender, room) {
  // ...parse, read `type`...
  if (sender.role !== 'gm' && GM_ONLY_MESSAGE_TYPES.has(type)) return;
  room.broadcast(raw, sender.id); // all EXCEPT sender
}
```

GM-only types: `tab:create`, `tab:rename`, `tab:delete`, `tab:focus-all`,
`window:show`, `window:close`, `grid:style-change`. Everything else (e.g.
`tab:content-added`) relays from any authenticated peer. Beyond that gate the
party stores nothing and has no history; durable state lives in MongoDB via the
TanStack Start server functions.

### Client

`useTabletopParty(campaignId, getToken, onMessage)` wraps `partysocket/react`'s
`usePartySocket`:

- `host`: `VITE_PUBLIC_PARTYKIT_HOST` (defaults to `localhost:1999`)
- `party`: `"tabletop"`
- `room`: `"tabletop-{campaignId}"`, or the `"__disabled__"` sentinel when there
  is no campaign (the socket starts closed and does not retry)
- `query`: `{ token: await getToken() }`

The sibling `tabletop_map` party has its own hook (`useTabletopMapParty`) and a
much larger message union covering tokens, drawings, text, and AoE.

## Message Types

All `tabletop` messages conform to the `TabletopMessage` discriminated union in
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
  type: 'grid:style-change';
  screenId: string;
  gridStyle: GridStyle;
}
```

## Broadcast Pattern

The sender performs the action locally and on the server, then broadcasts
to inform other clients:

```
  Client A (sender)                Realtime service             Client B (receiver)
  +-----------------------+        +------------------+         +-------------------+
  | 1. Execute action     |        |                  |         |                   |
  |    (optimistic UI +   |------->| 2. Broadcast to  |-------->| 3. Handle message |
  |     server function)  |        |    all except A  |         |    (invalidate    |
  | 4. send(message)      |        |                  |         |     queries, etc) |
  +-----------------------+        +------------------+         +-------------------+
```

The sender does NOT receive its own message back — `Room.broadcast` in
`realtime/src/rooms.ts` skips the sender's peer id.

Note `tab:focus-all` is the one message with **no** server function behind it: it
is pure relay, which is why the party's role gate is the only thing restricting
it to GMs.

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
