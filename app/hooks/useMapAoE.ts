import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import type { MapAoEData, AoeShape } from '~/types/mapAoe';
import {
  listMapAoESchema,
  createMapAoESchema,
  removeMapAoESchema,
  clearMapAoESchema,
  updateMapAoESchema,
} from '~/types/schemas/mapAoe';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const listMapAoEFn = createServerFn({ method: 'GET' })
  .inputValidator(listMapAoESchema)
  .handler(async ({ data }) => {
    const { listMapAoE } = await import('~/server/functions/mapAoE');
    return listMapAoE({ data });
  });

const createMapAoEFn = createServerFn({ method: 'POST' })
  .inputValidator(createMapAoESchema)
  .handler(async ({ data }) => {
    const { createMapAoE } = await import('~/server/functions/mapAoE');
    return createMapAoE({ data });
  });

const removeMapAoEFn = createServerFn({ method: 'POST' })
  .inputValidator(removeMapAoESchema)
  .handler(async ({ data }) => {
    const { removeMapAoE } = await import('~/server/functions/mapAoE');
    return removeMapAoE({ data });
  });

const clearMapAoEFn = createServerFn({ method: 'POST' })
  .inputValidator(clearMapAoESchema)
  .handler(async ({ data }) => {
    const { clearMapAoE } = await import('~/server/functions/mapAoE');
    return clearMapAoE({ data });
  });

const moveMapAoEFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMapAoESchema)
  .handler(async ({ data }) => {
    const { moveMapAoE } = await import('~/server/functions/mapAoE');
    return moveMapAoE({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useMapAoE(campaignId: string | null | undefined, mapId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.mapAoe.list(campaignId ?? '', mapId ?? ''),
    enabled: Boolean(campaignId && mapId),
    queryFn: async (): Promise<MapAoEData[]> => {
      const res = await listMapAoEFn({ data: { campaignId: campaignId!, mapId: mapId! } });
      return res.aoes;
    },
  });
}

export function useMapAoEMutations(campaignId: string, mapId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.mapAoe.list(campaignId, mapId) });

  const create = useMutation({
    mutationFn: async (input: {
      shape: AoeShape;
      originX: number;
      originY: number;
      sizePx: number;
      widthPx?: number;
      rotation: number;
      color: string;
      label?: string;
    }) => {
      return await createMapAoEFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapAoEMutations.create' }),
  });

  const remove = useMutation({
    mutationFn: async (aoeId: string) => {
      return await removeMapAoEFn({ data: { campaignId, mapId, id: aoeId } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapAoEMutations.remove' }),
  });

  const clear = useMutation({
    mutationFn: async () => {
      return await clearMapAoEFn({ data: { campaignId, mapId } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapAoEMutations.clear' }),
  });

  const move = useMutation({
    mutationFn: async (input: { aoeId: string; originX: number; originY: number }) => {
      return await moveMapAoEFn({
        data: {
          campaignId,
          mapId,
          id: input.aoeId,
          originX: input.originX,
          originY: input.originY,
        },
      });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapAoEMutations.move' }),
  });

  return { create, remove, clear, move };
}

// ---------------------------------------------------------------------------
// Cache helpers — used for optimistic + realtime (party) updates.
// ---------------------------------------------------------------------------

export function applyAoeAddToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  aoe: MapAoEData
) {
  qc.setQueryData<MapAoEData[]>(queryKeys.mapAoe.list(campaignId, mapId), (prev) => {
    if (!prev) return [aoe];
    if (prev.some((a) => a.id === aoe.id)) return prev;
    return [...prev, aoe];
  });
}

export function applyAoeRemoveFromCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  aoeId: string
) {
  qc.setQueryData<MapAoEData[]>(queryKeys.mapAoe.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.filter((a) => a.id !== aoeId);
  });
}

export function applyAoeClearToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string
) {
  qc.setQueryData<MapAoEData[]>(queryKeys.mapAoe.list(campaignId, mapId), () => []);
}

export function applyAoeMoveToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  aoeId: string,
  originX: number,
  originY: number
) {
  qc.setQueryData<MapAoEData[]>(queryKeys.mapAoe.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.map((a) => (a.id === aoeId ? { ...a, originX, originY } : a));
  });
}
