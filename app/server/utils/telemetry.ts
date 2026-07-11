import * as Sentry from '@sentry/node';

/**
 * Telemetry wrappers: errors -> GlitchTip (Sentry protocol), events -> Umami.
 * Safe no-ops when the platform env vars are absent (local dev, CI) — same
 * DX as the PostHog era. The exported API (and every call site) is
 * intentionally preserved so this replacement telemetry stack drops in
 * without touching callers.
 */
let initialized = false;
function ensureInit(): boolean {
  const dsn = process.env.GLITCHTIP_DSN;
  if (!dsn) return false;
  if (!initialized) {
    initialized = true;
    Sentry.init({ dsn, environment: process.env.APP_ENV ?? 'development' });
  }
  return true;
}

export async function serverCaptureException(
  error: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>
): Promise<void> {
  if (!ensureInit()) return;
  Sentry.captureException(error, {
    ...(distinctId ? { user: { id: distinctId } } : {}),
    ...(properties ? { extra: properties } : {}),
  });
}

export async function serverCaptureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  const website = process.env.UMAMI_WEBSITE_ID;
  if (!website) return;
  const host = process.env.UMAMI_HOST ?? 'https://umami.cartyx.io';
  try {
    await fetch(`${host}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'cartyx-server/1.0' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website,
          hostname: 'server',
          url: '/server',
          name: event,
          data: { ...properties, distinctId },
        },
      }),
    });
  } catch {
    // fire-and-forget: telemetry must never fail the caller
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(2000);
}
