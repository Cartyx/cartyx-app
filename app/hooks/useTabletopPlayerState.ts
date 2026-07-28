import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import type { TabletopPlayerStateData } from '~/types/tabletop';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  getPlayerStateSchema,
  updatePlayerStateSchema,
  addPrivateWindowSchema,
  removePrivateWindowSchema,
  updatePrivateWindowSchema,
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

const updatePrivateWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePrivateWindowSchema)
  .handler(async ({ data }) => {
    const { updatePrivateWindow } = await import('~/server/functions/tabletop');
    return updatePrivateWindow({ data });
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
    // `collection` is the schema's enum, not a bare string, so a typo is a
    // compile error here rather than a Zod rejection at the server boundary.
    mutationFn: (params: Omit<z.infer<typeof addPrivateWindowSchema>, 'campaignId'>) =>
      addPrivateWindowFn({ data: { campaignId, ...params } }),
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

  // Layout-only. Deliberately does NOT invalidate the player-state query on
  // success: this fires from drag/resize, and a refetch mid-gesture would snap
  // the window back to the server's copy. Local state is already the source of
  // truth for geometry; the next natural refetch reconciles.
  const updatePrivateWindowMutation = useMutation({
    mutationFn: (params: Omit<z.infer<typeof updatePrivateWindowSchema>, 'campaignId'>) =>
      updatePrivateWindowFn({ data: { campaignId, ...params } }),
    onError: (e) => {
      captureException(e, { action: 'updatePrivateWindow' });
    },
  });

  return {
    playerState,
    isLoading,
    updateState: updateStateMutation,
    addPrivateWindow: addPrivateWindowMutation,
    removePrivateWindow: removePrivateWindowMutation,
    updatePrivateWindow: updatePrivateWindowMutation,
  };
}

export type { TabletopPlayerStateData };
