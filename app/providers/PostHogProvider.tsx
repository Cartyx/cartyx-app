import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useAuthContext } from './AuthProvider';
import {
  getPostHogInstance,
  setPostHogInstance,
  isPostHogReady,
  capturePageView,
  throttleExceptionEvent,
} from '~/utils/posthog-client';

// Re-export capture helpers so existing imports from PostHogProvider still work
export { captureException, captureEvent, capturePageView } from '~/utils/posthog-client';

type PostHogClient = typeof import('posthog-js').default;
type PostHogProviderComponent = typeof import('@posthog/react').PostHogProvider;

export function PostHogProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext();
  const router = useRouter();
  const unsubRef = useRef<(() => void) | null>(null);
  const [client, setClient] = useState<PostHogClient | null>(() =>
    typeof window === 'undefined' ? null : getPostHogInstance()
  );
  const [ProviderComponent, setProviderComponent] = useState<PostHogProviderComponent | null>(null);

  useEffect(() => {
    const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
    const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';
    const shouldLoadProvider = isPostHogReady() || Boolean(key);
    let cancelled = false;

    if (typeof window === 'undefined') return;

    if (shouldLoadProvider) {
      void import('@posthog/react').then(({ PostHogProvider: PostHogReactProvider }) => {
        if (!cancelled) setProviderComponent(() => PostHogReactProvider);
      });
    }

    if (isPostHogReady()) {
      const existingClient = getPostHogInstance();

      if (existingClient) setClient(existingClient);

      return () => {
        cancelled = true;
      };
    }

    if (!key) {
      return () => {
        cancelled = true;
      };
    }

    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return;

      posthog.init(key, {
        api_host: host,
        capture_pageview: false, // we capture manually on navigation
        persistence: 'localStorage+cookie',
        capture_exceptions: true,
        // Gate every $exception (manual captures AND autocapture) through the
        // shared throttle so a recurring error can't storm PostHog.
        before_send: throttleExceptionEvent,
      });
      setPostHogInstance(posthog);
      setClient(posthog);
      capturePageView(window.location.href);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!client) return;

    unsubRef.current = router.subscribe('onResolved', (event) => {
      capturePageView(window.location.origin + event.toLocation.href);
    });

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [client, router]);

  useEffect(() => {
    if (!client || !isPostHogReady()) return;

    if (user) {
      client.identify(user.id, {
        name: user.name,
        email: user.email,
        provider: user.provider,
        role: user.role,
      });
      client.reloadFeatureFlags();
    } else {
      client.reset();
      client.reloadFeatureFlags();
    }
  }, [client, user]);

  if (client && ProviderComponent) {
    return <ProviderComponent client={client}>{children}</ProviderComponent>;
  }

  return <>{children}</>;
}
