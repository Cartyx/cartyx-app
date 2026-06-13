import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The posthog.ts module statically imports `posthog-node`.
// We mock `posthog-node` here so that all imports of `~/server/utils/posthog` use the mocked client.
const mockCapture = vi.fn().mockResolvedValue(undefined);
const mockShutdown = vi.fn().mockResolvedValue(undefined);

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function (this: Record<string, unknown>) {
    this.captureImmediate = mockCapture;
    this.shutdown = mockShutdown;
  }),
}));

describe('server posthog utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCapture.mockClear();
    mockShutdown.mockClear();
  });

  afterEach(() => {
    delete process.env.POSTHOG_KEY;
  });

  describe('serverCaptureException', () => {
    it('captures an Error with stack trace', async () => {
      process.env.POSTHOG_KEY = 'test-key';
      // Re-import after setting env so lazy init picks it up
      const { serverCaptureException } = await import('~/server/utils/posthog');
      const err = new Error('test error');
      await serverCaptureException(err, 'user_123', { action: 'test' });

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: 'user_123',
        event: '$exception',
        properties: expect.objectContaining({
          $exception_message: 'test error',
          $exception_type: 'Error',
          $exception_stack_trace_raw: expect.any(String),
          action: 'test',
        }),
      });
    });

    it('uses "server" as default distinctId', async () => {
      process.env.POSTHOG_KEY = 'test-key';
      const { serverCaptureException } = await import('~/server/utils/posthog');
      await serverCaptureException(new Error('oops'));

      expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: 'server' }));
    });

    it('converts non-Error values to Error', async () => {
      process.env.POSTHOG_KEY = 'test-key';
      const { serverCaptureException } = await import('~/server/utils/posthog');
      await serverCaptureException('string error');

      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            $exception_message: 'string error',
          }),
        })
      );
    });
  });

  describe('serverCaptureEvent', () => {
    it('captures a custom event', async () => {
      process.env.POSTHOG_KEY = 'test-key';
      const { serverCaptureEvent } = await import('~/server/utils/posthog');
      await serverCaptureEvent('user_123', 'campaign_created', { name: 'Test' });

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: 'user_123',
        event: 'campaign_created',
        properties: expect.objectContaining({ name: 'Test', environment: expect.any(String) }),
      });
    });
  });

  describe('no-op without API key', () => {
    it('does nothing when POSTHOG_KEY is not set', async () => {
      delete process.env.POSTHOG_KEY;
      const { serverCaptureException } = await import('~/server/utils/posthog');
      await serverCaptureException(new Error('should be ignored'));

      expect(mockCapture).not.toHaveBeenCalled();
    });
  });

  describe('shutdownPostHog', () => {
    it('calls shutdown on the client', async () => {
      process.env.POSTHOG_KEY = 'test-key';
      const { serverCaptureException, shutdownPostHog } = await import('~/server/utils/posthog');
      // Initialize the client first
      await serverCaptureException(new Error('init'));
      await shutdownPostHog();

      expect(mockShutdown).toHaveBeenCalled();
    });
  });
});
