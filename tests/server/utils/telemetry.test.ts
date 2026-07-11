import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentryCapture = vi.fn();
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: sentryCapture,
  flush: vi.fn().mockResolvedValue(true),
}));

describe('server telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryCapture.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    process.env.GLITCHTIP_DSN = 'https://key@glitchtip.cartyx.io/1';
    process.env.UMAMI_WEBSITE_ID = 'site-1';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GLITCHTIP_DSN;
    delete process.env.UMAMI_WEBSITE_ID;
  });

  it('serverCaptureException forwards to Sentry', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    const err = new Error('boom');
    await serverCaptureException(err, 'user-1', { fn: 'maps' });
    expect(sentryCapture).toHaveBeenCalledWith(err, {
      user: { id: 'user-1' },
      extra: { fn: 'maps' },
    });
  });

  it('serverCaptureEvent posts an Umami event', async () => {
    const { serverCaptureEvent } = await import('~/server/utils/telemetry');
    await serverCaptureEvent('user-1', 'campaign.created', { plan: 'free' });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://umami.cartyx.io/api/send');
    // RequestInit is a TS ambient DOM type, not a runtime global; no-undef doesn't know TS type positions.
    // eslint-disable-next-line no-undef
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      type: 'event',
      payload: {
        website: 'site-1',
        name: 'campaign.created',
        data: { plan: 'free', distinctId: 'user-1' },
      },
    });
    // eslint-disable-next-line no-undef -- see above
    expect((init as RequestInit).headers).toMatchObject({ 'User-Agent': expect.any(String) });
  });

  it('is a no-op without env vars', async () => {
    delete process.env.GLITCHTIP_DSN;
    delete process.env.UMAMI_WEBSITE_ID;
    const { serverCaptureException, serverCaptureEvent } = await import('~/server/utils/telemetry');
    await serverCaptureException(new Error('x'));
    await serverCaptureEvent('u', 'e');
    expect(sentryCapture).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
