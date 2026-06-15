import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

// Mock PostHog server capture for testing exception logging
const mockServerCaptureException = vi.fn();
vi.mock('~/server/utils/posthog', () => ({
  serverCaptureException: (...args: unknown[]) => mockServerCaptureException(...args),
  serverCaptureEvent: vi.fn(),
  shutdownPostHog: vi.fn(),
}));

// Test the session module in isolation
describe('session', () => {
  let getCookieMock: ReturnType<typeof vi.fn>;
  let setCookieMock: ReturnType<typeof vi.fn>;
  let deleteCookieMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockServerCaptureException.mockClear();
    process.env.SESSION_SECRET = 'test-secret-for-unit-tests-at-least-32-chars';

    const startServer = await import('@tanstack/react-start/server');
    getCookieMock = vi.mocked(startServer.getCookie);
    setCookieMock = vi.mocked(startServer.setCookie);
    deleteCookieMock = vi.mocked(startServer.deleteCookie);
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

  it('getSession captures exception to PostHog on invalid token', async () => {
    getCookieMock.mockReturnValue('invalid.token.here');
    const { getSession } = await import('~/server/session');
    await getSession();
    expect(mockServerCaptureException).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({ action: 'getSession', step: 'jwtVerify' })
    );
  });

  it('getSession tags expected JWT errors as handled', async () => {
    getCookieMock.mockReturnValue('invalid.token.here');
    const { getSession } = await import('~/server/session');
    await getSession();
    expect(mockServerCaptureException).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({ handled: expect.any(Boolean) })
    );
  });

  it('getSession does not capture exception when no cookie', async () => {
    getCookieMock.mockReturnValue(undefined);
    const { getSession } = await import('~/server/session');
    await getSession();
    expect(mockServerCaptureException).not.toHaveBeenCalled();
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
