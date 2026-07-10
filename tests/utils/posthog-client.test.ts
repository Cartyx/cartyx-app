import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setPostHogInstance,
  captureException,
  throttleExceptionEvent,
  getClientEnvironment,
} from '~/utils/posthog-client';

// Throttling lives in the before_send hook (throttleExceptionEvent) so it also
// covers posthog-js exception autocapture; the captureException wrapper itself
// forwards every call. Unique error messages per test keep the module-level
// throttle state from leaking between cases.
const captureExceptionSpy = vi.fn();

const stub = { captureException: captureExceptionSpy } as any;

function exceptionEvent(type: string, value: string, extra?: Record<string, unknown>) {
  return {
    event: '$exception',
    properties: { $exception_list: [{ type, value }], ...extra },
  } as any;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  captureExceptionSpy.mockClear();
  setPostHogInstance(stub);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('captureException wrapper', () => {
  it('forwards every call with environment and additional properties', () => {
    captureException(new Error('wrapper-A'), { action: 'save' });
    captureException(new Error('wrapper-A'), { action: 'save' });
    expect(captureExceptionSpy).toHaveBeenCalledTimes(2);
    const [err, props] = captureExceptionSpy.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('wrapper-A');
    expect(props.action).toBe('save');
    expect(props.environment).toBeDefined();
  });

  it('wraps non-Error values', () => {
    captureException('wrapper-B');
    const [err] = captureExceptionSpy.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('wrapper-B');
  });
});

describe('throttleExceptionEvent (before_send hook)', () => {
  it('passes null and non-exception events through untouched', () => {
    expect(throttleExceptionEvent(null)).toBeNull();
    const pageview = { event: '$pageview', properties: {} } as any;
    expect(throttleExceptionEvent(pageview)).toBe(pageview);
  });

  it('forwards the first occurrence of an exception', () => {
    expect(throttleExceptionEvent(exceptionEvent('Error', 'hook-first'))).not.toBeNull();
  });

  it('drops rapid repeats of the same exception within the throttle window', () => {
    let forwarded = 0;
    for (let i = 0; i < 500; i++) {
      if (throttleExceptionEvent(exceptionEvent('Error', 'hook-storm'))) forwarded++;
    }
    expect(forwarded).toBe(1);
  });

  it('still reports a recurring error after an initial burst exhausts the throttle window', () => {
    // Regression for the storm scenario: >20 occurrences in the first seconds
    // must not permanently silence the error for the session.
    for (let i = 0; i < 100; i++) throttleExceptionEvent(exceptionEvent('Error', 'hook-burst'));
    vi.advanceTimersByTime(60_000);
    expect(throttleExceptionEvent(exceptionEvent('Error', 'hook-burst'))).not.toBeNull();
  });

  it('caps forwarded events per window and flags the last one', () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      results.push(throttleExceptionEvent(exceptionEvent('Error', 'hook-cap')));
      vi.advanceTimersByTime(6_000);
    }
    const forwarded = results.filter(Boolean);
    expect(forwarded).toHaveLength(20);
    expect(forwarded[19]!.properties.exception_throttle_capped).toBe(true);
  });

  it('annotates forwarded events with a recurrence count', () => {
    throttleExceptionEvent(exceptionEvent('Error', 'hook-count'));
    for (let i = 0; i < 5; i++) throttleExceptionEvent(exceptionEvent('Error', 'hook-count'));
    vi.advanceTimersByTime(6_000);
    const result = throttleExceptionEvent(exceptionEvent('Error', 'hook-count'));
    expect(result!.properties.recurrence_count).toBe(7);
  });

  it('throttles distinct exceptions independently', () => {
    expect(throttleExceptionEvent(exceptionEvent('Error', 'hook-x'))).not.toBeNull();
    expect(throttleExceptionEvent(exceptionEvent('TypeError', 'hook-x'))).not.toBeNull();
  });

  it('falls back to $exception_message when $exception_list is missing', () => {
    const legacy = {
      event: '$exception',
      properties: { $exception_type: 'Error', $exception_message: 'hook-legacy' },
    } as any;
    expect(throttleExceptionEvent(legacy)).not.toBeNull();
    expect(throttleExceptionEvent(legacy)).toBeNull();
  });

  it('fails open when no key can be derived', () => {
    const opaque = { event: '$exception', properties: {} } as any;
    expect(throttleExceptionEvent(opaque)).not.toBeNull();
    expect(throttleExceptionEvent(opaque)).not.toBeNull();
  });
});

describe('getClientEnvironment', () => {
  it.each([
    ['https://cartyx.io/campaigns', 'production'],
    ['https://www.cartyx.io/', 'production'],
    ['https://dev.cartyx.io/campaigns', 'staging'],
    ['http://localhost:3000/', 'development'],
    ['http://app.localhost:3000/', 'development'],
    ['https://cartyx-app.vercel.app/', 'unknown'],
    ['https://evil-cartyx.io.example.com/', 'unknown'],
  ])('maps %s to %s', (url, expected) => {
    expect(getClientEnvironment(url)).toBe(expected);
  });
});
