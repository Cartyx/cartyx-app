import type { PartyHandler } from './types.js';

/** Pure relay — port of party/tabletop.ts onMessage. */
export const tabletopHandler: PartyHandler = {
  onMessage(raw, sender, room) {
    room.broadcast(raw, sender.id);
  },
};
