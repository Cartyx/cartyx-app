import { createServerFn } from '@tanstack/react-start';
import type { TabletopPlayerStateData } from '~/types/tabletop';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import { getPlayerStateSchema, updatePlayerStateSchema } from '~/types/schemas/tabletop';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const getStateFn = createServerFn({ method: 'GET' })
  .inputValidator(getPlayerStateSchema)
  .handler(async ({ data }) => {
    const { getPlayerState } = await import('~/server/functions/tabletop');
    return getPlayerState({ data });
  });

const updateStateFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePlayerStateSchema)
  .handler(async ({ data }) => {
    const { updatePlayerState } = await import('~/server/functions/tabletop');
    return updatePlayerState({ data });
  });

// ---------------------------------------------------------------------------
// Player state for the current user in a campaign
// ---------------------------------------------------------------------------

export function useTabletopPlayerState(campaignId: string) {
  const queryClient = useQueryClient();

  const { data: playerState = null, isLoading } = useQuery({
    queryKey: queryKeys.tabletop.playerState(campaignId),
    queryFn: () => getStateFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });

  const updateStateMutation = useMutation({
    mutationFn: (params: {
      activeScreenId?: string | null;
      viewport?: {
        screenId: string;
        zoom: number;
        panX: number;
        panY: number;
      };
      windowOverride?: {
        windowId: string;
        x: number;
        y: number;
        width: number;
        height: number;
        state: 'open' | 'minimized' | 'hidden';
      };
    }) => updateStateFn({ data: { campaignId, ...params } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.playerState(campaignId) });
    },
    onError: (e) => {
      captureException(e, { action: 'updatePlayerState' });
    },
  });

  return {
    playerState,
    isLoading,
    updateState: updateStateMutation,
  };
}

export type { TabletopPlayerStateData };
