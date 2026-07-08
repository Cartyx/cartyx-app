# Realtime Service (PartyKit Replacement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hostable Node 22 WebSocket service in `realtime/` that replaces PartyKit for all three parties (`main`, `tabletop`, `tabletop_map`) with zero client changes.

**Architecture:** Plain `node:http` + `ws` (noServer mode). JWT (HS256, `jose`) verified during the HTTP upgrade — the port of each party's `onBeforeConnect`. Rooms are in-memory (single replica, same model as a Durable Object); the `main` party's 50-message history persists to MongoDB through a `HistoryStore` interface with a Mongo and an in-memory implementation. The client (`partysocket`) already generates `/parties/:party/:room?token=…` URLs against `VITE_PUBLIC_PARTYKIT_HOST`, and `app/server/functions/maps.ts` already POSTs to the same convention — so the service listens on port 1999 (PartyKit's dev port) and nothing in `app/` changes.

**Tech Stack:** Node 22, TypeScript (strict, NodeNext), `ws`, `jose`, `mongodb` driver, vitest, mongodb-memory-server (tests only), Docker (`node:22-alpine`).

## Global Constraints

- Node `>=22.22.0` (matches root `package.json` engines)
- Branch off `dev`; the PR targets `dev`, never `main`
- Only install npm packages whose published version is ≥1 week old (run `node scripts/check-package-age.mjs` equivalent or check `npm view <pkg> time` manually)
- Never run tests against the dev Atlas database — history tests use `mongodb-memory-server`
- The wire protocol is fixed by the existing client: URL path `/parties/{main|tabletop|tabletop_map}/:room`, auth via `?token=` query param, ignore the `_pk` param partysocket appends
- Party names are exactly `main`, `tabletop`, `tabletop_map` (underscore — see `partykit.json`)
- Behavior must match `party/index.ts`, `party/tabletop.ts`, `party/tabletop-map.ts` — those files are the spec; read them before implementing Tasks 4–6
- `realtime/` is a self-contained package: own `package.json`, own lockfile, no imports from `app/`

## File Structure

```
realtime/
  package.json          — deps: ws, jose, mongodb; scripts: dev/build/start/test/typecheck
  tsconfig.json         — strict, NodeNext, outDir dist, excludes *.test.ts
  Dockerfile            — multi-stage node:22-alpine, non-root
  src/
    auth.ts             — JWT verification + per-party room binding (Task 1)
    history.ts          — HistoryStore interface, Mongo + Memory impls (Task 2)
    rooms.ts            — Peer, Room, RoomManager (Task 3)
    server.ts           — HTTP server, upgrade routing, healthz, heartbeat (Tasks 3, 7)
    index.ts            — entrypoint: env, store selection, shutdown (Task 7)
    parties/
      types.ts          — PartyHandler contract (Task 3)
      tabletop.ts       — pure relay (Task 4)
      tabletopMap.ts    — gated relay + POST broadcast (Task 5)
      session.ts        — chat/dice room with history (Task 6)
    *.test.ts / parties/*.test.ts — vitest suites alongside sources
  test/
    util.ts             — makeToken/listen/connect/nextMessage helpers (Task 3)
```

---

### Task 1: Package scaffold + auth module

**Files:**

- Create: `realtime/package.json`, `realtime/tsconfig.json`, `realtime/src/auth.ts`, `realtime/src/auth.test.ts`

**Interfaces:**

- Produces: `type ConnectionAuth = { userId: string; role: string }`, `type PartyName = 'main' | 'tabletop' | 'tabletop_map'`, `verifyConnectionToken(party: PartyName, roomId: string, token: string | null, sessionSecret: string | undefined): Promise<ConnectionAuth | null>`, `verifyBroadcastToken(authorizationHeader: string | undefined, sessionSecret: string | undefined): Promise<boolean>`

- [ ] **Step 1: Create branch and scaffold**

```bash
git checkout dev && git pull && git checkout -b realtime-service
mkdir -p realtime/src/parties realtime/test
```

`realtime/package.json`:

```json
{
  "name": "cartyx-realtime",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.22.0" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "jose": "^6.2.2",
    "mongodb": "^6.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "@types/ws": "^8.5.10",
    "mongodb-memory-server": "^10.0.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  }
}
```

`realtime/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Run: `cd realtime && npm install` — then verify every freshly-resolved version is ≥1 week old: `npm view mongodb time --json | tail -5` (repeat for any package whose version you didn't copy from the root package.json). Pin down (`~`) anything younger than 7 days.

- [ ] **Step 2: Write the failing tests**

`realtime/src/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { verifyBroadcastToken, verifyConnectionToken } from './auth.js';

const SECRET = 'test-secret-at-least-32-characters-long!!';

function sign(claims: Record<string, unknown>, secret = SECRET) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

describe('verifyConnectionToken', () => {
  it('accepts a valid main-party token bound to the room', async () => {
    const token = await sign({ sub: 'user-1', sessionId: 'room-1', role: 'gm' });
    expect(await verifyConnectionToken('main', 'room-1', token, SECRET)).toEqual({
      userId: 'user-1',
      role: 'gm',
    });
  });

  it('defaults role to player when the claim is missing', async () => {
    const token = await sign({ sub: 'user-1', sessionId: 'room-1' });
    expect(await verifyConnectionToken('main', 'room-1', token, SECRET)).toEqual({
      userId: 'user-1',
      role: 'player',
    });
  });

  it('rejects missing token, empty secret, wrong secret, and missing sub', async () => {
    const token = await sign({ sub: 'user-1', sessionId: 'room-1' });
    expect(await verifyConnectionToken('main', 'room-1', null, SECRET)).toBeNull();
    expect(await verifyConnectionToken('main', 'room-1', token, '')).toBeNull();
    expect(await verifyConnectionToken('main', 'room-1', token, undefined)).toBeNull();
    const wrong = await sign(
      { sub: 'user-1', sessionId: 'room-1' },
      'another-secret-32-characters-long!!!!'
    );
    expect(await verifyConnectionToken('main', 'room-1', wrong, SECRET)).toBeNull();
    const noSub = await sign({ sessionId: 'room-1' });
    expect(await verifyConnectionToken('main', 'room-1', noSub, SECRET)).toBeNull();
  });

  it('main party: rejects a sessionId claim that mismatches the room, allows an absent claim', async () => {
    const mismatched = await sign({ sub: 'u', sessionId: 'other-room' });
    expect(await verifyConnectionToken('main', 'room-1', mismatched, SECRET)).toBeNull();
    const noClaim = await sign({ sub: 'u' });
    expect(await verifyConnectionToken('main', 'room-1', noClaim, SECRET)).not.toBeNull();
  });

  it('tabletop party: requires room to be exactly tabletop-<campaignId>', async () => {
    const token = await sign({ sub: 'u', sessionId: 'camp-1' });
    expect(
      await verifyConnectionToken('tabletop', 'tabletop-camp-1', token, SECRET)
    ).not.toBeNull();
    expect(await verifyConnectionToken('tabletop', 'tabletop-camp-2', token, SECRET)).toBeNull();
    const empty = await sign({ sub: 'u' });
    expect(await verifyConnectionToken('tabletop', 'tabletop-', empty, SECRET)).toBeNull();
  });

  it('tabletop_map party: requires room to be exactly tabletop-map-<campaignId>', async () => {
    const token = await sign({ sub: 'u', sessionId: 'camp-1' });
    expect(
      await verifyConnectionToken('tabletop_map', 'tabletop-map-camp-1', token, SECRET)
    ).not.toBeNull();
    expect(
      await verifyConnectionToken('tabletop_map', 'tabletop-camp-1', token, SECRET)
    ).toBeNull();
  });
});

describe('verifyBroadcastToken', () => {
  it('accepts only a bearer token with scope tabletop-broadcast', async () => {
    const good = await sign({ scope: 'tabletop-broadcast' });
    const bad = await sign({ scope: 'other' });
    expect(await verifyBroadcastToken(`Bearer ${good}`, SECRET)).toBe(true);
    expect(await verifyBroadcastToken(`Bearer ${bad}`, SECRET)).toBe(false);
    expect(await verifyBroadcastToken(undefined, SECRET)).toBe(false);
    expect(await verifyBroadcastToken(`Bearer ${good}`, '')).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd realtime && npx vitest run src/auth.test.ts`
Expected: FAIL — cannot resolve `./auth.js`

- [ ] **Step 4: Implement `realtime/src/auth.ts`**

```ts
import { jwtVerify } from 'jose';

export type ConnectionAuth = { userId: string; role: string };
export type PartyName = 'main' | 'tabletop' | 'tabletop_map';

// Room-binding rules ported verbatim from party/index.ts, party/tabletop.ts,
// and party/tabletop-map.ts onBeforeConnect.
const ROOM_BINDING: Record<PartyName, (claim: string, roomId: string) => boolean> = {
  main: (claim, roomId) => claim === '' || roomId === '' || claim === roomId,
  tabletop: (claim, roomId) => claim !== '' && roomId === `tabletop-${claim}`,
  tabletop_map: (claim, roomId) => claim !== '' && roomId === `tabletop-map-${claim}`,
};

export async function verifyConnectionToken(
  party: PartyName,
  roomId: string,
  token: string | null,
  sessionSecret: string | undefined
): Promise<ConnectionAuth | null> {
  if (!token) return null;
  if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(sessionSecret), {
      algorithms: ['HS256'],
    });
    const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!userId) return null;
    const claim = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!ROOM_BINDING[party](claim, roomId)) return null;
    const role = typeof payload.role === 'string' ? payload.role : 'player';
    return { userId, role };
  } catch {
    return null;
  }
}

export async function verifyBroadcastToken(
  authorizationHeader: string | undefined,
  sessionSecret: string | undefined
): Promise<boolean> {
  if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') return false;
  const auth = authorizationHeader ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer) return false;
  try {
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(sessionSecret), {
      algorithms: ['HS256'],
    });
    return payload.scope === 'tabletop-broadcast';
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd realtime && npx vitest run src/auth.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add realtime/
git commit -m "feat(realtime): scaffold package and port party JWT auth"
```

---

### Task 2: History store

**Files:**

- Create: `realtime/src/history.ts`, `realtime/src/history.test.ts`

**Interfaces:**

- Produces: `type StoredMessage = { roomId: string; seq: number; msg: unknown }`, `interface HistoryStore { load(roomId: string): Promise<StoredMessage[]>; append(entry: StoredMessage): Promise<void>; deleteUpTo(roomId: string, maxSeqInclusive: number): Promise<void> }`, `class MemoryHistoryStore implements HistoryStore`, `class MongoHistoryStore implements HistoryStore` (constructor takes a `Db`; has `ensureIndexes(): Promise<void>`)

- [ ] **Step 1: Write the failing tests**

`realtime/src/history.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MemoryHistoryStore, MongoHistoryStore, type HistoryStore } from './history.js';

function behavesLikeHistoryStore(name: string, getStore: () => HistoryStore) {
  describe(name, () => {
    it('loads appended messages in seq order, isolated per room', async () => {
      const store = getStore();
      await store.append({ roomId: 'a', seq: 2, msg: { id: 'm2' } });
      await store.append({ roomId: 'a', seq: 1, msg: { id: 'm1' } });
      await store.append({ roomId: 'b', seq: 1, msg: { id: 'other' } });
      const loaded = await store.load('a');
      expect(loaded.map((e) => e.seq)).toEqual([1, 2]);
      expect(loaded.map((e) => (e.msg as { id: string }).id)).toEqual(['m1', 'm2']);
    });

    it('deleteUpTo removes only messages with seq <= bound', async () => {
      const store = getStore();
      for (let seq = 1; seq <= 5; seq++) {
        await store.append({ roomId: 'trim', seq, msg: { id: `m${seq}` } });
      }
      await store.deleteUpTo('trim', 3);
      expect((await store.load('trim')).map((e) => e.seq)).toEqual([4, 5]);
    });

    it('load of an unknown room returns []', async () => {
      expect(await getStore().load('nope')).toEqual([]);
    });
  });
}

behavesLikeHistoryStore('MemoryHistoryStore', () => new MemoryHistoryStore());

describe('MongoHistoryStore', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let store: MongoHistoryStore;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    store = new MongoHistoryStore(client.db('test'));
    await store.ensureIndexes();
  });
  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  behavesLikeHistoryStore('shared behavior', () => store);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd realtime && npx vitest run src/history.test.ts`
Expected: FAIL — cannot resolve `./history.js`

- [ ] **Step 3: Implement `realtime/src/history.ts`**

```ts
import type { Collection, Db } from 'mongodb';

export type StoredMessage = { roomId: string; seq: number; msg: unknown };

export interface HistoryStore {
  /** All messages for a room, ordered by seq ascending. */
  load(roomId: string): Promise<StoredMessage[]>;
  append(entry: StoredMessage): Promise<void>;
  /** Delete every message in the room with seq <= maxSeqInclusive. */
  deleteUpTo(roomId: string, maxSeqInclusive: number): Promise<void>;
}

export class MemoryHistoryStore implements HistoryStore {
  private rooms = new Map<string, StoredMessage[]>();

  async load(roomId: string): Promise<StoredMessage[]> {
    return [...(this.rooms.get(roomId) ?? [])].sort((a, b) => a.seq - b.seq);
  }
  async append(entry: StoredMessage): Promise<void> {
    const list = this.rooms.get(entry.roomId) ?? [];
    list.push(entry);
    this.rooms.set(entry.roomId, list);
  }
  async deleteUpTo(roomId: string, maxSeqInclusive: number): Promise<void> {
    const kept = (this.rooms.get(roomId) ?? []).filter((m) => m.seq > maxSeqInclusive);
    this.rooms.set(roomId, kept);
  }
}

export class MongoHistoryStore implements HistoryStore {
  private col: Collection<StoredMessage>;

  constructor(db: Db) {
    this.col = db.collection<StoredMessage>('realtime_room_messages');
  }
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ roomId: 1, seq: 1 }, { unique: true });
  }
  async load(roomId: string): Promise<StoredMessage[]> {
    return this.col
      .find({ roomId }, { projection: { _id: 0 } })
      .sort({ seq: 1 })
      .toArray();
  }
  async append(entry: StoredMessage): Promise<void> {
    await this.col.insertOne({ ...entry });
  }
  async deleteUpTo(roomId: string, maxSeqInclusive: number): Promise<void> {
    await this.col.deleteMany({ roomId, seq: { $lte: maxSeqInclusive } });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd realtime && npx vitest run src/history.test.ts`
Expected: PASS (6 tests; first run downloads a MongoDB binary — allow a minute)

- [ ] **Step 5: Commit**

```bash
git add realtime/src/history.ts realtime/src/history.test.ts
git commit -m "feat(realtime): history store with Mongo and in-memory implementations"
```

---

### Task 3: Rooms + server core (upgrade auth, routing, healthz)

**Files:**

- Create: `realtime/src/rooms.ts`, `realtime/src/parties/types.ts`, `realtime/src/server.ts`, `realtime/test/util.ts`, `realtime/src/server.test.ts`

**Interfaces:**

- Consumes: `verifyConnectionToken`, `PartyName`, `ConnectionAuth` (Task 1)
- Produces:
  - `type Peer = ConnectionAuth & { id: string; ws: WebSocket }`
  - `class Room { readonly party: PartyName; readonly id: string; readonly peers: Set<Peer>; state: unknown; addPeer(ws, auth): Peer; removePeer(peer): void; broadcast(data: string, excludePeerId?: string): void }`
  - `class RoomManager { get(party: PartyName, roomId: string): Room; releaseIfEmpty(room: Room): void }`
  - `type PartyHandler = { onConnect?(peer: Peer, room: Room): void | Promise<void>; onMessage(raw: string, sender: Peer, room: Room): void | Promise<void>; onRequest?(room: Room, headers: IncomingHttpHeaders, body: string): Promise<[number, string]> }`
  - `createRealtimeServer(opts: { sessionSecret: string; handlers: Record<PartyName, PartyHandler> }): http.Server`
  - Test helpers: `TEST_SECRET`, `makeToken(claims)`, `listen(server): Promise<number>`, `connect(port, party, room, token): Promise<WebSocket>`, `nextMessage(ws): Promise<string>`

- [ ] **Step 1: Write the test helpers**

`realtime/test/util.ts`:

```ts
import { SignJWT } from 'jose';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export const TEST_SECRET = 'test-secret-at-least-32-characters-long!!';

export function makeToken(claims: Record<string, unknown>, secret = TEST_SECRET): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

export function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

export function connect(
  port: number,
  party: string,
  room: string,
  token: string
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/parties/${party}/${room}?token=${encodeURIComponent(token)}&_pk=test`
    );
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.once('message', (d) => resolve(d.toString())));
}
```

- [ ] **Step 2: Write the failing tests**

`realtime/src/server.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { WebSocket as RawWebSocket } from 'ws';
import { createRealtimeServer } from './server.js';
import type { PartyHandler } from './parties/types.js';
import { TEST_SECRET, connect, listen, makeToken, nextMessage } from '../test/util.js';

const echoHandler: PartyHandler = {
  onConnect(peer) {
    peer.ws.send(JSON.stringify({ type: 'WELCOME', userId: peer.userId, role: peer.role }));
  },
  onMessage(raw, _sender, room) {
    room.broadcast(raw);
  },
};

function makeServer(): Server {
  return createRealtimeServer({
    sessionSecret: TEST_SECRET,
    handlers: { main: echoHandler, tabletop: echoHandler, tabletop_map: echoHandler },
  });
}

describe('realtime server core', () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('serves /healthz', async () => {
    server = makeServer();
    const port = await listen(server);
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
  });

  it('accepts an authenticated upgrade and exposes identity to the handler', async () => {
    server = makeServer();
    const port = await listen(server);
    const token = await makeToken({ sub: 'user-9', sessionId: 'room-1', role: 'gm' });
    const ws = await connect(port, 'main', 'room-1', token);
    expect(JSON.parse(await nextMessage(ws))).toEqual({
      type: 'WELCOME',
      userId: 'user-9',
      role: 'gm',
    });
    ws.close();
  });

  it('rejects a missing/invalid token with 401 and unknown paths with 404', async () => {
    server = makeServer();
    const port = await listen(server);
    await expect(connect(port, 'main', 'room-1', 'garbage')).rejects.toThrow(/401/);
    await expect(
      new Promise((_, reject) => {
        const bad = new RawWebSocket(`ws://127.0.0.1:${port}/other/path`);
        bad.once('error', reject);
      })
    ).rejects.toThrow(/404/);
  });

  it('routes messages within a room and not across rooms', async () => {
    server = makeServer();
    const port = await listen(server);
    const t1 = await makeToken({ sub: 'a', sessionId: 'room-1' });
    const t2 = await makeToken({ sub: 'b', sessionId: 'room-1' });
    const t3 = await makeToken({ sub: 'c', sessionId: 'room-2' });
    const [ws1, ws2, ws3] = await Promise.all([
      connect(port, 'main', 'room-1', t1),
      connect(port, 'main', 'room-1', t2),
      connect(port, 'main', 'room-2', t3),
    ]);
    await Promise.all([nextMessage(ws1), nextMessage(ws2), nextMessage(ws3)]); // drain WELCOMEs
    let ws3got = false;
    ws3.once('message', () => (ws3got = true));
    ws1.send('hello');
    expect(await nextMessage(ws2)).toBe('hello');
    await new Promise((r) => setTimeout(r, 50));
    expect(ws3got).toBe(false);
    for (const ws of [ws1, ws2, ws3]) ws.close();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd realtime && npx vitest run src/server.test.ts`
Expected: FAIL — cannot resolve `./server.js`

- [ ] **Step 4: Implement rooms, handler contract, and server**

`realtime/src/rooms.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ConnectionAuth, PartyName } from './auth.js';

export type Peer = ConnectionAuth & { id: string; ws: WebSocket };

export class Room {
  readonly peers = new Set<Peer>();
  /** Per-party mutable state (e.g. session history); each handler owns the shape. */
  state: unknown;

  constructor(
    readonly party: PartyName,
    readonly id: string
  ) {}

  addPeer(ws: WebSocket, auth: ConnectionAuth): Peer {
    const peer: Peer = { id: randomUUID(), ws, ...auth };
    this.peers.add(peer);
    return peer;
  }
  removePeer(peer: Peer): void {
    this.peers.delete(peer);
  }
  broadcast(data: string, excludePeerId?: string): void {
    for (const p of this.peers) {
      if (p.id === excludePeerId) continue;
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
    }
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  get(party: PartyName, roomId: string): Room {
    const key = `${party}/${roomId}`;
    let room = this.rooms.get(key);
    if (!room) {
      room = new Room(party, roomId);
      this.rooms.set(key, room);
    }
    return room;
  }
  releaseIfEmpty(room: Room): void {
    if (room.peers.size === 0) this.rooms.delete(`${room.party}/${room.id}`);
  }
}
```

`realtime/src/parties/types.ts`:

```ts
import type { IncomingHttpHeaders } from 'node:http';
import type { Peer, Room } from '../rooms.js';

export type PartyHandler = {
  onConnect?: (peer: Peer, room: Room) => void | Promise<void>;
  onMessage: (raw: string, sender: Peer, room: Room) => void | Promise<void>;
  /** Optional POST /parties/<party>/<room> handler → [status, body]. */
  onRequest?: (room: Room, headers: IncomingHttpHeaders, body: string) => Promise<[number, string]>;
};
```

`realtime/src/server.ts`:

```ts
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { verifyConnectionToken, type PartyName } from './auth.js';
import { RoomManager } from './rooms.js';
import type { PartyHandler } from './parties/types.js';

export type RealtimeServerOptions = {
  sessionSecret: string;
  handlers: Record<PartyName, PartyHandler>;
};

const PARTY_PATH = /^\/parties\/(main|tabletop|tabletop_map)\/([^/?]+)$/;

function parsePartyUrl(url: string | undefined): { party: PartyName; roomId: string } | null {
  if (!url) return null;
  const { pathname } = new URL(url, 'http://internal');
  const match = PARTY_PATH.exec(pathname);
  if (!match) return null;
  return { party: match[1] as PartyName, roomId: decodeURIComponent(match[2]) };
}

export function createRealtimeServer(opts: RealtimeServerOptions): Server {
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ noServer: true });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    const target = parsePartyUrl(req.url);
    if (target) {
      const handler = opts.handlers[target.party];
      if (!handler.onRequest) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const [status, body] = await handler.onRequest(
        rooms.get(target.party, target.roomId),
        req.headers,
        Buffer.concat(chunks).toString('utf8')
      );
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const target = parsePartyUrl(req.url);
    if (!target) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const token = new URL(req.url ?? '/', 'http://internal').searchParams.get('token');
    const auth = await verifyConnectionToken(
      target.party,
      target.roomId,
      token,
      opts.sessionSecret
    );
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = rooms.get(target.party, target.roomId);
      const peer = room.addPeer(ws, auth);
      const handler = opts.handlers[target.party];
      void handler.onConnect?.(peer, room);
      ws.on('message', (data) => {
        void handler.onMessage(data.toString(), peer, room);
      });
      ws.on('close', () => {
        room.removePeer(peer);
        rooms.releaseIfEmpty(room);
      });
    });
  });

  server.on('close', () => {
    for (const ws of wss.clients) ws.terminate();
  });

  return server;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd realtime && npx vitest run src/server.test.ts src/auth.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add realtime/src/rooms.ts realtime/src/parties/types.ts realtime/src/server.ts realtime/src/server.test.ts realtime/test/util.ts
git commit -m "feat(realtime): ws server core with JWT-gated upgrades and room routing"
```

---

### Task 4: Tabletop relay handler

**Files:**

- Create: `realtime/src/parties/tabletop.ts`, `realtime/src/parties/tabletop.test.ts`

**Interfaces:**

- Consumes: `PartyHandler`, `Room`, `Peer` (Task 3)
- Produces: `tabletopHandler: PartyHandler`

Spec: `party/tabletop.ts` — relay every message verbatim to all **other** connections in the room.

- [ ] **Step 1: Write the failing test**

`realtime/src/parties/tabletop.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createRealtimeServer } from '../server.js';
import { tabletopHandler } from './tabletop.js';
import { TEST_SECRET, connect, listen, makeToken, nextMessage } from '../../test/util.js';

describe('tabletop relay', () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('relays to other peers but never echoes to the sender', async () => {
    server = createRealtimeServer({
      sessionSecret: TEST_SECRET,
      handlers: { main: tabletopHandler, tabletop: tabletopHandler, tabletop_map: tabletopHandler },
    });
    const port = await listen(server);
    const token = (sub: string) => makeToken({ sub, sessionId: 'camp-1' });
    const ws1 = await connect(port, 'tabletop', 'tabletop-camp-1', await token('a'));
    const ws2 = await connect(port, 'tabletop', 'tabletop-camp-1', await token('b'));
    let echoed = false;
    ws1.once('message', () => (echoed = true));
    ws1.send('{"type":"cursor:moved","x":1}');
    expect(await nextMessage(ws2)).toBe('{"type":"cursor:moved","x":1}');
    await new Promise((r) => setTimeout(r, 50));
    expect(echoed).toBe(false);
    ws1.close();
    ws2.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd realtime && npx vitest run src/parties/tabletop.test.ts`
Expected: FAIL — cannot resolve `./tabletop.js`

- [ ] **Step 3: Implement `realtime/src/parties/tabletop.ts`**

```ts
import type { PartyHandler } from './types.js';

/** Pure relay — port of party/tabletop.ts onMessage. */
export const tabletopHandler: PartyHandler = {
  onMessage(raw, sender, room) {
    room.broadcast(raw, sender.id);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd realtime && npx vitest run src/parties/tabletop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add realtime/src/parties/tabletop.ts realtime/src/parties/tabletop.test.ts
git commit -m "feat(realtime): tabletop relay party"
```

---

### Task 5: Tabletop-map handler (GM gating + POST broadcast)

**Files:**

- Create: `realtime/src/parties/tabletopMap.ts`, `realtime/src/parties/tabletopMap.test.ts`

**Interfaces:**

- Consumes: `PartyHandler` (Task 3), `verifyBroadcastToken` (Task 1)
- Produces: `createTabletopMapHandler(deps: { verifyBroadcastToken(authHeader: string | undefined): Promise<boolean> }): PartyHandler`

Spec: `party/tabletop-map.ts` — drop malformed frames; never relay `map:active-changed` from sockets; drop GM-only types from non-GM senders; re-serialize before broadcast; POST endpoint requires `Bearer` token with scope `tabletop-broadcast` and body `{ type: 'map:active-changed', mapId: string|null, screenId?: string|null }`.

- [ ] **Step 1: Write the failing tests**

`realtime/src/parties/tabletopMap.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createRealtimeServer } from '../server.js';
import { createTabletopMapHandler } from './tabletopMap.js';
import { verifyBroadcastToken } from '../auth.js';
import { TEST_SECRET, connect, listen, makeToken, nextMessage } from '../../test/util.js';

describe('tabletop_map party', () => {
  let server: Server;
  let port: number;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  async function setup() {
    const handler = createTabletopMapHandler({
      verifyBroadcastToken: (h) => verifyBroadcastToken(h, TEST_SECRET),
    });
    server = createRealtimeServer({
      sessionSecret: TEST_SECRET,
      handlers: { main: handler, tabletop: handler, tabletop_map: handler },
    });
    port = await listen(server);
    const gm = await connect(
      port,
      'tabletop_map',
      'tabletop-map-camp-1',
      await makeToken({ sub: 'gm-1', sessionId: 'camp-1', role: 'gm' })
    );
    const player = await connect(
      port,
      'tabletop_map',
      'tabletop-map-camp-1',
      await makeToken({ sub: 'p-1', sessionId: 'camp-1', role: 'player' })
    );
    return { gm, player };
  }

  it('relays GM drawing events but drops the same event from a player', async () => {
    const { gm, player } = await setup();
    gm.send(JSON.stringify({ type: 'drawing:added', id: 'd1' }));
    expect(JSON.parse(await nextMessage(player))).toEqual({ type: 'drawing:added', id: 'd1' });

    let gmGot: string | null = null;
    gm.once('message', (d) => (gmGot = d.toString()));
    player.send(JSON.stringify({ type: 'drawing:added', id: 'evil' }));
    player.send(JSON.stringify({ type: 'token:moved', id: 't1' })); // allowed for players
    expect(JSON.parse(await nextMessage(gm))).toEqual({ type: 'token:moved', id: 't1' });
    expect(gmGot === null || !gmGot.includes('evil')).toBe(true);
    gm.close();
    player.close();
  });

  it('never relays map:active-changed from a socket, even a GM', async () => {
    const { gm, player } = await setup();
    let got = false;
    player.once('message', () => (got = true));
    gm.send(JSON.stringify({ type: 'map:active-changed', mapId: 'x' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toBe(false);
    gm.close();
    player.close();
  });

  it('POST broadcast requires the scoped bearer token and broadcasts to all', async () => {
    const { gm, player } = await setup();
    const url = `http://127.0.0.1:${port}/parties/tabletop_map/tabletop-map-camp-1`;
    const body = JSON.stringify({ type: 'map:active-changed', mapId: 'map-7', screenId: null });

    const unauth = await fetch(url, { method: 'POST', body });
    expect(unauth.status).toBe(401);

    const badScope = await makeToken({ scope: 'other' });
    expect(
      (await fetch(url, { method: 'POST', body, headers: { authorization: `Bearer ${badScope}` } }))
        .status
    ).toBe(401);

    const good = await makeToken({ scope: 'tabletop-broadcast' });
    const [gmMsg, playerMsg, res] = await Promise.all([
      nextMessage(gm),
      nextMessage(player),
      fetch(url, { method: 'POST', body, headers: { authorization: `Bearer ${good}` } }),
    ]);
    expect(res.status).toBe(200);
    expect(JSON.parse(gmMsg)).toEqual({
      type: 'map:active-changed',
      mapId: 'map-7',
      screenId: null,
    });
    expect(JSON.parse(playerMsg)).toEqual({
      type: 'map:active-changed',
      mapId: 'map-7',
      screenId: null,
    });

    const badBody = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ type: 'map:active-changed', mapId: 42 }),
      headers: { authorization: `Bearer ${good}` },
    });
    expect(badBody.status).toBe(400);
    gm.close();
    player.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd realtime && npx vitest run src/parties/tabletopMap.test.ts`
Expected: FAIL — cannot resolve `./tabletopMap.js`

- [ ] **Step 3: Implement `realtime/src/parties/tabletopMap.ts`**

```ts
import type { PartyHandler } from './types.js';

/** GM-only message types — ported verbatim from party/tabletop-map.ts. */
const GM_ONLY_MESSAGE_TYPES = new Set([
  'drawing:added',
  'drawing:updated',
  'drawing:moved',
  'drawing:removed',
  'drawing:cleared',
  'token:added',
  'token:updated',
  'token:removed',
]);

export function createTabletopMapHandler(deps: {
  verifyBroadcastToken: (authHeader: string | undefined) => Promise<boolean>;
}): PartyHandler {
  return {
    onMessage(raw, sender, room) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const type = (parsed as { type?: unknown }).type;
      if (typeof type !== 'string') return;
      // Only the authenticated server (onRequest) may originate this.
      if (type === 'map:active-changed') return;
      if (sender.role !== 'gm' && GM_ONLY_MESSAGE_TYPES.has(type)) return;
      room.broadcast(JSON.stringify(parsed), sender.id);
    },

    async onRequest(room, headers, body) {
      const authHeader = Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : headers.authorization;
      if (!(await deps.verifyBroadcastToken(authHeader))) return [401, 'Unauthorized'];

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return [400, 'Bad JSON'];
      }
      if (!parsed || typeof parsed !== 'object') return [400, 'Bad payload'];
      const { type, mapId, screenId } = parsed as {
        type?: unknown;
        mapId?: unknown;
        screenId?: unknown;
      };
      if (type !== 'map:active-changed' || !(typeof mapId === 'string' || mapId === null)) {
        return [400, 'Bad payload'];
      }
      if (!(typeof screenId === 'string' || screenId === null || screenId === undefined)) {
        return [400, 'Bad payload'];
      }
      room.broadcast(JSON.stringify({ type, mapId, screenId: screenId ?? null }));
      return [200, 'ok'];
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd realtime && npx vitest run src/parties/tabletopMap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add realtime/src/parties/tabletopMap.ts realtime/src/parties/tabletopMap.test.ts
git commit -m "feat(realtime): tabletop_map party with GM gating and POST broadcast"
```

---

### Task 6: Session (`main`) handler — chat/dice with history

**Files:**

- Create: `realtime/src/parties/session.ts`, `realtime/src/parties/session.test.ts`

**Interfaces:**

- Consumes: `PartyHandler`, `Room` (Task 3), `HistoryStore`, `MemoryHistoryStore` (Task 2)
- Produces: `createSessionHandler(store: HistoryStore): PartyHandler`

Spec: `party/index.ts` — on connect send `{type:'HISTORY', messages}` (GM-channel messages filtered for non-GMs); validate `CHAT`/`DICE`/`SPELL_CARD` shapes; reject `sessionId !== room.id`; override `authorId` with the authenticated user; only GMs send on the `gm` channel and only GMs receive it; monotonic `seq`; keep last 50 messages, persisted.

- [ ] **Step 1: Write the failing tests**

`realtime/src/parties/session.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createRealtimeServer } from '../server.js';
import { createSessionHandler } from './session.js';
import { MemoryHistoryStore } from '../history.js';
import { TEST_SECRET, connect, listen, makeToken, nextMessage } from '../../test/util.js';

function chat(text: string, over: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'CHAT',
    id: crypto.randomUUID(),
    sessionId: 'room-1',
    campaignId: 'c1',
    channel: 'general',
    authorId: 'spoofed',
    authorName: 'A',
    text,
    timestamp: 1,
    ...over,
  });
}

describe('session party', () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  async function setup(store = new MemoryHistoryStore()) {
    const handler = createSessionHandler(store);
    server = createRealtimeServer({
      sessionSecret: TEST_SECRET,
      handlers: { main: handler, tabletop: handler, tabletop_map: handler },
    });
    const port = await listen(server);
    return { port, store };
  }

  async function join(port: number, sub: string, role: string) {
    const ws = await connect(
      port,
      'main',
      'room-1',
      await makeToken({ sub, sessionId: 'room-1', role })
    );
    const history = JSON.parse(await nextMessage(ws));
    return { ws, history };
  }

  it('sends HISTORY on connect and broadcasts chat to everyone including the sender', async () => {
    const { port } = await setup();
    const a = await join(port, 'user-a', 'player');
    expect(a.history).toEqual({ type: 'HISTORY', messages: [] });
    const b = await join(port, 'user-b', 'player');
    a.ws.send(chat('hello table'));
    const [gotA, gotB] = await Promise.all([nextMessage(a.ws), nextMessage(b.ws)]);
    const msg = JSON.parse(gotA);
    expect(msg.text).toBe('hello table');
    expect(msg.seq).toBe(1);
    expect(msg.authorId).toBe('user-a'); // spoofed authorId overridden
    expect(JSON.parse(gotB).text).toBe('hello table');
    a.ws.close();
    b.ws.close();
  });

  it('gm channel: players cannot send it and never receive it', async () => {
    const { port } = await setup();
    const gm = await join(port, 'gm-1', 'gm');
    const player = await join(port, 'p-1', 'player');
    let playerGot = false;
    player.ws.once('message', () => (playerGot = true));

    player.ws.send(chat('sneaky', { channel: 'gm' })); // rejected: player on gm channel
    gm.ws.send(chat('secret note', { channel: 'gm' }));
    expect(JSON.parse(await nextMessage(gm.ws)).text).toBe('secret note');
    await new Promise((r) => setTimeout(r, 50));
    expect(playerGot).toBe(false);
    gm.ws.close();
    player.ws.close();
  });

  it('drops invalid messages: wrong type, wrong sessionId, missing per-type fields', async () => {
    const { port } = await setup();
    const a = await join(port, 'user-a', 'player');
    let got = 0;
    a.ws.on('message', () => got++);
    a.ws.send('not json');
    a.ws.send(JSON.stringify({ type: 'NOPE', id: 'x' }));
    a.ws.send(chat('wrong room', { sessionId: 'room-2' }));
    a.ws.send(JSON.stringify({ type: 'CHAT', id: 'x', sessionId: 'room-1', channel: 'general' })); // no text
    a.ws.send(JSON.stringify({ type: 'DICE', id: 'x', sessionId: 'room-1', channel: 'general' })); // no attackRolls
    await new Promise((r) => setTimeout(r, 80));
    expect(got).toBe(0);
    a.ws.close();
  });

  it('persists history, trims to 50, filters gm messages from player HISTORY, survives room restart', async () => {
    const { port, store } = await setup();
    const gm = await join(port, 'gm-1', 'gm');
    for (let i = 1; i <= 55; i++) {
      gm.ws.send(chat(`msg ${i}`));
      await nextMessage(gm.ws); // wait for each broadcast → deterministic seq order
    }
    gm.ws.send(chat('gm only', { channel: 'gm' }));
    await nextMessage(gm.ws);
    gm.ws.close();
    // Room is now empty → released. A new join must reload from the store.
    await new Promise((r) => setTimeout(r, 50));
    const player = await join(port, 'p-1', 'player');
    const texts = player.history.messages.map((m: { text: string }) => m.text);
    // 56 messages total → memory + store keep the last 50 (seqs 7–56);
    // the player additionally loses the 1 gm-only message → 49 visible.
    expect(texts.length).toBe(49);
    expect(texts[0]).toBe('msg 7');
    expect(texts.at(-1)).toBe('msg 55');
    expect(texts).not.toContain('gm only');
    const persisted = await store.load('room-1');
    expect(persisted.length).toBe(50);
    player.ws.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd realtime && npx vitest run src/parties/session.test.ts`
Expected: FAIL — cannot resolve `./session.js`

- [ ] **Step 3: Implement `realtime/src/parties/session.ts`**

```ts
import type { HistoryStore } from '../history.js';
import type { Room } from '../rooms.js';
import type { PartyHandler } from './types.js';

const HISTORY_LIMIT = 50;
const VALID_TYPES = new Set(['CHAT', 'DICE', 'SPELL_CARD']);

type RoomMessage = {
  type: string;
  id: string;
  seq?: number;
  sessionId?: string;
  channel?: 'general' | 'gm';
  authorId?: string;
  text?: unknown;
  attackRolls?: unknown;
  title?: unknown;
  [key: string]: unknown;
};

type SessionState = { history: RoomMessage[]; seq: number; loading: Promise<void> | null };

function getState(room: Room): SessionState {
  if (!room.state) {
    room.state = { history: [], seq: 0, loading: null } satisfies SessionState;
  }
  return room.state as SessionState;
}

async function ensureLoaded(room: Room, store: HistoryStore): Promise<SessionState> {
  const state = getState(room);
  if (!state.loading) {
    state.loading = store.load(room.id).then((entries) => {
      state.history = entries.map((e) => e.msg as RoomMessage);
      state.seq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
    });
  }
  await state.loading;
  return state;
}

export function createSessionHandler(store: HistoryStore): PartyHandler {
  return {
    async onConnect(peer, room) {
      const state = await ensureLoaded(room, store);
      const visible =
        peer.role === 'gm' ? state.history : state.history.filter((m) => m.channel !== 'gm');
      peer.ws.send(JSON.stringify({ type: 'HISTORY', messages: visible }));
    },

    async onMessage(raw, sender, room) {
      const state = await ensureLoaded(room, store);

      let msg: RoomMessage;
      try {
        msg = JSON.parse(raw) as RoomMessage;
      } catch {
        return;
      }
      if (!msg.type || !msg.id) return;
      if (!VALID_TYPES.has(msg.type)) return;
      if ('sessionId' in msg && msg.sessionId !== room.id) return;
      if (msg.type === 'CHAT' && typeof msg.text !== 'string') return;
      if (msg.type === 'DICE' && !Array.isArray(msg.attackRolls)) return;
      if (msg.type === 'SPELL_CARD' && typeof msg.title !== 'string') return;
      if (msg.channel === 'gm' && sender.role !== 'gm') return;
      if ('authorId' in msg) msg.authorId = sender.userId;

      state.seq++;
      msg.seq = state.seq;
      state.history = [...state.history, msg];

      if (state.history.length > HISTORY_LIMIT) {
        state.history.splice(0, state.history.length - HISTORY_LIMIT);
        await store.deleteUpTo(room.id, state.seq - HISTORY_LIMIT);
      }
      await store.append({ roomId: room.id, seq: state.seq, msg });

      const payload = JSON.stringify(msg);
      if (msg.channel === 'gm') {
        for (const p of room.peers) {
          if (p.role === 'gm' && p.ws.readyState === p.ws.OPEN) p.ws.send(payload);
        }
      } else {
        room.broadcast(payload);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd realtime && npx vitest run src/parties/session.test.ts`
Expected: PASS. If the trim assertion is off-by-one, re-read the eviction math against `party/index.ts` (it evicts before appending the new message) — match its observable behavior, then fix the implementation, not the test.

- [ ] **Step 5: Commit**

```bash
git add realtime/src/parties/session.ts realtime/src/parties/session.test.ts
git commit -m "feat(realtime): session party with persisted chat/dice history"
```

---

### Task 7: Entrypoint, heartbeat, graceful shutdown

**Files:**

- Create: `realtime/src/index.ts`
- Modify: `realtime/src/server.ts` (add heartbeat inside `createRealtimeServer`)

**Interfaces:**

- Consumes: everything above
- Produces: runnable service — `PORT` (default 1999), `SESSION_SECRET` (required), `MONGODB_URI` (optional → falls back to `MemoryHistoryStore` with a warning)

- [ ] **Step 1: Add heartbeat to `createRealtimeServer`**

In `realtime/src/server.ts`, inside `createRealtimeServer` after `const wss = ...`:

```ts
type LiveSocket = import('ws').WebSocket & { isAlive?: boolean };

const heartbeat = setInterval(() => {
  for (const client of wss.clients as Set<LiveSocket>) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30_000);
```

Inside the `wss.handleUpgrade` callback, first lines:

```ts
(ws as LiveSocket).isAlive = true;
ws.on('pong', () => ((ws as LiveSocket).isAlive = true));
```

And extend the existing `server.on('close', ...)` handler to also `clearInterval(heartbeat)`.

- [ ] **Step 2: Implement `realtime/src/index.ts`**

```ts
import { MongoClient } from 'mongodb';
import { verifyBroadcastToken } from './auth.js';
import { MemoryHistoryStore, MongoHistoryStore, type HistoryStore } from './history.js';
import { createSessionHandler } from './parties/session.js';
import { tabletopHandler } from './parties/tabletop.js';
import { createTabletopMapHandler } from './parties/tabletopMap.js';
import { createRealtimeServer } from './server.js';

const PORT = Number(process.env.PORT ?? 1999);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.trim() === '') {
  console.error('[realtime] SESSION_SECRET is required');
  process.exit(1);
}

let store: HistoryStore;
let mongo: MongoClient | null = null;
if (process.env.MONGODB_URI) {
  mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const mongoStore = new MongoHistoryStore(mongo.db());
  await mongoStore.ensureIndexes();
  store = mongoStore;
  console.info('[realtime] chat history persisted to MongoDB');
} else {
  store = new MemoryHistoryStore();
  console.warn('[realtime] MONGODB_URI not set — chat history is in-memory only');
}

const server = createRealtimeServer({
  sessionSecret: SESSION_SECRET,
  handlers: {
    main: createSessionHandler(store),
    tabletop: tabletopHandler,
    tabletop_map: createTabletopMapHandler({
      verifyBroadcastToken: (h) => verifyBroadcastToken(h, SESSION_SECRET),
    }),
  },
});

server.listen(PORT, () => console.info(`[realtime] listening on :${PORT}`));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.info(`[realtime] ${signal} — shutting down`);
    server.close(() => {
      void (mongo ? mongo.close() : Promise.resolve()).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
```

- [ ] **Step 3: Verify build, types, and full suite**

Run: `cd realtime && npm run typecheck && npm run build && npm test`
Expected: typecheck clean, `dist/index.js` produced, all suites PASS

- [ ] **Step 4: Smoke-run the binary**

Run: `cd realtime && SESSION_SECRET=dev-secret-at-least-32-characters!! node dist/index.js &` then `curl -s -o /dev/null -w '%{http_code}' http://localhost:1999/healthz`
Expected: `200` (and the in-memory warning in the log). Kill the process afterwards.

- [ ] **Step 5: Commit**

```bash
git add realtime/src/index.ts realtime/src/server.ts
git commit -m "feat(realtime): entrypoint with heartbeat and graceful shutdown"
```

---

### Task 8: Wire into the app dev workflow + end-to-end manual verification

**Files:**

- Modify: `package.json` (root — add script), `.env.example` (comment update)

**Interfaces:**

- Consumes: the running service on port 1999; the app's existing `VITE_PUBLIC_PARTYKIT_HOST=localhost:1999` default

- [ ] **Step 1: Add the root dev script**

In root `package.json` scripts, next to `"party:dev"` (which stays until Phase 4 cutover):

```json
"realtime:dev": "npm --prefix realtime run dev",
```

In `.env.example`, change the PartyKit comment block to:

```
# Realtime service (replaces PartyKit; same host/port so partysocket needs no changes)
VITE_PUBLIC_PARTYKIT_HOST=localhost:1999
```

- [ ] **Step 2: Confirm nothing else in CI/e2e depends on the PartyKit dev server**

Run: `grep -rn "partykit\|1999" .github/workflows/ci.yml playwright.config.ts e2e/ --include="*.ts" --include="*.yml" -i`
Expected: no hits that _start_ a party server (the deploy workflow `partykit-deploy.yml` is retired in Phase 4, not here). If a hit shows e2e starting `partykit dev`, swap that command for `npm run realtime:dev` in the same task and re-run the e2e suite.

- [ ] **Step 3: Manual verification against the real app**

1. Terminal A: `SESSION_SECRET=<same value as .env> npm run realtime:dev` — the service must use the **same** `SESSION_SECRET` the app signs party tokens with (`.env`)
2. Terminal B: `npm run dev`
3. Two browser windows (one GM, one player) on the same campaign session:
   - Chat message appears in both; reload a window → history returns
   - Dice roll broadcasts to both
   - GM-channel chat appears only for the GM
   - Tabletop: token move relays between windows
   - GM sets the active map → the player's map switches (this exercises `maps.ts` → POST broadcast)
4. Check the realtime log for auth rejects or errors

Expected: behavior indistinguishable from `npm run party:dev`.

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example
git commit -m "chore: wire realtime dev script alongside partykit until cutover"
```

---

### Task 9: Dockerfile

**Files:**

- Create: `realtime/Dockerfile`, `realtime/.dockerignore`

- [ ] **Step 1: Write the Dockerfile**

`realtime/Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
USER node
EXPOSE 1999
CMD ["node", "dist/index.js"]
```

`realtime/.dockerignore`:

```
node_modules
dist
*.test.ts
```

- [ ] **Step 2: Build and smoke-test the image**

```bash
cd realtime
docker build -t cartyx-realtime:local .
docker run -d --rm -p 1999:1999 -e SESSION_SECRET=dev-secret-at-least-32-characters!! --name rt cartyx-realtime:local
curl -s -o /dev/null -w '%{http_code}' http://localhost:1999/healthz
docker stop rt
```

Expected: curl prints `200`.

- [ ] **Step 3: Commit and open the PR**

```bash
git add realtime/Dockerfile realtime/.dockerignore
git commit -m "feat(realtime): production Dockerfile"
git push -u origin realtime-service
gh pr create --base dev --title "feat: self-hosted realtime service (PartyKit replacement)" --body "..."
```

PR body should note: client untouched; PartyKit stays live until Phase 4 cutover; behavior spec is `party/*.ts`.

---

## Explicitly out of scope for this plan

- Removing `partykit`, `y-partyserver`, `partykit.json`, `party/`, and `partykit-deploy.yml` — Phase 4 cutover, after prod runs on the new service
- Helm chart / k8s manifests for the service — Phase 3
- Yjs/Hocuspocus for the dormant `collab.ts` feature — only if the collab feature is activated
- Multi-replica scaling / Redis pub-sub — single replica is the design
