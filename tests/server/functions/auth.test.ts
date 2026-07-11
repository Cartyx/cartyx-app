import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';

// Test the session module in isolation
describe('session', () => {
  let getCookieMock: ReturnType<typeof vi.fn>;
  let setCookieMock: ReturnType<typeof vi.fn>;
  let deleteCookieMock: ReturnType<typeof vi.fn>;

  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    vi.resetModules();
    savedEnv.APP_ENV = process.env.APP_ENV;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    process.env.SESSION_SECRET = 'test-secret-for-unit-tests-at-least-32-chars';
    delete process.env.APP_ENV;
    delete process.env.NODE_ENV;

    const startServer = await import('@tanstack/react-start/server');
    getCookieMock = vi.mocked(startServer.getCookie);
    setCookieMock = vi.mocked(startServer.setCookie);
    deleteCookieMock = vi.mocked(startServer.deleteCookie);
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('getSession returns null when no cookie', async () => {
    getCookieMock.mockReturnValue(undefined);
    const { getSession } = await import('~/server/session');
    const result = await getSession();
    expect(result).toBeNull();
  });

  it('getSession returns null for invalid token', async () => {
    getCookieMock.mockReturnValue('invalid.token.here');
    const { getSession } = await import('~/server/session');
    const result = await getSession();
    expect(result).toBeNull();
  });

  it('getSession returns user for valid token', async () => {
    const secret = new TextEncoder().encode('test-secret-for-unit-tests-at-least-32-chars');
    const user = {
      id: 'google_123',
      provider: 'google',
      name: 'Test User',
      email: 'test@example.com',
      avatar: null,
      role: 'gm',
      tokenIssuedAt: Date.now(),
    };
    const token = await new SignJWT({ user })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secret);
    getCookieMock.mockReturnValue(token);

    const { getSession } = await import('~/server/session');
    const result = await getSession();
    expect(result).toMatchObject({ id: 'google_123', provider: 'google', role: 'gm' });
  });

  it('setSession calls setCookie with httpOnly token', async () => {
    const { setSession } = await import('~/server/session');
    const user = {
      id: 'github_456',
      provider: 'github',
      name: 'Dev User',
      email: null,
      avatar: null,
      role: 'player',
      tokenIssuedAt: Date.now(),
    };
    await setSession(user);
    expect(setCookieMock).toHaveBeenCalledWith(
      'cartyx_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
    );
  });

  it('session cookie payload never contains provider tokens', async () => {
    const { jwtVerify } = await import('jose');
    const { setSession } = await import('~/server/session');
    const user = {
      id: 'google_999',
      provider: 'google',
      name: 'Tok User',
      email: null,
      avatar: null,
      role: 'gm',
      tokenIssuedAt: Date.now(),
    };
    await setSession(user);

    const signedToken = setCookieMock.mock.calls[0][1] as string;
    // Decode + verify the signed cookie payload.
    const secret = new TextEncoder().encode('test-secret-for-unit-tests-at-least-32-chars');
    const { payload } = await jwtVerify(signedToken, secret, { algorithms: ['HS256'] });
    const sessionUser = (payload as { user: Record<string, unknown> }).user;
    expect(sessionUser).not.toHaveProperty('accessToken');
    expect(sessionUser).not.toHaveProperty('refreshToken');
    // The raw signed token string must not embed any token material either.
    expect(JSON.stringify(payload)).not.toContain('accessToken');
    expect(JSON.stringify(payload)).not.toContain('refreshToken');
  });

  it('clearSession calls deleteCookie', async () => {
    const { clearSession } = await import('~/server/session');
    await clearSession();
    expect(deleteCookieMock).toHaveBeenCalledWith('cartyx_session', { path: '/' });
  });

  describe('cookie security keyed to APP_ENV', () => {
    const user = {
      id: 'google_123',
      provider: 'google',
      name: 'Test User',
      email: null,
      avatar: null,
      role: 'gm',
      tokenIssuedAt: Date.now(),
    };

    it('sets secure:false when APP_ENV/NODE_ENV are unset (dev default)', async () => {
      const { setSession } = await import('~/server/session');
      await setSession(user);
      expect(setCookieMock).toHaveBeenCalledWith(
        'cartyx_session',
        expect.any(String),
        expect.objectContaining({ secure: false })
      );
    });

    it('sets secure:true when APP_ENV=production', async () => {
      process.env.APP_ENV = 'production';
      const { setSession } = await import('~/server/session');
      await setSession(user);
      expect(setCookieMock).toHaveBeenCalledWith(
        'cartyx_session',
        expect.any(String),
        expect.objectContaining({ secure: true })
      );
    });

    it('sets secure:true when APP_ENV=staging', async () => {
      process.env.APP_ENV = 'staging';
      const { setSession } = await import('~/server/session');
      await setSession(user);
      expect(setCookieMock).toHaveBeenCalledWith(
        'cartyx_session',
        expect.any(String),
        expect.objectContaining({ secure: true })
      );
    });

    it('does NOT depend on NODE_ENV alone: bare-metal npm start (NODE_ENV=production, APP_ENV unset) still gets secure:true via fallback', async () => {
      process.env.NODE_ENV = 'production';
      const { setSession } = await import('~/server/session');
      await setSession(user);
      expect(setCookieMock).toHaveBeenCalledWith(
        'cartyx_session',
        expect.any(String),
        expect.objectContaining({ secure: true })
      );
    });

    it('enforces the 32-char SESSION_SECRET minimum when APP_ENV=production', async () => {
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = 'too-short';
      const { setSession } = await import('~/server/session');
      await expect(setSession(user)).rejects.toThrow(/32 characters/);
    });

    it('enforces the 32-char SESSION_SECRET minimum when APP_ENV=staging', async () => {
      process.env.APP_ENV = 'staging';
      process.env.SESSION_SECRET = 'too-short';
      const { setSession } = await import('~/server/session');
      await expect(setSession(user)).rejects.toThrow(/32 characters/);
    });

    it('does not enforce the secret-length check in development', async () => {
      process.env.APP_ENV = 'development';
      process.env.SESSION_SECRET = 'too-short';
      const { setSession } = await import('~/server/session');
      await expect(setSession(user)).resolves.toBeUndefined();
    });
  });
});

describe('OAuth URL builders', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-github-secret';
    process.env.BASE_URL = 'https://example.com';
  });

  it('buildGoogleOAuthUrl returns valid URL with state', async () => {
    const { buildGoogleOAuthUrl } = await import('~/server/utils/oauth');
    const url = buildGoogleOAuthUrl('test-state-123');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=test-google-client-id');
    expect(url).toContain('scope=openid+profile+email');
    expect(url).toContain('state=test-state-123');
  });

  it('buildGoogleOAuthUrl works without state', async () => {
    const { buildGoogleOAuthUrl } = await import('~/server/utils/oauth');
    const url = buildGoogleOAuthUrl();
    expect(url).toContain('accounts.google.com');
    expect(url).not.toContain('state=');
  });

  it('buildGithubOAuthUrl returns valid URL with state', async () => {
    const { buildGithubOAuthUrl } = await import('~/server/utils/oauth');
    const url = buildGithubOAuthUrl('csrf-token');
    expect(url).toContain('github.com/login/oauth/authorize');
    expect(url).toContain('client_id=test-github-client-id');
    expect(url).toContain('state=csrf-token');
  });
});

describe('providerConfigured', () => {
  beforeEach(() => {
    process.env.BASE_URL = 'https://example.com';
  });

  it('returns false when env vars missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const { providerConfigured } = await import('~/server/utils/helpers');
    expect(providerConfigured('google')).toBe(false);
  });

  it('returns true when both env vars present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    const { providerConfigured } = await import('~/server/utils/helpers');
    expect(providerConfigured('google')).toBe(true);
  });

  it('returns false for unknown provider', async () => {
    const { providerConfigured } = await import('~/server/utils/helpers');
    expect(providerConfigured('facebook')).toBe(false);
  });

  it('returns false when BASE_URL is missing', async () => {
    delete process.env.BASE_URL;
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    const { providerConfigured } = await import('~/server/utils/helpers');
    expect(providerConfigured('google')).toBe(false);
  });
});
