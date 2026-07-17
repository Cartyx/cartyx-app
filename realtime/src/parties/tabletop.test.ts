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

  it('drops GM-only messages from a player but relays them from a GM', async () => {
    server = createRealtimeServer({
      sessionSecret: TEST_SECRET,
      handlers: { main: tabletopHandler, tabletop: tabletopHandler, tabletop_map: tabletopHandler },
    });
    const port = await listen(server);
    const token = (sub: string, role: string) => makeToken({ sub, sessionId: 'camp-1', role });
    const player = await connect(port, 'tabletop', 'tabletop-camp-1', await token('p', 'player'));
    const gm = await connect(port, 'tabletop', 'tabletop-camp-1', await token('g', 'gm'));
    const watcher = await connect(port, 'tabletop', 'tabletop-camp-1', await token('w', 'player'));

    // A player forging tab:focus-all must not reach anyone.
    player.send('{"type":"tab:focus-all","screenId":"s1"}');
    await new Promise((r) => setTimeout(r, 50));

    // The GM's own focus-all is relayed — and is the FIRST frame the watcher
    // sees, which proves the player's frame was dropped rather than merely slow.
    gm.send('{"type":"tab:focus-all","screenId":"s2"}');
    expect(await nextMessage(watcher)).toBe('{"type":"tab:focus-all","screenId":"s2"}');

    player.close();
    gm.close();
    watcher.close();
  });

  it('still relays non-GM-only messages from a player', async () => {
    server = createRealtimeServer({
      sessionSecret: TEST_SECRET,
      handlers: { main: tabletopHandler, tabletop: tabletopHandler, tabletop_map: tabletopHandler },
    });
    const port = await listen(server);
    const token = (sub: string) => makeToken({ sub, sessionId: 'camp-1', role: 'player' });
    const ws1 = await connect(port, 'tabletop', 'tabletop-camp-1', await token('a'));
    const ws2 = await connect(port, 'tabletop', 'tabletop-camp-1', await token('b'));
    ws1.send('{"type":"tab:content-added","screenId":"s1"}');
    expect(await nextMessage(ws2)).toBe('{"type":"tab:content-added","screenId":"s1"}');
    ws1.close();
    ws2.close();
  });
});
