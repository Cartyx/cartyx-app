import { createServerFn } from '@tanstack/react-start';
import type { TabletopScreenData, TabletopScreenDetailData } from '~/types/tabletop';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listTabletopScreensSchema,
  getTabletopScreenSchema,
  createTabletopScreenSchema,
  renameTabletopScreenSchema,
  deleteTabletopScreenSchema,
  updateTabletopScreenSettingsSchema,
  openTabletopWindowSchema,
  closeTabletopWindowSchema,
} from '~/types/schemas/tabletop';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listScreensFn = createServerFn({ method: 'GET' })
  .inputValidator(listTabletopScreensSchema)
  .handler(async ({ data }) => {
    const { listTabletopScreens } = await import('~/server/functions/tabletop');
    return listTabletopScreens({ data });
  });

const getScreenFn = createServerFn({ method: 'GET' })
  .inputValidator(getTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { getTabletopScreen } = await import('~/server/functions/tabletop');
    return getTabletopScreen({ data });
  });

const createScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(createTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { createTabletopScreen } = await import('~/server/functions/tabletop');
    return createTabletopScreen({ data });
  });

const renameScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(renameTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { renameTabletopScreen } = await import('~/server/functions/tabletop');
    return renameTabletopScreen({ data });
  });

const deleteScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteTabletopScreenSchema)
  .handler(async ({ data }) => {
    const { deleteTabletopScreen } = await import('~/server/functions/tabletop');
    return deleteTabletopScreen({ data });
  });

const updateSettingsFn = createServerFn({ method: 'POST' })
  .inputValidator(updateTabletopScreenSettingsSchema)
  .handler(async ({ data }) => {
    const { updateTabletopScreenSettings } = await import('~/server/functions/tabletop');
    return updateTabletopScreenSettings({ data });
  });

const openWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(openTabletopWindowSchema)
  .handler(async ({ data }) => {
    const { openTabletopWindow } = await import('~/server/functions/tabletop');
    return openTabletopWindow({ data });
  });

const closeWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(closeTabletopWindowSchema)
  .handler(async ({ data }) => {
    const { closeTabletopWindow } = await import('~/server/functions/tabletop');
    return closeTabletopWindow({ data });
  });

// ---------------------------------------------------------------------------
// List screens for a campaign
// ---------------------------------------------------------------------------

export function useTabletopScreenList(campaignId: string) {
  const {
    data: screens = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.tabletop.list(campaignId),
    queryFn: () => listScreensFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });
  return {
    screens,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

// ---------------------------------------------------------------------------
// Get a single screen with hydrated detail
// ---------------------------------------------------------------------------

export function useTabletopScreenDetail(campaignId: string, screenId: string | null) {
  const {
    data: screen = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.tabletop.detail(campaignId, screenId ?? ''),
    queryFn: () => getScreenFn({ data: { id: screenId!, campaignId } }),
    enabled: !!campaignId && !!screenId,
  });
  return {
    screen,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useTabletopMutations(campaignId: string) {
  const queryClient = useQueryClient();

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.list(campaignId) });

  const invalidateDetail = (screenId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.detail(campaignId, screenId) });

  // --- Screen CRUD ---

  const createScreenMutation = useMutation({
    mutationFn: (name: string) => createScreenFn({ data: { campaignId, name } }),
    // List invalidation is deferred to the caller so it can set selection first
    onError: (e) => {
      captureException(e, { action: 'createTabletopScreen' });
    },
  });

  const renameScreenMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameScreenFn({ data: { id, campaignId, name } }),
    onSuccess: () => {
      invalidateList();
    },
    onError: (e) => {
      captureException(e, { action: 'renameTabletopScreen' });
    },
  });

  const deleteScreenMutation = useMutation({
    mutationFn: (id: string) => deleteScreenFn({ data: { id, campaignId } }),
    // List invalidation is deferred to the caller so it can set selection first
    onError: (e) => {
      captureException(e, { action: 'deleteTabletopScreen' });
    },
  });

  // --- Settings ---

  const updateSettingsMutation = useMutation({
    mutationFn: (params: {
      id: string;
      gridStyle?: 'dark' | 'parchment' | 'hex' | 'whiteboard';
      gridSize?: number;
      gridVisible?: boolean;
      gridScale?: number;
      mode?: 'grid' | 'map' | 'battlemap';
    }) => {
      const { id, ...fields } = params;
      return updateSettingsFn({ data: { id, campaignId, ...fields } });
    },
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.id);
    },
    onError: (e) => {
      captureException(e, { action: 'updateTabletopScreenSettings' });
    },
  });

  // --- Window lifecycle ---

  const openWindowMutation = useMutation({
    mutationFn: ({
      screenId,
      collection,
      documentId,
      x,
      y,
    }: {
      screenId: string;
      collection: string;
      documentId: string;
      x?: number | null;
      y?: number | null;
    }) => openWindowFn({ data: { screenId, campaignId, collection, documentId, x, y } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'openTabletopWindow' });
    },
  });

  const closeWindowMutation = useMutation({
    mutationFn: ({ screenId, windowId }: { screenId: string; windowId: string }) =>
      closeWindowFn({ data: { screenId, campaignId, windowId } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'closeTabletopWindow' });
    },
  });

  return {
    createScreen: createScreenMutation,
    renameScreen: renameScreenMutation,
    deleteScreen: deleteScreenMutation,
    updateSettings: updateSettingsMutation,
    openWindow: openWindowMutation,
    closeWindow: closeWindowMutation,
    invalidateList,
    invalidateDetail,
  };
}

export type { TabletopScreenData, TabletopScreenDetailData };
