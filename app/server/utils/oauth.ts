import { createHash, randomBytes } from 'node:crypto';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import type { SessionUser } from '../session';
import { providerConfigured } from './helpers';
import { serverCaptureException } from './posthog';
import { encryptToken, decryptToken } from './tokenCrypto';

export { providerConfigured };

export interface OAuthProfile {
  id: string;
  provider: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenIssuedAt: number;
}

function requireBaseUrl(): string {
  const url = process.env.BASE_URL;
  if (!url) throw new Error('BASE_URL environment variable is required for OAuth');
  return url;
}

/**
 * Generate a PKCE code_verifier: a high-entropy, URL-safe random string.
 * 32 random bytes -> 43-char base64url string (well within RFC 7636's 43-128).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Derive the PKCE code_challenge for the S256 method:
 *   code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 */
export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildGoogleOAuthUrl(state?: string, codeChallenge?: string): string {
  const baseUrl = requireBaseUrl();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${baseUrl}/auth/callback/google`,
    response_type: 'code',
    scope: 'openid profile email',
    access_type: 'offline',
    prompt: 'consent',
    ...(state && { state }),
    ...(codeChallenge && { code_challenge: codeChallenge, code_challenge_method: 'S256' }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function buildGithubOAuthUrl(state?: string, codeChallenge?: string): string {
  const baseUrl = requireBaseUrl();
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${baseUrl}/auth/callback/github`,
    scope: 'user:email',
    ...(state && { state }),
    ...(codeChallenge && { code_challenge: codeChallenge, code_challenge_method: 'S256' }),
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export function buildAppleOAuthUrl(state?: string, codeChallenge?: string): string {
  const baseUrl = requireBaseUrl();
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID!,
    redirect_uri: `${baseUrl}/auth/callback/apple`,
    response_type: 'code',
    scope: 'name email',
    response_mode: 'query',
    ...(state && { state }),
    ...(codeChallenge && { code_challenge: codeChallenge, code_challenge_method: 'S256' }),
  });
  return `https://appleid.apple.com/auth/authorize?${params}`;
}

export async function exchangeAppleCode(
  code: string,
  codeVerifier?: string
): Promise<OAuthProfile> {
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_PATH } = process.env;
  const appleBaseUrl = requireBaseUrl();
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY_PATH) {
    const err = new Error('Apple OAuth not configured');
    serverCaptureException(err, undefined, { provider: 'apple', action: 'exchangeCode' });
    throw err;
  }

  const { readFileSync } = await import('node:fs');
  const privateKey = readFileSync(APPLE_PRIVATE_KEY_PATH, 'utf8');
  const { importPKCS8, jwtVerify, createRemoteJWKSet, SignJWT } = await import('jose');
  const key = await importPKCS8(privateKey, 'ES256');

  const clientSecret = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience('https://appleid.apple.com')
    .setSubject(APPLE_CLIENT_ID)
    .sign(key);

  const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${appleBaseUrl}/auth/callback/apple`,
      ...(codeVerifier && { code_verifier: codeVerifier }),
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => 'unknown error');
    const err = new Error(`Apple token exchange failed (HTTP ${tokenRes.status}): ${body}`);
    serverCaptureException(err, undefined, {
      provider: 'apple',
      action: 'tokenExchange',
      status: tokenRes.status,
    });
    throw err;
  }
  const tokens = (await tokenRes.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (tokens.error || !tokens.id_token) {
    const err = new Error(`Apple token exchange failed: ${tokens.error ?? 'no id_token returned'}`);
    serverCaptureException(err, undefined, {
      provider: 'apple',
      action: 'tokenParse',
      tokenError: tokens.error,
    });
    throw err;
  }

  const JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  const { payload } = await jwtVerify(tokens.id_token, JWKS, {
    issuer: 'https://appleid.apple.com',
    audience: APPLE_CLIENT_ID,
  });

  return {
    id: `apple_${payload.sub}`,
    provider: 'apple',
    name: null,
    email: (payload.email as string | undefined) ?? null,
    avatar: null,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    tokenIssuedAt: Date.now(),
  };
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier?: string
): Promise<OAuthProfile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${requireBaseUrl()}/auth/callback/google`,
      grant_type: 'authorization_code',
      ...(codeVerifier && { code_verifier: codeVerifier }),
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    const err = new Error(`Google token exchange failed (HTTP ${tokenRes.status}): ${body}`);
    serverCaptureException(err, undefined, {
      provider: 'google',
      action: 'tokenExchange',
      status: tokenRes.status,
    });
    throw err;
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (tokens.error || !tokens.access_token) {
    const err = new Error(
      `Google token exchange failed: ${tokens.error ?? 'no access_token returned'}`
    );
    serverCaptureException(err, undefined, {
      provider: 'google',
      action: 'tokenParse',
      tokenError: tokens.error,
    });
    throw err;
  }

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    const err = new Error(`Google profile fetch failed (HTTP ${profileRes.status})`);
    serverCaptureException(err, undefined, {
      provider: 'google',
      action: 'profileFetch',
      status: profileRes.status,
    });
    throw err;
  }
  const profile = (await profileRes.json()) as {
    id?: string;
    name?: string;
    email?: string;
    picture?: string;
  };
  if (!profile.id) {
    const err = new Error('Google profile missing required id field');
    serverCaptureException(err, undefined, { provider: 'google', action: 'profileParse' });
    throw err;
  }

  return {
    id: `google_${profile.id}`,
    provider: 'google',
    name: profile.name ?? null,
    email: profile.email ?? null,
    avatar: profile.picture ?? null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    tokenIssuedAt: Date.now(),
  };
}

export async function exchangeGithubCode(
  code: string,
  codeVerifier?: string
): Promise<OAuthProfile> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      code,
      redirect_uri: `${requireBaseUrl()}/auth/callback/github`,
      ...(codeVerifier && { code_verifier: codeVerifier }),
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    const err = new Error(`GitHub token exchange failed (HTTP ${tokenRes.status}): ${body}`);
    serverCaptureException(err, undefined, {
      provider: 'github',
      action: 'tokenExchange',
      status: tokenRes.status,
    });
    throw err;
  }
  const tokens = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (tokens.error || !tokens.access_token) {
    const err = new Error(
      `GitHub token exchange failed: ${tokens.error ?? 'no access_token returned'}`
    );
    serverCaptureException(err, undefined, {
      provider: 'github',
      action: 'tokenParse',
      tokenError: tokens.error,
    });
    throw err;
  }

  const profileRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!profileRes.ok) {
    const err = new Error(`GitHub profile fetch failed (HTTP ${profileRes.status})`);
    serverCaptureException(err, undefined, {
      provider: 'github',
      action: 'profileFetch',
      status: profileRes.status,
    });
    throw err;
  }
  const profile = (await profileRes.json()) as {
    id?: number;
    name?: string;
    email?: string;
    avatar_url?: string;
  };
  if (!profile.id) {
    const err = new Error('GitHub profile missing required id field');
    serverCaptureException(err, undefined, { provider: 'github', action: 'profileParse' });
    throw err;
  }

  // Fetch emails if not returned in main profile
  let email = profile.email ?? null;
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean }>;
    email = emails.find((e) => e.primary)?.email ?? null;
  }

  return {
    id: `github_${profile.id}`,
    provider: 'github',
    name: profile.name ?? null,
    email,
    avatar: profile.avatar_url ?? null,
    accessToken: tokens.access_token,
    refreshToken: null,
    tokenIssuedAt: Date.now(),
  };
}

/** Build the SessionUser identity claims, never including provider tokens. */
function toSessionUser(profile: OAuthProfile, role: string, stored?: UserDoc | null): SessionUser {
  return {
    id: profile.id,
    provider: profile.provider,
    email: profile.email ?? stored?.email ?? null,
    name: profile.name ?? (`${stored?.firstName ?? ''} ${stored?.lastName ?? ''}`.trim() || null),
    avatar: profile.avatar ?? stored?.avatarUrl ?? null,
    role,
    tokenIssuedAt: profile.tokenIssuedAt,
  };
}

interface UserDoc {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  role?: string;
}

export async function upsertUser(profile: OAuthProfile): Promise<SessionUser> {
  await connectDB();
  if (!isDBConnected()) return toSessionUser(profile, 'unknown');

  try {
    const nameParts = (profile.name ?? '').split(' ');
    // Encrypt provider tokens for at-rest storage. They never travel in the
    // session cookie; they're read back (decrypted) only at logout to revoke.
    const oauthTokens = {
      accessToken: profile.accessToken ? encryptToken(profile.accessToken) : null,
      refreshToken: profile.refreshToken ? encryptToken(profile.refreshToken) : null,
    };
    const $set = {
      provider: profile.provider,
      providerId: profile.id,
      ...(profile.email && { email: profile.email }),
      ...(profile.name && {
        firstName: nameParts[0] ?? '',
        lastName: nameParts.slice(1).join(' ') ?? '',
      }),
      ...(profile.avatar && { avatarUrl: profile.avatar }),
      oauthTokens,
      lastLoginAt: new Date(),
    };

    // 1. Returning user — match by the OAuth subject id.
    let stored = (await User.findOneAndUpdate(
      { providerId: profile.id },
      { $set },
      { returnDocument: 'after', new: true }
    )) as UserDoc | null;

    // 2. First login for a pre-provisioned account. The dev seed (and the
    //    invite flow) create User docs keyed only by email, with no providerId,
    //    to be "claimed" on first OAuth login. Link the OAuth identity onto that
    //    existing doc — which preserves its campaign memberships. Only claim
    //    docs with no providerId yet, so we never hijack an account already
    //    bound to a different provider identity.
    if (!stored && profile.email) {
      stored = (await User.findOneAndUpdate(
        { email: profile.email, providerId: null },
        { $set },
        { returnDocument: 'after', new: true }
      )) as UserDoc | null;
    }

    // 3. Brand-new user — create the account.
    if (!stored) {
      stored = (await User.findOneAndUpdate(
        { providerId: profile.id },
        { $set, $setOnInsert: { createdAt: new Date(), role: 'unknown' } },
        { upsert: true, returnDocument: 'after', new: true }
      )) as UserDoc | null;
    }

    return toSessionUser(profile, stored?.role ?? 'unknown', stored);
  } catch (e) {
    serverCaptureException(e, profile.id, { action: 'upsertUser', provider: profile.provider });
    return toSessionUser(profile, 'unknown');
  }
}

interface EncryptedTokenField {
  ciphertext?: string;
  iv?: string;
  authTag?: string;
}

/**
 * Revoke the provider grant for the given session user.
 *
 * The provider access token is no longer carried in the session cookie; it is
 * loaded (encrypted) from the User document, decrypted, and used to call the
 * provider's revoke/delete endpoint. Revocation is best-effort: the stored
 * tokens are cleared once the attempt is made (regardless of the provider's
 * HTTP response), so a token the provider has already rejected can't linger
 * and fail again on the next logout. Preserves the original
 * early-return-when-no-token behavior and per-provider routing (Google revoke,
 * GitHub token delete; Apple has no revoke path).
 */
export async function revokeToken(user: SessionUser): Promise<void> {
  try {
    await connectDB();
    if (!isDBConnected()) return;

    // Tokens are select:false, so they must be explicitly selected.
    const stored = (await User.findOne({ providerId: user.id }).select('+oauthTokens').lean()) as {
      oauthTokens?: { accessToken?: EncryptedTokenField | null };
    } | null;

    const enc = stored?.oauthTokens?.accessToken;
    if (!enc || !enc.ciphertext || !enc.iv || !enc.authTag) return;

    const accessToken = decryptToken({
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
    });

    if (user.provider === 'google') {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } else if (
      user.provider === 'github' &&
      process.env.GITHUB_CLIENT_ID &&
      process.env.GITHUB_CLIENT_SECRET
    ) {
      const creds = Buffer.from(
        `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
      ).toString('base64');
      await fetch(`https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/token`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${creds}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
    }

    // Clear the stored tokens once we've attempted revocation.
    await User.updateOne({ providerId: user.id }, { $unset: { oauthTokens: '' } });
  } catch (e) {
    serverCaptureException(e, user.id, { action: 'revokeToken', provider: user.provider });
  }
}
