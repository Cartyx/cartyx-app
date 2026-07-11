/**
 * No-op since PostHog removal; Phase 5 re-points these at GlitchTip/Umami.
 *
 * The exported API (and every call site) is intentionally preserved so the
 * replacement telemetry stack can drop in without touching callers.
 */
export async function serverCaptureException(
  _error: unknown,
  _distinctId?: string,
  _properties?: Record<string, unknown>
): Promise<void> {
  // no-op
}

export async function serverCaptureEvent(
  _distinctId: string,
  _event: string,
  _properties?: Record<string, unknown>
): Promise<void> {
  // no-op
}

export async function shutdownPostHog(): Promise<void> {
  // no-op
}
