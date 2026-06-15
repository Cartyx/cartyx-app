import type * as Party from 'partykit/server';
import { jwtVerify } from 'jose';

/** Connection state persisted across hibernation — the authenticated identity. */
type TabletopMapAuth = { userId: string; role: string };

/**
 * Message types that only a GM may originate. Drawings are a GM-only feature
 * (the server returns `[]` to players and rejects every drawing mutation), and
 * token create/update/delete are GM-only server-side. A non-GM peer must not be
 * able to inject these onto everyone else's screen, so the party drops them at
 * the relay even though persistence is already server-authoritative.
 *
 * `token:moved` (players may move their own tokens) and `text:*` (collaborative)
 * are intentionally NOT gated here.
 */
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

const DEBUG = false;

/**
 * Tabletop Map party — broadcast channel for the live tabletop map state
 * (active-map changes, plus peer-relayed token/text/drawing events).
 *
 * Connections are authenticated in `onBeforeConnect` (JWT minted by
 * `createPartyToken`) and bound to their exact campaign room, mirroring
 * `party/index.ts`, so an unauthenticated or cross-campaign client cannot join
 * and inject broadcast events. The relay additionally enforces the GM-only
 * message set per sender role, and the server→party HTTP endpoint requires a
 * signed broadcast token. Persistence remains server-function authoritative.
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

      // The token's sessionId is the campaign id; the room is exactly
      // `tabletop-map-<campaignId>`. Require the claim and match the room
      // exactly so a token with a missing/empty campaign id can't join any
      // room and a suffix collision can't cross campaigns.
      const campaignId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
      if (!campaignId) return new Response('Forbidden', { status: 403 });
      const roomId = new URL(request.url).pathname.split('/').pop() ?? '';
      if (roomId !== `tabletop-map-${campaignId}`) {
        return new Response('Forbidden', { status: 403 });
      }

      // Carry the authenticated identity to onConnect (survives hibernation via
      // connection state) so the relay can enforce per-role gating.
      const role = typeof payload.role === 'string' ? payload.role : 'player';
      request.headers.set('X-User-ID', userId);
      request.headers.set('X-User-Role', role);
      return request;
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  onConnect(conn: Party.Connection<TabletopMapAuth>, ctx: Party.ConnectionContext) {
    const userId = ctx.request.headers.get('X-User-ID') ?? '';
    const role = ctx.request.headers.get('X-User-Role') ?? 'player';
    if (userId) conn.setState({ userId, role });
    if (DEBUG) console.info(`[TabletopMap] ${conn.id} connected to room ${this.room.id}`);
  }

  onMessage(message: string, sender: Party.Connection<TabletopMapAuth>) {
    // Validate shape and enforce the GM-only message set before relaying.
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return; // Drop malformed frames.
    }
    if (!parsed || typeof parsed !== 'object') return;
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== 'string') return;

    // `map:active-changed` is only legitimate from the authenticated server
    // (onRequest); never accept it from a socket peer.
    if (type === 'map:active-changed') return;

    const senderRole = sender.state?.role ?? 'player';
    if (senderRole !== 'gm' && GM_ONLY_MESSAGE_TYPES.has(type)) {
      if (DEBUG) console.info(`[TabletopMap] dropped GM-only "${type}" from non-GM ${sender.id}`);
      return;
    }

    // Re-serialize the validated object (not the raw string) and broadcast to
    // all OTHER connections in the room.
    this.room.broadcast(JSON.stringify(parsed), [sender.id]);
  }

  /**
   * HTTP endpoint — used by the server function `setActiveMap`/`deleteMap` to
   * broadcast `map:active-changed` to all connected clients without a socket.
   * Requires a signed broadcast token (scope `tabletop-broadcast`) so the
   * endpoint isn't an open, unauthenticated cross-campaign injection vector.
   * Accepts `{ type: 'map:active-changed', mapId: string|null, screenId?: string|null }`.
   */
  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const sessionSecret = this.room.env.SESSION_SECRET;
    if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') {
      return new Response('Unauthorized', { status: 401 });
    }
    const auth = req.headers.get('authorization') ?? '';
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!bearer) return new Response('Unauthorized', { status: 401 });
    try {
      const { payload } = await jwtVerify(bearer, new TextEncoder().encode(sessionSecret), {
        algorithms: ['HS256'],
      });
      if (payload.scope !== 'tabletop-broadcast') {
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
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

  onClose(conn: Party.Connection<TabletopMapAuth>) {
    if (DEBUG) console.info(`[TabletopMap] ${conn.id} disconnected from room ${this.room.id}`);
  }
}
