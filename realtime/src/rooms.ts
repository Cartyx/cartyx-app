import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ConnectionAuth, PartyName } from './auth.js';

export type Peer = ConnectionAuth & { id: string; ws: WebSocket };

export class Room {
  readonly peers = new Set<Peer>();
  /** Per-party mutable state (e.g. session history); each handler owns the shape. */
  state: unknown;

  constructor(
    readonly party: PartyName,
    readonly id: string
  ) {}

  addPeer(ws: WebSocket, auth: ConnectionAuth): Peer {
    const peer: Peer = { id: randomUUID(), ws, ...auth };
    this.peers.add(peer);
    return peer;
  }
  removePeer(peer: Peer): void {
    this.peers.delete(peer);
  }
  broadcast(data: string, excludePeerId?: string): void {
    for (const p of this.peers) {
      if (p.id === excludePeerId) continue;
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
    }
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  get(party: PartyName, roomId: string): Room {
    const key = `${party}/${roomId}`;
    let room = this.rooms.get(key);
    if (!room) {
      room = new Room(party, roomId);
      this.rooms.set(key, room);
    }
    return room;
  }
  releaseIfEmpty(room: Room): void {
    if (room.peers.size === 0) this.rooms.delete(`${room.party}/${room.id}`);
  }
}
