import { createServerFn } from '@tanstack/react-start';
import type { GMScreenData, GMScreenDetailData, WindowState } from '~/types/gmscreen';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listGMScreensSchema,
  getGMScreenSchema,
  createGMScreenSchema,
  renameGMScreenSchema,
  deleteGMScreenSchema,
  reorderGMScreensSchema,
  openWindowSchema,
  updateWindowSchema,
  closeWindowSchema,
  createStackSchema,
  renameStackSchema,
  moveStackSchema,
  deleteStackSchema,
  addStackItemSchema,
  removeStackItemSchema,
} from '~/types/schemas/gmscreens';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listGMScreensFn = createServerFn({ method: 'GET' })
  .inputValidator(listGMScreensSchema)
  .handler(async ({ data }) => {
    const { listGMScreens } = await import('~/server/functions/gmscreens');
    return listGMScreens({ data });
  });

const getGMScreenFn = createServerFn({ method: 'GET' })
  .inputValidator(getGMScreenSchema)
  .handler(async ({ data }) => {
    const { getGMScreen } = await import('~/server/functions/gmscreens');
    return getGMScreen({ data });
  });

const createGMScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(createGMScreenSchema)
  .handler(async ({ data }) => {
    const { createGMScreen } = await import('~/server/functions/gmscreens');
    return createGMScreen({ data });
  });

const renameGMScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(renameGMScreenSchema)
  .handler(async ({ data }) => {
    const { renameGMScreen } = await import('~/server/functions/gmscreens');
    return renameGMScreen({ data });
  });

const deleteGMScreenFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteGMScreenSchema)
  .handler(async ({ data }) => {
    const { deleteGMScreen } = await import('~/server/functions/gmscreens');
    return deleteGMScreen({ data });
  });

const reorderGMScreensFn = createServerFn({ method: 'POST' })
  .inputValidator(reorderGMScreensSchema)
  .handler(async ({ data }) => {
    const { reorderGMScreens } = await import('~/server/functions/gmscreens');
    return reorderGMScreens({ data });
  });

const openWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(openWindowSchema)
  .handler(async ({ data }) => {
    const { openWindow } = await import('~/server/functions/gmscreens');
    return openWindow({ data });
  });

const updateWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(updateWindowSchema)
  .handler(async ({ data }) => {
    const { updateWindow } = await import('~/server/functions/gmscreens');
    return updateWindow({ data });
  });

const closeWindowFn = createServerFn({ method: 'POST' })
  .inputValidator(closeWindowSchema)
  .handler(async ({ data }) => {
    const { closeWindow } = await import('~/server/functions/gmscreens');
    return closeWindow({ data });
  });

const createStackFn = createServerFn({ method: 'POST' })
  .inputValidator(createStackSchema)
  .handler(async ({ data }) => {
    const { createStack } = await import('~/server/functions/gmscreens');
    return createStack({ data });
  });

const renameStackFn = createServerFn({ method: 'POST' })
  .inputValidator(renameStackSchema)
  .handler(async ({ data }) => {
    const { renameStack } = await import('~/server/functions/gmscreens');
    return renameStack({ data });
  });

const moveStackFn = createServerFn({ method: 'POST' })
  .inputValidator(moveStackSchema)
  .handler(async ({ data }) => {
    const { moveStack } = await import('~/server/functions/gmscreens');
    return moveStack({ data });
  });

const deleteStackFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteStackSchema)
  .handler(async ({ data }) => {
    const { deleteStack } = await import('~/server/functions/gmscreens');
    return deleteStack({ data });
  });

const addStackItemFn = createServerFn({ method: 'POST' })
  .inputValidator(addStackItemSchema)
  .handler(async ({ data }) => {
    const { addStackItem } = await import('~/server/functions/gmscreens');
    return addStackItem({ data });
  });

const removeStackItemFn = createServerFn({ method: 'POST' })
  .inputValidator(removeStackItemSchema)
  .handler(async ({ data }) => {
    const { removeStackItem } = await import('~/server/functions/gmscreens');
    return removeStackItem({ data });
  });

// ---------------------------------------------------------------------------
// List screens for a campaign
// ---------------------------------------------------------------------------

export function useGMScreenList(campaignId: string) {
  const {
    data: screens = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.gmscreens.list(campaignId),
    queryFn: () => listGMScreensFn({ data: { campaignId } }),
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

export function useGMScreenDetail(campaignId: string, screenId: string | null) {
  const {
    data: screen = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.gmscreens.detail(campaignId, screenId ?? ''),
    queryFn: () => getGMScreenFn({ data: { id: screenId!, campaignId } }),
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

export function useGMScreenMutations(campaignId: string) {
  const queryClient = useQueryClient();

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.list(campaignId) });

  const invalidateDetail = (screenId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.detail(campaignId, screenId) });

  // --- Screen CRUD ---

  const createScreenMutation = useMutation({
    mutationFn: (name: string) => createGMScreenFn({ data: { campaignId, name } }),
    // List invalidation is deferred to the caller so it can set selection first
    onError: (e) => {
      captureException(e, { action: 'createGMScreen' });
    },
  });

  const renameScreenMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameGMScreenFn({ data: { id, campaignId, name } }),
    onSuccess: () => {
      invalidateList();
    },
    onError: (e) => {
      captureException(e, { action: 'renameGMScreen' });
    },
  });

  const deleteScreenMutation = useMutation({
    mutationFn: (id: string) => deleteGMScreenFn({ data: { id, campaignId } }),
    // List invalidation is deferred to the caller so it can set selection first
    onError: (e) => {
      captureException(e, { action: 'deleteGMScreen' });
    },
  });

  const reorderScreensMutation = useMutation({
    mutationFn: (screenIds: string[]) => reorderGMScreensFn({ data: { campaignId, screenIds } }),
    onSuccess: () => {
      invalidateList();
    },
    onError: (e) => {
      captureException(e, { action: 'reorderGMScreens' });
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
      captureException(e, { action: 'openWindow' });
    },
  });

  const updateWindowMutation = useMutation({
    mutationFn: (params: {
      screenId: string;
      windowId: string;
      x?: number | null;
      y?: number | null;
      width?: number | null;
      height?: number | null;
      zIndex?: number;
      state?: WindowState;
    }) => {
      const { screenId, windowId, ...fields } = params;
      return updateWindowFn({ data: { screenId, campaignId, windowId, ...fields } });
    },
    // Don't invalidate on every drag/resize — handled via debounce
    onError: (e, vars) => {
      captureException(e, {
        action: 'updateWindow',
        screenId: vars.screenId,
        windowId: vars.windowId,
      });
    },
  });

  const closeWindowMutation = useMutation({
    mutationFn: ({ screenId, windowId }: { screenId: string; windowId: string }) =>
      closeWindowFn({ data: { screenId, campaignId, windowId } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'closeWindow' });
    },
  });

  // --- Stack lifecycle ---

  const createStackMutation = useMutation({
    mutationFn: ({ screenId, name }: { screenId: string; name: string }) =>
      createStackFn({ data: { screenId, campaignId, name } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'createStack' });
    },
  });

  const renameStackMutation = useMutation({
    mutationFn: ({
      screenId,
      stackId,
      name,
    }: {
      screenId: string;
      stackId: string;
      name: string;
    }) => renameStackFn({ data: { screenId, campaignId, stackId, name } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'renameStack' });
    },
  });

  const moveStackMutation = useMutation({
    mutationFn: ({
      screenId,
      stackId,
      x,
      y,
    }: {
      screenId: string;
      stackId: string;
      x: number;
      y: number;
    }) => moveStackFn({ data: { screenId, campaignId, stackId, x, y } }),
    // Don't invalidate on every move — handled via debounce
    onError: (e, vars) => {
      captureException(e, { action: 'moveStack', screenId: vars.screenId, stackId: vars.stackId });
    },
  });

  const deleteStackMutation = useMutation({
    mutationFn: ({ screenId, stackId }: { screenId: string; stackId: string }) =>
      deleteStackFn({ data: { screenId, campaignId, stackId } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'deleteStack' });
    },
  });

  const addStackItemMutation = useMutation({
    mutationFn: (params: {
      screenId: string;
      stackId: string;
      collection: string;
      documentId: string;
      label: string;
    }) =>
      addStackItemFn({
        data: {
          screenId: params.screenId,
          campaignId,
          stackId: params.stackId,
          collection: params.collection,
          documentId: params.documentId,
          label: params.label,
        },
      }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'addStackItem' });
    },
  });

  const removeStackItemMutation = useMutation({
    mutationFn: ({
      screenId,
      stackId,
      itemId,
    }: {
      screenId: string;
      stackId: string;
      itemId: string;
    }) => removeStackItemFn({ data: { screenId, campaignId, stackId, itemId } }),
    onSuccess: (_data, vars) => {
      invalidateDetail(vars.screenId);
    },
    onError: (e) => {
      captureException(e, { action: 'removeStackItem' });
    },
  });

  return {
    createScreen: createScreenMutation,
    renameScreen: renameScreenMutation,
    deleteScreen: deleteScreenMutation,
    reorderScreens: reorderScreensMutation,
    openWindow: openWindowMutation,
    updateWindow: updateWindowMutation,
    closeWindow: closeWindowMutation,
    createStack: createStackMutation,
    renameStack: renameStackMutation,
    moveStack: moveStackMutation,
    deleteStack: deleteStackMutation,
    addStackItem: addStackItemMutation,
    removeStackItem: removeStackItemMutation,
    invalidateList,
    invalidateDetail,
  };
}

export type { GMScreenData, GMScreenDetailData };
