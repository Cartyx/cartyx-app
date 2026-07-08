import { jwtVerify } from 'jose';

export type ConnectionAuth = { userId: string; role: string };
export type PartyName = 'main' | 'tabletop' | 'tabletop_map';

// Room-binding rules ported from party/index.ts, party/tabletop.ts, and
// party/tabletop-map.ts onBeforeConnect, with uniform claim trimming applied
// (the originals trim the sessionId claim for tabletop/tabletop_map only).
const ROOM_BINDING: Record<PartyName, (claim: string, roomId: string) => boolean> = {
  main: (claim, roomId) => claim === '' || roomId === '' || claim === roomId,
  tabletop: (claim, roomId) => claim !== '' && roomId === `tabletop-${claim}`,
  tabletop_map: (claim, roomId) => claim !== '' && roomId === `tabletop-map-${claim}`,
};

export async function verifyConnectionToken(
  party: PartyName,
  roomId: string,
  token: string | null,
  sessionSecret: string | undefined
): Promise<ConnectionAuth | null> {
  if (!token) return null;
  if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(sessionSecret), {
      algorithms: ['HS256'],
    });
    const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!userId) return null;
    const claim = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!ROOM_BINDING[party](claim, roomId)) return null;
    const role = typeof payload.role === 'string' ? payload.role : 'player';
    return { userId, role };
  } catch {
    return null;
  }
}

export async function verifyBroadcastToken(
  authorizationHeader: string | undefined,
  sessionSecret: string | undefined
): Promise<boolean> {
  if (typeof sessionSecret !== 'string' || sessionSecret.trim() === '') return false;
  const auth = authorizationHeader ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer) return false;
  try {
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(sessionSecret), {
      algorithms: ['HS256'],
    });
    return payload.scope === 'tabletop-broadcast';
  } catch {
    return false;
  }
}
