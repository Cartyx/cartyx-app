import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { extractErrorMessage } from '~/utils/errors';

/**
 * Shared scaffolding for the wiki mutation hooks (players / characters /
 * locations). These hooks all repeated the same structure:
 *
 *   - a `useMutation` whose `mutationFn` calls a server fn
 *   - `onSuccess` that invalidates/removes a set of query keys
 *   - `onError` that reports to PostHog via `captureException`
 *   - a wrapper around `mutateAsync` that returns `null` on error
 *   - a return object exposing the wrapper under a named key, plus
 *     `isLoading` (from `isPending`) and `error` (normalized message)
 *
 * The factory is intentionally thin: it preserves the exact behavior of the
 * hand-written hooks, just without the per-hook boilerplate. `onSuccess`
 * receives the live `QueryClient` so callers reproduce their existing
 * invalidate/remove logic verbatim.
 */
export interface CreateMutationHookConfig<TInput, TData, TActionKey extends string> {
  /** Name of the action function exposed on the returned object (e.g. `update`). */
  actionName: TActionKey;
  /** The mutation function — typically `(input) => someServerFn({ data: input })`. */
  mutationFn: (input: TInput) => Promise<TData>;
  /**
   * Side effects on success. Receives the live query client so callers can
   * invalidate/remove queries exactly as before. Optional — some mutations
   * (e.g. validate-only) have no success side effects.
   */
  onSuccess?: (queryClient: QueryClient, data: TData, variables: TInput) => void;
  /**
   * Builds the additional-properties context passed to `captureException` on
   * error. Receives the variables so callers can include ids, etc.
   */
  errorContext: (variables: TInput) => Record<string, unknown>;
}

export type MutationHookResult<TInput, TData, TActionKey extends string> = {
  isLoading: boolean;
  error: string | null;
} & {
  [K in TActionKey]: (input: TInput) => Promise<TData | null>;
};

export function createMutationHook<TInput, TData, TActionKey extends string>(
  config: CreateMutationHookConfig<TInput, TData, TActionKey>
): () => MutationHookResult<TInput, TData, TActionKey> {
  const { actionName, mutationFn, onSuccess, errorContext } = config;

  return function useGeneratedMutationHook(): MutationHookResult<TInput, TData, TActionKey> {
    const queryClient = useQueryClient();
    const mutation = useMutation({
      mutationFn: async (input: TInput) => mutationFn(input),
      onSuccess: (data, variables) => {
        onSuccess?.(queryClient, data, variables);
      },
      onError: (e, variables) => {
        captureException(e, errorContext(variables));
      },
    });

    const action = async (input: TInput): Promise<TData | null> => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    };

    return {
      [actionName]: action,
      isLoading: mutation.isPending,
      error: extractErrorMessage(mutation.error),
    } as MutationHookResult<TInput, TData, TActionKey>;
  };
}
