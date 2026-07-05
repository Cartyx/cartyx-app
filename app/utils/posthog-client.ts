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

function getClientEnvironment(currentUrl: string = window.location.href): string {
  try {
    const url = new URL(currentUrl, window.location.origin);
    const { hostname } = url;

    if (hostnameMatches(hostname, 'dev.cartyx.io')) return 'preview';
    if (hostnameMatches(hostname, 'cartyx.io')) return 'production';
    if (hostnameMatches(hostname, 'vercel.app')) return 'preview';
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'development';
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Exception capture throttling.
//
// A single recurring client error (e.g. a failing server function hit by a
// high-frequency mutation like token drag, or a refetch-on-focus loop) can
// otherwise emit tens of thousands of identical PostHog exceptions — one
// incident once produced ~183K events. We keep enough signal to diagnose
// (first hit + periodic repeats + a recurrence count) while hard-capping the
// volume per unique error per page session.
// ---------------------------------------------------------------------------
const EXCEPTION_THROTTLE_MS = 5_000;
const EXCEPTION_MAX_PER_KEY = 20;
const exceptionThrottle = new Map<string, { count: number; lastCaptureMs: number }>();

function exceptionKey(error: Error): string {
  return `${error.name}:${error.message}`.slice(0, 200);
}

export function captureException(
  error: unknown,
  additionalProperties?: Record<string, unknown>
): void {
  if (!initialized || !posthogInstance) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const key = exceptionKey(err);
  const now = Date.now();
  const rec = exceptionThrottle.get(key);

  if (!rec) {
    exceptionThrottle.set(key, { count: 1, lastCaptureMs: now });
  } else {
    rec.count++;
    // Hard cap: stop reporting this error entirely once it's clearly a storm.
    if (rec.count > EXCEPTION_MAX_PER_KEY) return;
    // Otherwise drop rapid repeats, but keep counting them.
    if (now - rec.lastCaptureMs < EXCEPTION_THROTTLE_MS) return;
    rec.lastCaptureMs = now;
  }

  posthogInstance.captureException(err, {
    environment: getClientEnvironment(),
    recurrence_count: exceptionThrottle.get(key)?.count ?? 1,
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
