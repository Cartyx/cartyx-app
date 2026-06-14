import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import type { MapTextData } from '~/types/mapText';
import {
  listMapTextsSchema,
  createMapTextSchema,
  updateMapTextSchema,
  deleteMapTextSchema,
} from '~/types/schemas/mapTexts';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const listMapTextsFn = createServerFn({ method: 'GET' })
  .inputValidator(listMapTextsSchema)
  .handler(async ({ data }) => {
    const { listMapTexts } = await import('~/server/functions/mapTexts');
    return listMapTexts({ data });
  });

const createMapTextFn = createServerFn({ method: 'POST' })
  .inputValidator(createMapTextSchema)
  .handler(async ({ data }) => {
    const { createMapText } = await import('~/server/functions/mapTexts');
    return createMapText({ data });
  });

const updateMapTextFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMapTextSchema)
  .handler(async ({ data }) => {
    const { updateMapText } = await import('~/server/functions/mapTexts');
    return updateMapText({ data });
  });

const deleteMapTextFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteMapTextSchema)
  .handler(async ({ data }) => {
    const { deleteMapText } = await import('~/server/functions/mapTexts');
    return deleteMapText({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useMapTexts(
  campaignId: string | null | undefined,
  mapId: string | null | undefined
) {
  return useQuery({
    queryKey: queryKeys.mapTexts.list(campaignId ?? '', mapId ?? ''),
    enabled: Boolean(campaignId && mapId),
    queryFn: async (): Promise<MapTextData[]> => {
      const res = await listMapTextsFn({ data: { campaignId: campaignId!, mapId: mapId! } });
      return res.texts;
    },
  });
}

export function useMapTextMutations(campaignId: string, mapId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.mapTexts.list(campaignId, mapId) });

  const create = useMutation({
    mutationFn: async (input: {
      x: number;
      y: number;
      text: string;
      color: string;
      fontSize: number;
    }) => {
      return await createMapTextFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapTextMutations.create' }),
  });

  const update = useMutation({
    mutationFn: async (input: {
      textId: string;
      x?: number;
      y?: number;
      text?: string;
      color?: string;
      fontSize?: number;
    }) => {
      return await updateMapTextFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapTextMutations.update' }),
  });

  const remove = useMutation({
    mutationFn: async (textId: string) => {
      return await deleteMapTextFn({ data: { campaignId, mapId, textId } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapTextMutations.remove' }),
  });

  return { create, update, remove };
}

// ---------------------------------------------------------------------------
// Cache helpers — used for optimistic + realtime (party) updates.
// ---------------------------------------------------------------------------

export function applyTextAddToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  text: MapTextData
) {
  qc.setQueryData<MapTextData[]>(queryKeys.mapTexts.list(campaignId, mapId), (prev) => {
    if (!prev) return [text];
    if (prev.some((t) => t.id === text.id)) return prev;
    return [...prev, text];
  });
}

export function applyTextRemoveFromCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  textId: string
) {
  qc.setQueryData<MapTextData[]>(queryKeys.mapTexts.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.filter((t) => t.id !== textId);
  });
}

export function applyTextMoveToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  textId: string,
  x: number,
  y: number
) {
  qc.setQueryData<MapTextData[]>(queryKeys.mapTexts.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.map((t) => (t.id === textId ? { ...t, x, y } : t));
  });
}

export function applyTextUpdateToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  text: MapTextData
) {
  qc.setQueryData<MapTextData[]>(queryKeys.mapTexts.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.map((t) => (t.id === text.id ? text : t));
  });
}
