import { SignJWT, jwtVerify } from 'jose';
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server';
import { serverCaptureException } from './utils/posthog';
import { resolveEnvironment } from './db/policy';

export interface SessionUser {
  id: string;
  provider: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: string;
  tokenIssuedAt: number;
}

const COOKIE_NAME = 'cartyx_session';

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is not set');
  if (resolveEnvironment() !== 'development' && secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production');
  }
  return new TextEncoder().encode(secret);
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const token = getCookie(COOKIE_NAME);
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
    });
    return (payload as { user: SessionUser }).user ?? null;
  } catch (e) {
    // Expected JWT errors (expired, invalid signature, bad claims) are high-volume
    // and not actionable — tag them as handled so they don't trigger alerts.
    const code = (e as { code?: string })?.code;
    const isExpectedJwtError =
      code === 'ERR_JWT_EXPIRED' ||
      code === 'ERR_JWS_INVALID' ||
      code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
      code === 'ERR_JWT_CLAIM_VALIDATION_FAILED';

    serverCaptureException(e, undefined, {
      action: 'getSession',
      step: 'jwtVerify',
      handled: isExpectedJwtError,
    });
    return null;
  }
}

export async function setSession(user: SessionUser, rememberMe = false): Promise<void> {
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
  const token = await new SignJWT({ user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(getSecret());

  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: resolveEnvironment() !== 'development',
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}

export async function clearSession(): Promise<void> {
  deleteCookie(COOKIE_NAME, { path: '/' });
}

export async function createPartyToken(
  userId: string,
  sessionId?: string,
  role?: string
): Promise<string> {
  const claims: Record<string, unknown> = { sub: userId };
  if (sessionId) claims.sessionId = sessionId;
  if (role) claims.role = role;
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getSecret());
  return token;
}

/**
 * Short-lived, signed credential the server attaches when it POSTs a
 * `map:active-changed` broadcast to the `tabletop-map` party. The party verifies
 * it (scope `tabletop-broadcast`) before relaying, so the HTTP broadcast endpoint
 * isn't an open, unauthenticated cross-campaign injection vector.
 */
export async function createPartyBroadcastToken(): Promise<string> {
  return new SignJWT({ scope: 'tabletop-broadcast' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSecret());
}
