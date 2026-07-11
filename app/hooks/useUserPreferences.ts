import { useCallback, useEffect, useRef } from 'react';
import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  setRulerColorSchema,
  DEFAULT_RULER_COLOR,
  type UserPreferences,
} from '~/types/schemas/userPreferences';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const getUserPreferencesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getUserPreferences } = await import('~/server/functions/auth');
  return getUserPreferences();
});

const setRulerColorFn = createServerFn({ method: 'POST' })
  .inputValidator(setRulerColorSchema)
  .handler(async ({ data }) => {
    const { setRulerColor } = await import('~/server/functions/auth');
    return setRulerColor({ data });
  });

const FULL_HEX = /^#[0-9a-fA-F]{6}$/;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * The current user's measurement (ruler) line color, persisted on their user
 * record. `setColor` updates the cache immediately (live preview) and persists
 * the choice to the server, debounced so dragging the native picker / typing a
 * hex value doesn't spam writes. Falls back to {@link DEFAULT_RULER_COLOR}.
 */
export function useRulerColor() {
  const queryClient = useQueryClient();

  const { data: color = DEFAULT_RULER_COLOR } = useQuery({
    queryKey: queryKeys.userPreferences.rulerColor,
    queryFn: async (): Promise<string> => {
      const prefs = (await getUserPreferencesFn()) as UserPreferences | null;
      return prefs?.rulerColor || DEFAULT_RULER_COLOR;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { mutate } = useMutation({
    mutationFn: async (next: string) => setRulerColorFn({ data: { rulerColor: next } }),
    onError: (e) => {
      captureException(e, { action: 'setRulerColor' });
      // Re-sync with the server's persisted value on failure.
      queryClient.invalidateQueries({ queryKey: queryKeys.userPreferences.rulerColor });
    },
  });

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    },
    []
  );

  const setColor = useCallback(
    (next: string) => {
      // Only act on a complete hex value — the picker fires mid-typing too.
      if (!FULL_HEX.test(next)) return;
      // Optimistic, immediate live update for the ruler overlay + the picker.
      queryClient.setQueryData(queryKeys.userPreferences.rulerColor, next);
      // Debounce the persisted write.
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => mutate(next), 300);
    },
    [queryClient, mutate]
  );

  return { color, setColor };
}
