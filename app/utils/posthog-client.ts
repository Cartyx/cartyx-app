/**
 * Client-side PostHog capture helpers.
 *
 * Extracted from PostHogProvider to avoid circular dependencies
 * (PostHogProvider imports AuthProvider; other providers/hooks
 * need to call captureException without importing PostHogProvider).
 *
 * PostHogProvider calls `setPostHogInstance` once initialised;
 * all capture helpers are safe to call before that (they no-op).
 */
import type { CaptureResult } from 'posthog-js';
import { createExceptionThrottle } from '~/utils/exception-throttle';

let posthogInstance: typeof import('posthog-js').default | null = null;
let initialized = false;

export function setPostHogInstance(instance: typeof import('posthog-js').default): void {
  posthogInstance = instance;
  initialized = true;
}

export function isPostHogReady(): boolean {
  return initialized && posthogInstance !== null;
}

export function getPostHogInstance(): typeof import('posthog-js').default | null {
  return posthogInstance;
}

export function capturePageView(url: string): void {
  if (initialized && posthogInstance) posthogInstance.capture('$pageview', { $current_url: url });
}

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function getClientEnvironment(currentUrl: string = window.location.href): string {
  try {
    const url = new URL(currentUrl, window.location.origin);
    const { hostname } = url;

    if (hostnameMatches(hostname, 'dev.cartyx.io')) return 'staging';
    if (hostnameMatches(hostname, 'cartyx.io')) return 'production';
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'development';
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Exception throttling lives in the posthog-js `before_send` pipeline hook so
// it gates every $exception event — both manual captureException calls and
// posthog-js exception autocapture (capture_exceptions: true), which bypasses
// the wrapper below. See ~/utils/exception-throttle for the semantics.
// ---------------------------------------------------------------------------
const exceptionThrottle = createExceptionThrottle();

function exceptionEventKey(event: CaptureResult): string | null {
  const props = event.properties ?? {};
  const first = Array.isArray(props.$exception_list) ? props.$exception_list[0] : undefined;
  const type = first?.type ?? props.$exception_type;
  const message = first?.value ?? props.$exception_message;
  if (type == null && message == null) return null;
  return `${type ?? 'Error'}:${message ?? ''}`.slice(0, 200);
}

export function throttleExceptionEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== '$exception') return event;

  const key = exceptionEventKey(event);
  if (key === null) return event; // fail open: never lose an event we can't identify

  const decision = exceptionThrottle.check(key, Date.now());
  if (!decision.capture) return null;

  event.properties = {
    ...event.properties,
    recurrence_count: decision.occurrences,
    ...(decision.capped && { exception_throttle_capped: true }),
  };
  return event;
}

export function captureException(
  error: unknown,
  additionalProperties?: Record<string, unknown>
): void {
  if (!initialized || !posthogInstance) return;
  posthogInstance.captureException(error instanceof Error ? error : new Error(String(error)), {
    environment: getClientEnvironment(),
    ...additionalProperties,
  });
}

export function captureEvent(event: string, properties?: Record<string, unknown>): void {
  if (!initialized || !posthogInstance) return;
  posthogInstance.capture(event, {
    environment: getClientEnvironment(),
    ...properties,
  });
}
