import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import type { MapData, MapListItem } from '~/types/map';
import {
  listMapsSchema,
  getMapSchema,
  createMapSchema,
  updateMapScaleSchema,
  updateMapSchema,
  deleteMapSchema,
  setActiveMapSchema,
  getActiveMapSchema,
} from '~/types/schemas/maps';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const listMapsFn = createServerFn({ method: 'GET' })
  .inputValidator(listMapsSchema)
  .handler(async ({ data }) => {
    const { listMaps } = await import('~/server/functions/maps');
    return listMaps({ data });
  });

const getMapFn = createServerFn({ method: 'GET' })
  .inputValidator(getMapSchema)
  .handler(async ({ data }) => {
    const { getMap } = await import('~/server/functions/maps');
    return getMap({ data });
  });

const getActiveMapFn = createServerFn({ method: 'GET' })
  .inputValidator(getActiveMapSchema)
  .handler(async ({ data }) => {
    const { getActiveMap } = await import('~/server/functions/maps');
    return getActiveMap({ data });
  });

const createMapFn = createServerFn({ method: 'POST' })
  .inputValidator(createMapSchema)
  .handler(async ({ data }) => {
    const { createMap } = await import('~/server/functions/maps');
    return createMap({ data });
  });

const updateMapScaleFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMapScaleSchema)
  .handler(async ({ data }) => {
    const { updateMapScale } = await import('~/server/functions/maps');
    return updateMapScale({ data });
  });

const updateMapFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMapSchema)
  .handler(async ({ data }) => {
    const { updateMap } = await import('~/server/functions/maps');
    return updateMap({ data });
  });

const deleteMapFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteMapSchema)
  .handler(async ({ data }) => {
    const { deleteMap } = await import('~/server/functions/maps');
    return deleteMap({ data });
  });

const setActiveMapFn = createServerFn({ method: 'POST' })
  .inputValidator(setActiveMapSchema)
  .handler(async ({ data }) => {
    const { setActiveMap } = await import('~/server/functions/maps');
    return setActiveMap({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useMapsList(campaignId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.maps.list(campaignId ?? ''),
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<MapListItem[]> => {
      const res = await listMapsFn({ data: { campaignId: campaignId! } });
      return res.maps;
    },
  });
}

export function useMap(campaignId: string | null | undefined, mapId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.maps.detail(campaignId ?? '', mapId ?? ''),
    enabled: Boolean(campaignId && mapId),
    queryFn: async (): Promise<MapData> => {
      const res = await getMapFn({ data: { id: mapId!, campaignId: campaignId! } });
      return res.map;
    },
  });
}

export function useActiveMap(
  campaignId: string | null | undefined,
  screenId: string | null | undefined
) {
  return useQuery({
    queryKey: queryKeys.maps.active(campaignId ?? '', screenId ?? ''),
    enabled: Boolean(campaignId && screenId),
    queryFn: async (): Promise<MapData | null> => {
      const res = await getActiveMapFn({ data: { campaignId: campaignId!, screenId: screenId! } });
      return res.map;
    },
  });
}

export function useMapsMutations(campaignId: string) {
  const qc = useQueryClient();

  const invalidateLists = () => {
    qc.invalidateQueries({ queryKey: queryKeys.maps.list(campaignId) });
    qc.invalidateQueries({ queryKey: queryKeys.maps.activeAll(campaignId) });
  };

  const createMap = useMutation({
    mutationFn: async (input: Omit<Parameters<typeof createMapFn>[0]['data'], 'campaignId'>) => {
      const res = await createMapFn({ data: { ...input, campaignId } });
      return res.map;
    },
    onSuccess: invalidateLists,
    onError: (e) => captureException(e, { action: 'useMapsMutations.createMap' }),
  });

  const updateMapScale = useMutation({
    mutationFn: async (
      input: Omit<Parameters<typeof updateMapScaleFn>[0]['data'], 'campaignId'>
    ) => {
      const res = await updateMapScaleFn({ data: { ...input, campaignId } });
      return res.map;
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: queryKeys.maps.detail(campaignId, m.id) });
      invalidateLists();
    },
    onError: (e) => captureException(e, { action: 'useMapsMutations.updateMapScale' }),
  });

  const updateMap = useMutation({
    mutationFn: async (input: Omit<Parameters<typeof updateMapFn>[0]['data'], 'campaignId'>) => {
      const res = await updateMapFn({ data: { ...input, campaignId } });
      return res.map;
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: queryKeys.maps.detail(campaignId, m.id) });
      invalidateLists();
    },
    onError: (e) => captureException(e, { action: 'useMapsMutations.updateMap' }),
  });

  const deleteMap = useMutation({
    mutationFn: async (mapId: string) => {
      return await deleteMapFn({ data: { id: mapId, campaignId } });
    },
    onSuccess: invalidateLists,
    onError: (e) => captureException(e, { action: 'useMapsMutations.deleteMap' }),
  });

  const setActiveMap = useMutation({
    mutationFn: async (input: { screenId: string; mapId: string | null }) => {
      return await setActiveMapFn({ data: { campaignId, ...input } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.maps.activeAll(campaignId) });
    },
    onError: (e) => captureException(e, { action: 'useMapsMutations.setActiveMap' }),
  });

  return { createMap, updateMapScale, updateMap, deleteMap, setActiveMap };
}
