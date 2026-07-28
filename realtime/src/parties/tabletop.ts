import type { PartyHandler } from './types.js';

/**
 * GM-only message types. Each corresponds to an action the UI offers only to a
 * GM and, except for `tab:focus-all` and `tab:content-added`, a server mutation
 * that already requires GM. Those two have no server mutation at all — they are
 * pure relay — so without this gate any player could yank every client to a tab
 * of their choosing (`tab:focus-all`) or badge arbitrary tabs on every client
 * (`tab:content-added`).
 *
 * This set must cover every GM-originated member of the TabletopMessage union
 * in ~/types/tabletop — including types nothing currently sends, since an
 * ungated type is forgeable whether or not the app itself emits it.
 *
 * The connection token carries the caller's campaign role (see
 * `createPartyToken`), so this mirrors the check in tabletopMap.ts.
 */
const GM_ONLY_MESSAGE_TYPES = new Set([
  'tab:create',
  'tab:rename',
  'tab:delete',
  'tab:focus-all',
  'tab:content-added',
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
