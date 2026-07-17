import type { PartyHandler } from './types.js';

/**
 * GM-only message types. Each corresponds to an action the UI offers only to a
 * GM and, except for `tab:focus-all`, a server mutation that already requires
 * GM. `tab:focus-all` has no server mutation at all — it is pure relay — so
 * without this gate any player could yank every client to a tab of their
 * choosing.
 *
 * The connection token carries the caller's campaign role (see
 * `createPartyToken`), so this mirrors the check in tabletopMap.ts.
 */
const GM_ONLY_MESSAGE_TYPES = new Set([
  'tab:create',
  'tab:rename',
  'tab:delete',
  'tab:focus-all',
  'window:show',
  'window:close',
  'grid:style-change',
]);

export const tabletopHandler: PartyHandler = {
  onMessage(raw, sender, room) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== 'string') return;
    if (sender.role !== 'gm' && GM_ONLY_MESSAGE_TYPES.has(type)) return;
    room.broadcast(raw, sender.id);
  },
};
