import type * as Party from 'partykit/server';
import { jwtVerify } from 'jose';

export default class TabletopParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // Authenticate and room-bind connections exactly like `tabletop-map.ts`:
  // without this, anyone with a campaign id could join the relay tokenless
  // and read/inject tabletop UI events for every connected player.
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

      // The token's sessionId claim carries the campaign id; the room is
      // exactly `tabletop-<campaignId>` (see useTabletopParty). Require the
      // claim and match the room exactly so an empty claim can't join any
      // room and a suffix collision can't cross campaigns.
      const campaignId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
      if (!campaignId) return new Response('Forbidden', { status: 403 });
      const roomId = new URL(request.url).pathname.split('/').pop() ?? '';
      if (roomId !== `tabletop-${campaignId}`) {
        return new Response('Forbidden', { status: 403 });
      }

      request.headers.set('X-User-ID', userId);
      request.headers.set(
        'X-User-Role',
        typeof payload.role === 'string' ? payload.role : 'player'
      );
      return request;
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  onConnect(conn: Party.Connection) {
    console.info(`[Tabletop] ${conn.id} connected to room ${this.room.id}`);
  }

  onMessage(message: string, sender: Party.Connection) {
    // Broadcast to all OTHER connections in the room
    this.room.broadcast(message, [sender.id]);
  }

  onClose(conn: Party.Connection) {
    console.info(`[Tabletop] ${conn.id} disconnected from room ${this.room.id}`);
  }
}
