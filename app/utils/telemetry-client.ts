import * as Sentry from '@sentry/browser';

/**
 * Telemetry wrappers: errors -> GlitchTip (Sentry protocol), events -> Umami.
 * All functions are safe no-ops when the platform env vars are absent
 * (local dev, CI) — same DX as the PostHog era.
 *
 * No `environment` option is passed to Sentry.init: there is no
 * client-visible APP_ENV var (grepped for VITE_PUBLIC_APP_ENV — doesn't
 * exist; see deploy/build/web-{dev,prod}.args). `import.meta.env.MODE` was
 * considered instead, but `npm run build` never passes `--mode`, so both the
 * dev.cartyx.io and app.cartyx.io images resolve MODE to 'production' —
 * using it would mislabel dev-environment errors as prod in GlitchTip, which
 * is worse than omitting. Wiring a real per-environment value is Task 12's
 * job (a new VITE_PUBLIC_APP_ENV build arg), not this task's.
 */
const dsn = import.meta.env.VITE_PUBLIC_GLITCHTIP_DSN as string | undefined;

let initialized = false;
export function initTelemetry(): void {
  if (initialized || !dsn) return;
  initialized = true;
  Sentry.init({ dsn });
}

export function captureException(
  error: unknown,
  additionalProperties?: Record<string, unknown>
): void {
  // No dsn guard here: @sentry/browser's captureException is itself a safe
  // no-op when the client was never initialized (initTelemetry gates on
  // dsn), so this call is harmless in local dev/CI even though nothing gets
  // sent — and it keeps this wrapper unconditionally testable/mockable.
  Sentry.captureException(
    error,
    additionalProperties ? { extra: additionalProperties } : undefined
  );
}

type Umami = { track: (event: string, data?: Record<string, unknown>) => void };

export function captureEvent(event: string, properties?: Record<string, unknown>): void {
  const umami = (window as Window & { umami?: Umami }).umami;
  umami?.track(event, properties);
}

export function capturePageView(_url: string): void {
  // Umami's script.js auto-tracks page views (including SPA route changes).
}
