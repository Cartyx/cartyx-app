import type * as Party from 'partykit/server';
import { jwtVerify } from 'jose';

/**
 * Tabletop Map party — broadcast channel for the live tabletop map state
 * (active-map changes, plus peer-relayed token/text/drawing events).
 *
 * Connections are authenticated in `onBeforeConnect` (JWT minted by
 * `createPartyToken`) and bound to their campaign room, mirroring
 * `party/index.ts`, so an unauthenticated or cross-campaign client cannot join
 * and inject broadcast events. Persistence remains server-function authoritative.
 */
export default class TabletopMapParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return new Response('Unauthorized', { status: 401 });

    const sessionSecret = lobby.env.SESSION_SECRET;
    if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(sessionSecret), {
        algorithms: ['HS256'],
      });
      const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!userId) return new Response('Unauthorized', { status: 401 });

      // The token's sessionId is the campaign id; the room is
      // `tabletop-map-<campaignId>`. Bind the connection to its campaign so a
      // member of one campaign can't snoop another's map room.
      const campaignId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      const roomId = new URL(request.url).pathname.split('/').pop() ?? '';
      if (campaignId && roomId && !roomId.endsWith(campaignId)) {
        return new Response('Forbidden', { status: 403 });
      }
      return request;
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  onConnect(conn: Party.Connection) {
    console.info(`[TabletopMap] ${conn.id} connected to room ${this.room.id}`);
  }

  onMessage(message: string, sender: Party.Connection) {
    // Broadcast peer messages to all OTHER connections in the room.
    // (Phase 2 uses this for throttled token-move relays.)
    this.room.broadcast(message, [sender.id]);
  }

  /**
   * HTTP endpoint — used by the server function `setActiveMap` to broadcast
   * `map:active-changed` to all connected clients without needing a socket.
   * Accepts a JSON body with shape `{ type: 'map:active-changed', mapId: string | null }`.
   */
  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
    // Only the one server→party message is accepted here:
    // `{ type: 'map:active-changed', mapId: string|null, screenId: string|null }`.
    // Token events travel peer-to-peer over the socket (onMessage), not here.
    if (!body || typeof body !== 'object') {
      return new Response('Bad payload', { status: 400 });
    }
    const { type, mapId, screenId } = body as {
      type?: unknown;
      mapId?: unknown;
      screenId?: unknown;
    };
    if (type !== 'map:active-changed' || !(typeof mapId === 'string' || mapId === null)) {
      return new Response('Bad payload', { status: 400 });
    }
    if (!(typeof screenId === 'string' || screenId === null || screenId === undefined)) {
      return new Response('Bad payload', { status: 400 });
    }
    this.room.broadcast(JSON.stringify({ type, mapId, screenId: screenId ?? null }));
    return new Response('ok');
  }

  onClose(conn: Party.Connection) {
    console.info(`[TabletopMap] ${conn.id} disconnected from room ${this.room.id}`);
  }
}
