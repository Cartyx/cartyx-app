import type { IncomingHttpHeaders } from 'node:http';
import type { Peer, Room } from '../rooms.js';

export type PartyHandler = {
  onConnect?: (peer: Peer, room: Room) => void | Promise<void>;
  onMessage: (raw: string, sender: Peer, room: Room) => void | Promise<void>;
  /** Optional POST /parties/<party>/<room> handler → [status, body]. */
  onRequest?: (room: Room, headers: IncomingHttpHeaders, body: string) => Promise<[number, string]>;
};
