/**
 * No-op since PostHog removal; Phase 5 re-points these at GlitchTip/Umami.
 *
 * The exported API (and every call site) is intentionally preserved so the
 * replacement telemetry stack can drop in without touching callers.
 */
export function captureException(
  _error: unknown,
  _additionalProperties?: Record<string, unknown>
): void {
  // no-op
}

export function captureEvent(_event: string, _properties?: Record<string, unknown>): void {
  // no-op
}

export function capturePageView(_url: string): void {
  // no-op
}
