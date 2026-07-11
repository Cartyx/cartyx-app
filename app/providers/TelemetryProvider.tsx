import { useEffect, type ReactNode } from 'react';
import { initTelemetry } from '~/utils/telemetry-client';

// Re-export capture helpers so existing imports from TelemetryProvider still work
export { captureException, captureEvent, capturePageView } from '~/utils/telemetry-client';

export function TelemetryProvider({ children }: { children: ReactNode }) {
  useEffect(() => initTelemetry(), []);
  return <>{children}</>;
}
