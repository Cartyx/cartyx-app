import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/utils/posthog-client', () => ({
  captureException: vi.fn(),
  captureEvent: vi.fn(),
}));

const { mockIsBackendDown, mockWhenBackendUp } = vi.hoisted(() => ({
  mockIsBackendDown: vi.fn(() => false),
  mockWhenBackendUp: vi.fn(() => Promise.resolve()),
}));

vi.mock('~/utils/backend-health', () => ({
  isBackendDown: mockIsBackendDown,
  whenBackendUp: mockWhenBackendUp,
}));

import { withRetry } from '~/utils/retryMutation';
import type { RetryContext } from '~/utils/retryMutation';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockIsBackendDown.mockReturnValue(false);
  mockWhenBackendUp.mockReturnValue(Promise.resolve());
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor = 1.0 exactly
});

afterEach(() => {
  vi.useRealTimers();
});

const ctx: RetryContext = {
  sessionId: 'sess-1',
  campaignId: 'camp-1',
  messageType: 'CHAT',
  messageId: 'uuid-1',
};

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, ctx);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');

    const promise = withRetry(fn, ctx);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns null and calls onExhausted after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const onExhausted = vi.fn();

    const promise = withRetry(fn, ctx, onExhausted);

    // Delays: 1,2,4,8,16,30,30,30,30,30,30,30 (s) — 12 retries after the initial attempt
    for (const delaySec of [1, 2, 4, 8, 16, 30, 30, 30, 30, 30, 30, 30]) {
      await vi.advanceTimersByTimeAsync(delaySec * 1_000);
    }

    const result = await promise;

    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(13);
    expect(onExhausted).toHaveBeenCalledWith(ctx, expect.any(Error));
  });
});

describe('withRetry backoff', () => {
  it('uses exponential backoff between attempts (1s, 2s, 4s with jitter pinned to 1.0)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const promise = withRetry(fn, ctx);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fn).toHaveBeenCalledTimes(4);
    await expect(promise).resolves.toBe('ok');
  });

  it('caps the backoff at 30s', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    void withRetry(fn, ctx);
    // Attempts 1..12 fail; delays: 1,2,4,8,16,30,30,30,30,30,30,30 (s)
    await vi.advanceTimersByTimeAsync(0);
    for (const delaySec of [1, 2, 4, 8, 16, 30, 30, 30, 30, 30, 30, 30]) {
      await vi.advanceTimersByTimeAsync(delaySec * 1_000);
    }
    expect(fn).toHaveBeenCalledTimes(13); // initial + 12 retries
  });

  it('applies jitter within ±20% of the base delay', async () => {
    (Math.random as ReturnType<typeof vi.fn>).mockReturnValue(0); // jitter factor = 0.8
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');
    const promise = withRetry(fn, ctx);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(799);
    expect(fn).toHaveBeenCalledTimes(1); // 800ms not yet elapsed
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(promise).resolves.toBe('ok');
  });

  it('waits for the backend to come back before attempting while the breaker is open', async () => {
    mockIsBackendDown.mockReturnValue(true);
    let releaseBackend!: () => void;
    mockWhenBackendUp.mockReturnValue(new Promise<void>((r) => (releaseBackend = r)));
    const fn = vi.fn().mockResolvedValue('ok');

    const promise = withRetry(fn, ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).not.toHaveBeenCalled();

    mockIsBackendDown.mockReturnValue(false);
    releaseBackend();
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBe('ok');
  });
});
