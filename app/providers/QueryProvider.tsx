import { useState } from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { isInfrastructureFailure } from '~/utils/error-classification';
import { reportBackendFailure, reportBackendSuccess } from '~/utils/backend-health';

function createQueryClient() {
  return new QueryClient({
    // Feed the circuit breaker from every query/mutation outcome. On the
    // server, backend-health is a no-op, so this is SSR-safe.
    queryCache: new QueryCache({
      onError: (error) => reportBackendFailure(error),
      onSuccess: () => reportBackendSuccess(),
    }),
    mutationCache: new MutationCache({
      onError: (error) => reportBackendFailure(error),
      onSuccess: () => reportBackendSuccess(),
    }),
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: true,
        // Only infrastructure failures can heal on retry; application errors
        // (validation, not-found, auth) never do.
        retry: (failureCount, error) => failureCount < 1 && isInfrastructureFailure(error),
      },
    },
  });
}

/** Get a fresh QueryClient for route loaders (SSR-safe, not shared across requests) */
let browserQueryClient: QueryClient | null = null;
export function getQueryClient() {
  // On the server, always create a new client (no cross-request leakage)
  if (typeof window === 'undefined') return createQueryClient();
  // In the browser, reuse a single instance
  if (!browserQueryClient) browserQueryClient = createQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => getQueryClient());

  return (
    <QueryClientProvider client={client}>
      {children}
      {import.meta.env.DEV && <ReactQueryDevtoolsLazy />}
    </QueryClientProvider>
  );
}

// Lazy-load devtools so they're tree-shaken from production builds
import { lazy, Suspense } from 'react';
const ReactQueryDevtoolsLazyComponent = lazy(() =>
  import('@tanstack/react-query-devtools').then((mod) => ({ default: mod.ReactQueryDevtools }))
);
function ReactQueryDevtoolsLazy() {
  return (
    <Suspense fallback={null}>
      <ReactQueryDevtoolsLazyComponent initialIsOpen={false} />
    </Suspense>
  );
}
