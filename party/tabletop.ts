import type * as Party from 'partykit/server';

export default class TabletopParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

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
