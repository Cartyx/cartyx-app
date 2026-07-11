import type { ReactNode } from 'react';

// Re-export capture helpers so existing imports from PostHogProvider still work
export { captureException, captureEvent, capturePageView } from '~/utils/posthog-client';

/**
 * No-op passthrough since PostHog removal; Phase 5 re-points telemetry at
 * GlitchTip/Umami. The component stays so the provider tree and its imports
 * don't churn.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
