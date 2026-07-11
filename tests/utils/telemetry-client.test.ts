import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryCapture = vi.fn();
vi.mock('@sentry/browser', () => ({
  init: vi.fn(),
  captureException: sentryCapture,
}));

describe('telemetry-client', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryCapture.mockClear();
    (window as unknown as { umami?: unknown }).umami = { track: vi.fn() };
  });

  it('captureException forwards to Sentry with extras', async () => {
    const { captureException } = await import('~/utils/telemetry-client');
    const err = new Error('boom');
    captureException(err, { area: 'test' });
    expect(sentryCapture).toHaveBeenCalledWith(err, { extra: { area: 'test' } });
  });

  it('captureEvent forwards to umami.track', async () => {
    const { captureEvent } = await import('~/utils/telemetry-client');
    captureEvent('dice.rolled', { sides: 20 });
    const umami = (window as unknown as { umami: { track: ReturnType<typeof vi.fn> } }).umami;
    expect(umami.track).toHaveBeenCalledWith('dice.rolled', { sides: 20 });
  });

  it('captureEvent is a safe no-op when umami is absent', async () => {
    delete (window as unknown as { umami?: unknown }).umami;
    const { captureEvent } = await import('~/utils/telemetry-client');
    expect(() => captureEvent('dice.rolled')).not.toThrow();
  });
});
