import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import type { MapDrawingData, MapDrawingKind } from '~/types/mapDrawing';
import {
  listMapDrawingsSchema,
  createMapDrawingSchema,
  updateMapDrawingSchema,
  deleteMapDrawingSchema,
  clearMapDrawingsSchema,
} from '~/types/schemas/mapDrawings';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const listMapDrawingsFn = createServerFn({ method: 'GET' })
  .inputValidator(listMapDrawingsSchema)
  .handler(async ({ data }) => {
    const { listMapDrawings } = await import('~/server/functions/mapDrawings');
    return listMapDrawings({ data });
  });

const createMapDrawingFn = createServerFn({ method: 'POST' })
  .inputValidator(createMapDrawingSchema)
  .handler(async ({ data }) => {
    const { createMapDrawing } = await import('~/server/functions/mapDrawings');
    return createMapDrawing({ data });
  });

const updateMapDrawingFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMapDrawingSchema)
  .handler(async ({ data }) => {
    const { updateMapDrawing } = await import('~/server/functions/mapDrawings');
    return updateMapDrawing({ data });
  });

const deleteMapDrawingFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteMapDrawingSchema)
  .handler(async ({ data }) => {
    const { deleteMapDrawing } = await import('~/server/functions/mapDrawings');
    return deleteMapDrawing({ data });
  });

const clearMapDrawingsFn = createServerFn({ method: 'POST' })
  .inputValidator(clearMapDrawingsSchema)
  .handler(async ({ data }) => {
    const { clearMapDrawings } = await import('~/server/functions/mapDrawings');
    return clearMapDrawings({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useMapDrawings(
  campaignId: string | null | undefined,
  mapId: string | null | undefined
) {
  return useQuery({
    queryKey: queryKeys.mapDrawings.list(campaignId ?? '', mapId ?? ''),
    enabled: Boolean(campaignId && mapId),
    queryFn: async (): Promise<MapDrawingData[]> => {
      const res = await listMapDrawingsFn({ data: { campaignId: campaignId!, mapId: mapId! } });
      return res.drawings;
    },
  });
}

export interface CreateDrawingInput {
  kind: MapDrawingKind;
  color: string;
  strokeWidth: number;
  filled: boolean;
  points?: number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface UpdateDrawingInput {
  drawingId: string;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
  points?: number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export function useMapDrawingMutations(campaignId: string, mapId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.mapDrawings.list(campaignId, mapId) });

  const create = useMutation({
    mutationFn: async (input: CreateDrawingInput) => {
      return await createMapDrawingFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapDrawingMutations.create' }),
  });

  const update = useMutation({
    mutationFn: async (input: UpdateDrawingInput) => {
      return await updateMapDrawingFn({ data: { campaignId, mapId, ...input } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapDrawingMutations.update' }),
  });

  const remove = useMutation({
    mutationFn: async (drawingId: string) => {
      return await deleteMapDrawingFn({ data: { campaignId, mapId, drawingId } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapDrawingMutations.remove' }),
  });

  const clear = useMutation({
    mutationFn: async () => {
      return await clearMapDrawingsFn({ data: { campaignId, mapId } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMapDrawingMutations.clear' }),
  });

  return { create, update, remove, clear };
}

// ---------------------------------------------------------------------------
// Cache helpers — used for optimistic + realtime (party) updates.
// ---------------------------------------------------------------------------

export function applyDrawingAddToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  drawing: MapDrawingData
) {
  qc.setQueryData<MapDrawingData[]>(queryKeys.mapDrawings.list(campaignId, mapId), (prev) => {
    if (!prev) return [drawing];
    if (prev.some((d) => d.id === drawing.id)) return prev;
    return [...prev, drawing];
  });
}

export function applyDrawingUpdateToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  drawing: MapDrawingData
) {
  qc.setQueryData<MapDrawingData[]>(queryKeys.mapDrawings.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.map((d) => (d.id === drawing.id ? drawing : d));
  });
}

export function applyDrawingRemoveFromCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  drawingId: string
) {
  qc.setQueryData<MapDrawingData[]>(queryKeys.mapDrawings.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.filter((d) => d.id !== drawingId);
  });
}

export function applyDrawingsClearToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string
) {
  qc.setQueryData<MapDrawingData[]>(queryKeys.mapDrawings.list(campaignId, mapId), () => []);
}
