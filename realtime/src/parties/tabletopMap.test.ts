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
