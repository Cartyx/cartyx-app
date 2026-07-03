import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockServerCaptureException = vi.fn();
vi.mock('~/server/utils/posthog', () => ({
  serverCaptureException: (...args: unknown[]) => mockServerCaptureException(...args),
  serverCaptureEvent: vi.fn(),
  shutdownPostHog: vi.fn(),
}));

const mockFindOneAndUpdate = vi.fn();
const mockFindOne = vi.fn();
const mockUpdateOne = vi.fn();
vi.mock('~/server/db/models/User', () => ({
  User: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  },
}));

const mockConnectDB = vi.fn();
const mockIsDBConnected = vi.fn(() => true);
vi.mock('~/server/db/connection', () => ({
  connectDB: (...args: unknown[]) => mockConnectDB(...args),
  isDBConnected: () => mockIsDBConnected(),
}));

// Mock fetch globally for revokeToken tests
const originalFetch = globalThis.fetch;

// SESSION_SECRET drives the token-encryption key derivation.
process.env.SESSION_SECRET = 'test-secret-for-unit-tests-at-least-32-chars';

/** Helper: build the `findOne(...).select(...).lean()` chain used by revokeToken. */
function mockFindOneReturning(value: unknown) {
  mockFindOne.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value),
    }),
  });
}

describe('PKCE: generateCodeVerifier / deriveCodeChallenge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('generates a URL-safe (base64url) verifier of the expected length, unique per call', async () => {
    const { generateCodeVerifier } = await import('~/server/utils/oauth');
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();

    // base64url charset only: A-Z a-z 0-9 - _ (no +, /, or = padding)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes -> 43-char base64url string (within RFC 7636's 43-128).
    expect(a).toHaveLength(43);
    expect(b).toHaveLength(43);
    // Cryptographically random => different each call.
    expect(a).not.toBe(b);
  });

  it('derives code_challenge = base64url(sha256(verifier)) for S256', async () => {
    const { deriveCodeChallenge } = await import('~/server/utils/oauth');
    const { createHash } = await import('node:crypto');

    const verifier = 'test-verifier-fixed-value';
    const expected = createHash('sha256').update(verifier).digest('base64url');

    const challenge = deriveCodeChallenge(verifier);
    expect(challenge).toBe(expected);
    // SHA-256 -> 32 bytes -> 43-char base64url, URL-safe charset, no padding.
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toHaveLength(43);
    expect(challenge).not.toContain('=');
  });

  it('RFC 7636 vector: known verifier maps to the known challenge', async () => {
    const { deriveCodeChallenge } = await import('~/server/utils/oauth');
    // From RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(deriveCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('PKCE: authorize URLs include code_challenge + S256', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BASE_URL = 'https://example.com';
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    process.env.GITHUB_CLIENT_ID = 'gh-client';
    process.env.APPLE_CLIENT_ID = 'apple-client';
  });

  it('Google authorize URL includes code_challenge and S256 when challenge provided', async () => {
    const { buildGoogleOAuthUrl } = await import('~/server/utils/oauth');
    const url = buildGoogleOAuthUrl('state-1', 'challenge-abc');
    expect(url).toContain('code_challenge=challenge-abc');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('state=state-1');
  });

  it('GitHub authorize URL includes code_challenge and S256 when challenge provided', async () => {
    const { buildGithubOAuthUrl } = await import('~/server/utils/oauth');
    const url = buildGithubOAuthUrl('state-2', 'challenge-def');
    expect(url).toContain('code_challenge=challenge-def');
    expect(url).toContain('code_challenge_method=S256');
  });

  it('Apple authorize URL includes code_challenge and S256 when challenge provided', async () => {
    const { buildAppleOAuthUrl } = await import('~/server/utils/oauth');
    const url = buildAppleOAuthUrl('state-3', 'challenge-ghi');
    expect(url).toContain('code_challenge=challenge-ghi');
    expect(url).toContain('code_challenge_method=S256');
  });

  it('omits code_challenge params when no challenge is provided (behavior-preserving)', async () => {
    const { buildGoogleOAuthUrl, buildGithubOAuthUrl, buildAppleOAuthUrl } =
      await import('~/server/utils/oauth');
    for (const url of [
      buildGoogleOAuthUrl('s'),
      buildGithubOAuthUrl('s'),
      buildAppleOAuthUrl('s'),
    ]) {
      expect(url).not.toContain('code_challenge');
      expect(url).not.toContain('S256');
    }
  });
});

describe('PKCE: token exchange includes code_verifier', () => {
  const originalFetchLocal = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    process.env.BASE_URL = 'https://example.com';
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
    process.env.GITHUB_CLIENT_ID = 'gh-client';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
  });

  afterEach(() => {
    globalThis.fetch = originalFetchLocal;
  });

  it('Google token exchange request body includes code_verifier', async () => {
    const fetchMock = vi
      .fn()
      // token endpoint
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'g-access' }) })
      // userinfo endpoint
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '42', name: 'X', email: 'x@y.z' }),
      });
    globalThis.fetch = fetchMock;

    const { exchangeGoogleCode } = await import('~/server/utils/oauth');
    await exchangeGoogleCode('the-code', 'verifier-123');

    const [, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    const body = init.body.toString();
    expect(body).toContain('code_verifier=verifier-123');
    expect(body).toContain('code=the-code');
  });

  it('GitHub token exchange request body includes code_verifier', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'gh-access' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 7, name: 'X', email: 'x@y.z', avatar_url: null }),
      });
    globalThis.fetch = fetchMock;

    const { exchangeGithubCode } = await import('~/server/utils/oauth');
    await exchangeGithubCode('gh-code', 'verifier-456');

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { code_verifier?: string; code?: string };
    expect(body.code_verifier).toBe('verifier-456');
    expect(body.code).toBe('gh-code');
  });

  it('exchange omits code_verifier when none is supplied (behavior-preserving)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'g-access' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '42' }) });
    globalThis.fetch = fetchMock;

    const { exchangeGoogleCode } = await import('~/server/utils/oauth');
    await exchangeGoogleCode('the-code');

    const [, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(init.body.toString()).not.toContain('code_verifier');
  });
});

describe('upsertUser', () => {
  beforeEach(() => {
    vi.resetModules();
    mockServerCaptureException.mockClear();
    mockFindOneAndUpdate.mockClear();
    mockConnectDB.mockClear();
    mockIsDBConnected.mockReturnValue(true);
  });

  it('captures the exception to PostHog and rethrows when the DB upsert fails', async () => {
    const dbError = new Error('MongoDB connection lost');
    mockFindOneAndUpdate.mockRejectedValue(dbError);

    const { upsertUser } = await import('~/server/utils/oauth');
    const profile = {
      id: 'google_123',
      provider: 'google' as const,
      name: 'Test User',
      email: 'test@example.com',
      avatar: null,
      accessToken: 'tok',
      refreshToken: null,
      tokenIssuedAt: Date.now(),
    };

    // A persistence failure must surface, not be swallowed into a broken session:
    // the OAuth callback relies on this throw to redirect to an error page rather
    // than logging the user in with an unpersisted "unknown" session.
    await expect(upsertUser(profile)).rejects.toThrow(dbError);

    expect(mockServerCaptureException).toHaveBeenCalledWith(dbError, 'google_123', {
      action: 'upsertUser',
      provider: 'google',
    });
  });

  it('does not capture exception on successful upsert', async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      avatarUrl: null,
      role: 'gm',
    });

    const { upsertUser } = await import('~/server/utils/oauth');
    const profile = {
      id: 'github_456',
      provider: 'github' as const,
      name: 'Test User',
      email: 'test@example.com',
      avatar: null,
      accessToken: 'tok',
      refreshToken: null,
      tokenIssuedAt: Date.now(),
    };

    await upsertUser(profile);
    expect(mockServerCaptureException).not.toHaveBeenCalled();
  });

  it('persists provider tokens ENCRYPTED (not plaintext) and never returns them in the session user', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ role: 'gm' });

    const { upsertUser } = await import('~/server/utils/oauth');
    const profile = {
      id: 'google_789',
      provider: 'google' as const,
      name: 'Token User',
      email: 'tok@example.com',
      avatar: null,
      accessToken: 'super-secret-access-token',
      refreshToken: 'super-secret-refresh-token',
      tokenIssuedAt: Date.now(),
    };

    const sessionUser = await upsertUser(profile);

    // The returned SessionUser must NOT carry the provider tokens.
    expect(sessionUser).not.toHaveProperty('accessToken');
    expect(sessionUser).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(sessionUser)).not.toContain('super-secret-access-token');
    expect(JSON.stringify(sessionUser)).not.toContain('super-secret-refresh-token');
    // Identity claims preserved.
    expect(sessionUser).toMatchObject({ id: 'google_789', provider: 'google', role: 'gm' });

    // The persisted document must store encrypted tokens (ciphertext/iv/authTag),
    // never the plaintext.
    const update = mockFindOneAndUpdate.mock.calls[0][1] as {
      $set: {
        oauthTokens: { accessToken: Record<string, string>; refreshToken: Record<string, string> };
      };
    };
    const persisted = JSON.stringify(update.$set.oauthTokens);
    expect(persisted).not.toContain('super-secret-access-token');
    expect(persisted).not.toContain('super-secret-refresh-token');
    expect(update.$set.oauthTokens.accessToken).toHaveProperty('ciphertext');
    expect(update.$set.oauthTokens.accessToken).toHaveProperty('iv');
    expect(update.$set.oauthTokens.accessToken).toHaveProperty('authTag');
    expect(update.$set.oauthTokens.refreshToken).toHaveProperty('ciphertext');
  });

  it('stores null token slots when the provider returned no token', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ role: 'player' });

    const { upsertUser } = await import('~/server/utils/oauth');
    await upsertUser({
      id: 'apple_001',
      provider: 'apple' as const,
      name: null,
      email: null,
      avatar: null,
      accessToken: null,
      refreshToken: null,
      tokenIssuedAt: Date.now(),
    });

    const update = mockFindOneAndUpdate.mock.calls[0][1] as {
      $set: { oauthTokens: { accessToken: unknown; refreshToken: unknown } };
    };
    expect(update.$set.oauthTokens.accessToken).toBeNull();
    expect(update.$set.oauthTokens.refreshToken).toBeNull();
  });
});

describe('revokeToken (reads from encrypted server-side store)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockServerCaptureException.mockClear();
    mockFindOne.mockReset();
    mockUpdateOne.mockReset();
    mockConnectDB.mockClear();
    mockIsDBConnected.mockReturnValue(true);
    mockUpdateOne.mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const sessionUser = (provider: string, id = `${provider}_1`) => ({
    id,
    provider,
    name: null,
    email: null,
    avatar: null,
    role: 'gm',
    tokenIssuedAt: Date.now(),
  });

  /** Encrypt a token the same way upsertUser does, for use as stored fixture. */
  async function storedToken(plaintext: string) {
    const { encryptToken } = await import('~/server/utils/tokenCrypto');
    return encryptToken(plaintext);
  }

  it('decrypts the stored Google token and calls the Google revoke endpoint, then clears tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    mockFindOneReturning({ oauthTokens: { accessToken: await storedToken('google-access-xyz') } });

    const { revokeToken } = await import('~/server/utils/oauth');
    await revokeToken(sessionUser('google', 'google_123'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('oauth2.googleapis.com/revoke');
    // The decrypted plaintext token is sent to the provider.
    expect(url).toContain(encodeURIComponent('google-access-xyz'));
    // Tokens cleared after revocation.
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { providerId: 'google_123' },
      { $unset: { oauthTokens: '' } }
    );
    expect(mockServerCaptureException).not.toHaveBeenCalled();
  });

  it('decrypts the stored GitHub token and calls the GitHub token-delete endpoint', async () => {
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    mockFindOneReturning({ oauthTokens: { accessToken: await storedToken('gh-access-abc') } });

    const { revokeToken } = await import('~/server/utils/oauth');
    await revokeToken(sessionUser('github', 'github_456'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string; body?: string }];
    expect(url).toContain('api.github.com/applications/test-client-id/token');
    expect(init.method).toBe('DELETE');
    expect(init.body).toContain('gh-access-abc');
    expect(mockUpdateOne).toHaveBeenCalled();

    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  it('early-returns without fetch when no token is stored', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    mockFindOneReturning({ oauthTokens: undefined });

    const { revokeToken } = await import('~/server/utils/oauth');
    await revokeToken(sessionUser('google'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
    expect(mockServerCaptureException).not.toHaveBeenCalled();
  });

  it('early-returns when the user document is not found', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    mockFindOneReturning(null);

    const { revokeToken } = await import('~/server/utils/oauth');
    await revokeToken(sessionUser('google'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockServerCaptureException).not.toHaveBeenCalled();
  });

  it('captures exception to PostHog when Google token revocation fetch fails', async () => {
    const fetchError = new Error('Network timeout');
    globalThis.fetch = vi.fn().mockRejectedValue(fetchError);
    mockFindOneReturning({ oauthTokens: { accessToken: await storedToken('google-access-xyz') } });

    const { revokeToken } = await import('~/server/utils/oauth');
    await revokeToken(sessionUser('google', 'google_123'));

    expect(mockServerCaptureException).toHaveBeenCalledWith(fetchError, 'google_123', {
      action: 'revokeToken',
      provider: 'google',
    });
  });

  it('does not throw and captures exception when the stored token cannot be decrypted (e.g. rotated SESSION_SECRET)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    // A well-formed encrypted token whose ciphertext/auth tag have been tampered
    // with: the GCM auth check fails at decrypt time, so decryptToken throws.
    // This simulates the stored ciphertext no longer being decryptable (e.g. the
    // SESSION_SECRET was rotated since the token was persisted).
    const valid = await storedToken('google-access-xyz');
    const tampered = { ...valid, ciphertext: Buffer.from('garbage-ciphertext').toString('base64') };
    mockFindOneReturning({ oauthTokens: { accessToken: tampered } });

    const { revokeToken } = await import('~/server/utils/oauth');
    // Logout must proceed gracefully: revokeToken must not throw to its caller.
    await expect(revokeToken(sessionUser('google', 'google_123'))).resolves.toBeUndefined();

    // Decryption failed before any provider call or token clear could happen.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
    // The decrypt failure is captured rather than crashing.
    expect(mockServerCaptureException).toHaveBeenCalledTimes(1);
    expect(mockServerCaptureException).toHaveBeenCalledWith(expect.any(Error), 'google_123', {
      action: 'revokeToken',
      provider: 'google',
    });
  });
});
