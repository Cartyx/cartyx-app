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
