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

describe('upsertUser', () => {
  beforeEach(() => {
    vi.resetModules();
    mockServerCaptureException.mockClear();
    mockFindOneAndUpdate.mockClear();
    mockConnectDB.mockClear();
    mockIsDBConnected.mockReturnValue(true);
  });

  it('captures exception to PostHog when DB upsert fails', async () => {
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

    const result = await upsertUser(profile);

    expect(mockServerCaptureException).toHaveBeenCalledWith(dbError, 'google_123', {
      action: 'upsertUser',
      provider: 'google',
    });
    // Should still return fallback session user with role 'unknown'
    expect(result.role).toBe('unknown');
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
});
