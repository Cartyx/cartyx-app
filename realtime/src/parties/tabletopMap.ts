import type { PartyHandler } from './types.js';

/** GM-only message types — ported verbatim from party/tabletop-map.ts. */
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

export function createTabletopMapHandler(deps: {
  verifyBroadcastToken: (authHeader: string | undefined) => Promise<boolean>;
}): PartyHandler {
  return {
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
      // Only the authenticated server (onRequest) may originate this.
      if (type === 'map:active-changed') return;
      if (sender.role !== 'gm' && GM_ONLY_MESSAGE_TYPES.has(type)) return;
      room.broadcast(JSON.stringify(parsed), sender.id);
    },

    async onRequest(room, headers, body) {
      const authHeader = Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : headers.authorization;
      if (!(await deps.verifyBroadcastToken(authHeader))) return [401, 'Unauthorized'];

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return [400, 'Bad JSON'];
      }
      if (!parsed || typeof parsed !== 'object') return [400, 'Bad payload'];
      const { type, mapId, screenId } = parsed as {
        type?: unknown;
        mapId?: unknown;
        screenId?: unknown;
      };
      if (type !== 'map:active-changed' || !(typeof mapId === 'string' || mapId === null)) {
        return [400, 'Bad payload'];
      }
      if (!(typeof screenId === 'string' || screenId === null || screenId === undefined)) {
        return [400, 'Bad payload'];
      }
      room.broadcast(JSON.stringify({ type, mapId, screenId: screenId ?? null }));
      return [200, 'ok'];
    },
  };
}
