import { createServerFn } from '@tanstack/react-start';
import type { TabletopPlayerStateData } from '~/types/tabletop';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  getPlayerStateSchema,
  updatePlayerStateSchema,
  addPrivateWindowSchema,
  removePrivateWindowSchema,
} from '~/types/schemas/tabletop';

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

const addPrivateWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(addPrivateWindowSchema)
  .handler(async ({ data }) => {
    const { addPrivateWindow } = await import('~/server/functions/tabletop');
    return addPrivateWindow({ data });
  });

const removePrivateWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(removePrivateWindowSchema)
  .handler(async ({ data }) => {
    const { removePrivateWindow } = await import('~/server/functions/tabletop');
    return removePrivateWindow({ data });
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
      activeGMScreenId?: string | null;
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

  const addPrivateWindowMutation = useMutation({
    mutationFn: (params: {
      surface: 'tabletop' | 'gmscreen';
      screenId: string;
      collection: string;
      documentId: string;
      x?: number;
      y?: number;
    }) => addPrivateWindowFn({ data: { campaignId, ...params } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.playerState(campaignId) });
    },
    onError: (e) => {
      captureException(e, { action: 'addPrivateWindow' });
    },
  });

  const removePrivateWindowMutation = useMutation({
    mutationFn: (params: { privateWindowId: string }) =>
      removePrivateWindowFn({ data: { campaignId, ...params } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.playerState(campaignId) });
    },
    onError: (e) => {
      captureException(e, { action: 'removePrivateWindow' });
    },
  });

  return {
    playerState,
    isLoading,
    updateState: updateStateMutation,
    addPrivateWindow: addPrivateWindowMutation,
    removePrivateWindow: removePrivateWindowMutation,
  };
}

export type { TabletopPlayerStateData };
