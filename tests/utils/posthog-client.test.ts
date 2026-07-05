import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setPostHogInstance, captureException } from '~/utils/posthog-client';

// Stub the posthog instance so we can assert how often the real (throttled)
// captureException forwards to it. Unique error messages per test keep the
// module-level throttle map from leaking between cases.
const captureExceptionSpy = vi.fn();
 
const stub = { captureException: captureExceptionSpy } as any;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  captureExceptionSpy.mockClear();
  setPostHogInstance(stub);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('captureException throttling', () => {
  it('forwards the first occurrence of an error', () => {
    captureException(new Error('first-A'));
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
  });

  it('drops rapid repeats of the same error within the throttle window', () => {
    for (let i = 0; i < 500; i++) captureException(new Error('storm-B'));
    // Only the first of the burst is forwarded.
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
  });

  it('captures again after the throttle window elapses', () => {
    captureException(new Error('window-C'));
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5001);
    captureException(new Error('window-C'));
    expect(captureExceptionSpy).toHaveBeenCalledTimes(2);
  });

  it('hard-caps a persistently recurring error at 20 captures per session', () => {
    // Advance past the throttle window each time so only the hard cap limits it.
    for (let i = 0; i < 100; i++) {
      captureException(new Error('persistent-D'));
      vi.advanceTimersByTime(6000);
    }
    expect(captureExceptionSpy).toHaveBeenCalledTimes(20);
  });

  it('throttles distinct errors independently', () => {
    captureException(new Error('distinct-E'));
    captureException(new Error('distinct-F'));
    expect(captureExceptionSpy).toHaveBeenCalledTimes(2);
  });

  it('reports a recurrence_count so recurring errors are visible', () => {
    captureException(new Error('count-G'));
    vi.advanceTimersByTime(6000);
    captureException(new Error('count-G'));
    const lastCall = captureExceptionSpy.mock.calls.at(-1)!;
    expect(lastCall[1].recurrence_count).toBeGreaterThan(1);
  });
});
