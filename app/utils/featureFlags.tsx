import {
  useFeatureFlagEnabled as usePostHogFeatureFlagEnabled,
  useFeatureFlagPayload as usePostHogFeatureFlagPayload,
  useFeatureFlagVariantKey,
} from '@posthog/react';
import type { JsonType } from 'posthog-js';
import type { ReactNode } from 'react';

export interface FeatureFlagState<TPayload = JsonType> {
  isEnabled: boolean;
  isLoading: boolean;
  payload: TPayload | null;
  variant: string | boolean | undefined;
}

function normalizePayload<TPayload>(payload: JsonType | undefined): TPayload | null {
  return (payload ?? null) as TPayload | null;
}

export function useFeatureFlag(flag: string): FeatureFlagState {
  const isEnabled = usePostHogFeatureFlagEnabled(flag);
  const payload = usePostHogFeatureFlagPayload(flag);
  const variant = useFeatureFlagVariantKey(flag);

  return {
    isEnabled: isEnabled ?? false,
    isLoading: isEnabled === undefined,
    payload: normalizePayload(payload),
    variant,
  };
}

export function useFeatureFlagEnabled(flag: string): boolean {
  return usePostHogFeatureFlagEnabled(flag) ?? false;
}

// The optional flags are plain booleans baked into the client bundle from
// VITE_PUBLIC_FF_* at build time — no PostHog round-trip. Kept as hooks so
// call sites don't churn; `flagValue` is the env value itself.
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

export function useFeatureFlagPayload<TPayload = JsonType>(flag: string): TPayload | null {
  return normalizePayload<TPayload>(usePostHogFeatureFlagPayload(flag));
}

export function useFeatureFlagVariant(flag: string): string | boolean | undefined {
  return useFeatureFlagVariantKey(flag);
}

export function FeatureFlagGate({
  flag,
  children,
  fallback = null,
  showFallbackWhileLoading = false,
}: {
  flag: string;
  children: ReactNode;
  fallback?: ReactNode;
  showFallbackWhileLoading?: boolean;
}) {
  const { isEnabled, isLoading } = useFeatureFlag(flag);

  if (isLoading && !showFallbackWhileLoading) return null;

  return isEnabled ? <>{children}</> : <>{fallback}</>;
}
