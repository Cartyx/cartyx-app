import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { showToast } from '~/components/Toast';
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
  // Resync from the server only on error — every successful call site already
  // applies the authoritative response (or the optimistic change) to the cache
  // via the apply* helpers, so a blanket invalidate would refetch the whole list
  // mid-drag and race the optimistic geometry writes.
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.mapDrawings.list(campaignId, mapId) });
  const onError = (action: string, userMessage: string) => (e: unknown) => {
    captureException(e, { action });
    showToast(userMessage, 'error');
    invalidate();
  };

  const create = useMutation({
    mutationFn: async (input: CreateDrawingInput) => {
      return await createMapDrawingFn({ data: { campaignId, mapId, ...input } });
    },
    onError: onError(
      'useMapDrawingMutations.create',
      'Couldn’t save the drawing. Please try again.'
    ),
  });

  const update = useMutation({
    mutationFn: async (input: UpdateDrawingInput) => {
      return await updateMapDrawingFn({ data: { campaignId, mapId, ...input } });
    },
    onError: onError(
      'useMapDrawingMutations.update',
      'Couldn’t update the drawing. Please try again.'
    ),
  });

  const remove = useMutation({
    mutationFn: async (drawingId: string) => {
      return await deleteMapDrawingFn({ data: { campaignId, mapId, drawingId } });
    },
    onError: onError(
      'useMapDrawingMutations.remove',
      'Couldn’t delete the drawing. Please try again.'
    ),
  });

  const clear = useMutation({
    mutationFn: async () => {
      return await clearMapDrawingsFn({ data: { campaignId, mapId } });
    },
    onError: onError(
      'useMapDrawingMutations.clear',
      'Couldn’t clear the drawings. Please try again.'
    ),
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

/**
 * Patch only the geometry of one cached drawing — used for lightweight live-move
 * broadcasts (the in-drag path), which carry just the bounding box rather than
 * the whole object (a pencil's full point list can be large).
 */
export function applyDrawingGeomToCache(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: string,
  mapId: string,
  drawingId: string,
  geom: Partial<Pick<MapDrawingData, 'x' | 'y' | 'width' | 'height' | 'points'>>
) {
  qc.setQueryData<MapDrawingData[]>(queryKeys.mapDrawings.list(campaignId, mapId), (prev) => {
    if (!prev) return prev;
    return prev.map((d) => (d.id === drawingId ? { ...d, ...geom } : d));
  });
}
