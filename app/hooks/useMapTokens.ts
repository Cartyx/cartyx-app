import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import type { MapTokenData } from '~/types/mapToken';
import type { TokenSource } from '~/types/schemas/mapTokens';
import {
  listMapTokensSchema,
  createMapTokenSchema,
  moveMapTokenSchema,
  updateMapTokenSchema,
  deleteMapTokenSchema,
} from '~/types/schemas/mapTokens';

const listMapTokensFn = createServerFn({ method: 'GET' })
  .inputValidator(listMapTokensSchema)
  .handler(async ({ data }) => {
    const { listMapTokens } = await import('~/server/functions/mapTokens');
    return listMapTokens({ data });
  });

const createMapTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(createMapTokenSchema)
  .handler(async ({ data }) => {
    const { createMapToken } = await import('~/server/functions/mapTokens');
    return createMapToken({ data });
  });

const moveMapTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(moveMapTokenSchema)
  .handler(async ({ data }) => {
    const { moveMapToken } = await import('~/server/functions/mapTokens');
    return moveMapToken({ data });
  });

const updateMapTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMapTokenSchema)
  .handler(async ({ data }) => {
    const { updateMapToken } = await import('~/server/functions/mapTokens');
    return updateMapToken({ data });
  });

const deleteMapTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteMapTokenSchema)
  .handler(async ({ data }) => {
    const { deleteMapToken } = await import('~/server/functions/mapTokens');
    return deleteMapToken({ data });
  });

export function useMapTokens(
  campaignId: string | null | undefined,
  mapId: string | null | undefined
) {
  return useQuery({
    queryKey: queryKeys.mapTokens.list(campaignId ?? '', mapId ?? ''),
    enabled: Boolean(campaignId && mapId),
    queryFn: async (): Promise<MapTokenData[]> => {
      const res = await listMapTokensFn({
        data: { campaignId: campaignId!, mapId: mapId! },
      });
      return res.tokens;
    },
  });
}

export function useMapTokenMutations(campaignId: string, mapId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.mapTokens.list(campaignId, mapId) });

  const create = useMutation({
    mutationFn: async (input: {
      sourceCollection: TokenSource;
      sourceDocumentId: string;
      x: number;
      y: number;
    }) => {
      return await createMapTokenFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapTokenMutations.create' }),
  });

  const move = useMutation({
    mutationFn: async (input: { tokenId: string; x: number; y: number }) => {
      return await moveMapTokenFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapTokenMutations.move' }),
  });

  const update = useMutation({
    mutationFn: async (
      input: Omit<Parameters<typeof updateMapTokenFn>[0]['data'], 'campaignId' | 'mapId'>
    ) => {
      return await updateMapTokenFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapTokenMutations.update' }),
  });

  const remove = useMutation({
    mutationFn: async (tokenId: string) => {
      return await deleteMapTokenFn({ data: { campaignId, mapId, tokenId } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapTokenMutations.remove' }),
  });

  return { create, move, update, remove };
}

/** Optimistic update: apply a move locally without refetching. */
export function applyTokenMoveToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  tokenId: string,
  x: number,
  y: number
) {
  qc.setQueryData<MapTokenData[]>(queryKeys.mapTokens.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.map((t) => (t.id === tokenId ? { ...t, x, y } : t));
  });
}

export function applyTokenAddToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  token: MapTokenData
) {
  qc.setQueryData<MapTokenData[]>(queryKeys.mapTokens.list(campaignId, mapId), (prev) => {
    if (!prev) return [token];
    if (prev.some((t) => t.id === token.id)) return prev;
    return [...prev, token];
  });
}

export function applyTokenRemoveFromCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  tokenId: string
) {
  qc.setQueryData<MapTokenData[]>(queryKeys.mapTokens.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.filter((t) => t.id !== tokenId);
  });
}

export function applyTokenUpdateToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  token: MapTokenData
) {
  qc.setQueryData<MapTokenData[]>(queryKeys.mapTokens.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.map((t) => (t.id === token.id ? token : t));
  });
}
