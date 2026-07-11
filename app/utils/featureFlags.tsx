// Feature flags are plain booleans baked into the client bundle from
// VITE_PUBLIC_FF_* at build time (PostHog-driven remote flags were removed
// with PostHog). Kept as hooks so call sites don't churn; `flagValue` is the
// env value itself.
function parseBooleanFlag(flagValue: string): boolean {
  return flagValue === 'true' || flagValue === '1';
}

export function useOptionalFeatureFlagEnabled(flagValue: string): boolean {
  return parseBooleanFlag(flagValue);
}

export function useOptionalFeatureFlag(flagValue: string): {
  isEnabled: boolean;
  isLoading: boolean;
} {
  return { isEnabled: parseBooleanFlag(flagValue), isLoading: false };
}
