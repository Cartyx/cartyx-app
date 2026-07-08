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
