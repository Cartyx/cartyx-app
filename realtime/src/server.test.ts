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

  it('survives a malformed percent-encoded room id and keeps serving', async () => {
    server = makeServer();
    const port = await listen(server);
    await expect(
      new Promise((_, reject) => {
        const bad = new RawWebSocket(`ws://127.0.0.1:${port}/parties/main/%zz`);
        bad.once('error', reject);
      })
    ).rejects.toThrow(/404/);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  });

  it('survives a handler that throws in onMessage', async () => {
    const throwing: PartyHandler = {
      onMessage() {
        throw new Error('handler boom');
      },
    };
    server = createRealtimeServer({
      sessionSecret: TEST_SECRET,
      handlers: { main: throwing, tabletop: throwing, tabletop_map: throwing },
    });
    const port = await listen(server);
    const token = await makeToken({ sub: 'a', sessionId: 'room-1' });
    const ws = await connect(port, 'main', 'room-1', token);
    ws.send('trigger');
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.readyState).toBe(ws.OPEN); // connection survived
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    ws.close();
  });

  it('survives a malformed (invalid-UTF-8) text frame from an authenticated peer', async () => {
    server = makeServer();
    const port = await listen(server);
    const token = await makeToken({ sub: 'a', sessionId: 'room-1' });
    const ws = await connect(port, 'main', 'room-1', token);
    // Invalid UTF-8 in a text frame → ws emits 'error' on this socket.
    ws.send(Buffer.from([0xc3, 0x28]), { binary: false });
    await new Promise((r) => setTimeout(r, 50));
    // The offending socket is torn down, but the server stays up.
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    // A fresh client can still connect and get a WELCOME.
    const ws2 = await connect(
      port,
      'main',
      'room-1',
      await makeToken({ sub: 'b', sessionId: 'room-1' })
    );
    expect(JSON.parse(await nextMessage(ws2))).toMatchObject({ type: 'WELCOME' });
    ws2.close();
  });
});
