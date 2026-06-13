import type * as Party from 'partykit/server';

/**
 * Tabletop Map party — broadcast channel for the live tabletop map state.
 *
 * Phase 1: only `map:active-changed` is emitted (by the server function
 * `setActiveMap` posting through the HTTP party API). Clients react by
 * refetching the active map. Phase 2 adds `token:*` events.
 *
 * Mirrors the simple-relay shape of `party/tabletop.ts`. Auth is deferred
 * to match the existing tabletop party; a future hardening pass should add
 * `onBeforeConnect` JWT verification like `party/index.ts`.
 */
export default class TabletopMapParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

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
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as { type?: unknown }).type !== 'string'
    ) {
      return new Response('Bad payload', { status: 400 });
    }
    this.room.broadcast(JSON.stringify(body));
    return new Response('ok');
  }

  onClose(conn: Party.Connection) {
    console.info(`[TabletopMap] ${conn.id} disconnected from room ${this.room.id}`);
  }
}
