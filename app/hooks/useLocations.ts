import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LocationData, LocationListItem } from '~/types/location';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listLocationsSchema,
  getLocationSchema,
  createLocationSchema,
  updateLocationSchema,
  deleteLocationSchema,
} from '~/types/schemas/locations';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const listLocationsFn = createServerFn({ method: 'GET' })
  .inputValidator(listLocationsSchema)
  .handler(async ({ data }) => {
    const { listLocations } = await import('~/server/functions/locations');
    return listLocations({ data });
  });

const getLocationFn = createServerFn({ method: 'GET' })
  .inputValidator(getLocationSchema)
  .handler(async ({ data }) => {
    const { getLocation } = await import('~/server/functions/locations');
    return getLocation({ data });
  });

const createLocationFn = createServerFn({ method: 'POST' })
  .inputValidator(createLocationSchema)
  .handler(async ({ data }) => {
    const { createLocation } = await import('~/server/functions/locations');
    return createLocation({ data });
  });

const updateLocationFn = createServerFn({ method: 'POST' })
  .inputValidator(updateLocationSchema)
  .handler(async ({ data }) => {
    const { updateLocation } = await import('~/server/functions/locations');
    return updateLocation({ data });
  });

const deleteLocationFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteLocationSchema)
  .handler(async ({ data }) => {
    const { deleteLocation } = await import('~/server/functions/locations');
    return deleteLocation({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface ListLocationsFilters {
  search?: string;
  visibility?: 'all' | 'public' | 'private';
  locationType?: string;
  tags?: string[];
}

export function useLocations(campaignId: string, filters?: ListLocationsFilters) {
  const search = filters?.search;
  const visibility = filters?.visibility;
  const locationType = filters?.locationType;
  const tags = filters?.tags;

  const {
    data: locations = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.locations.list(campaignId, search, visibility, locationType, tags),
    queryFn: () =>
      listLocationsFn({
        data: {
          campaignId,
          search,
          visibility,
          locationType,
          tags,
        },
      }),
    enabled: !!campaignId,
  });

  return {
    locations: locations as LocationListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useLocation(id: string, campaignId: string) {
  const {
    data: location = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.locations.detail(id, campaignId),
    queryFn: () => getLocationFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    location: location as LocationData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

interface CreateLocationInput {
  campaignId: string;
  name: string;
  locationType: string;
  description?: string;
  gmNotes?: string;
  isPublic?: boolean;
  parentLocations?: string[];
  tags?: string[];
}

export function useCreateLocation() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateLocationInput) => createLocationFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({
        queryKey: ['locations', 'list', campaignId],
        exact: false,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => {
      captureException(e, { action: 'createLocation' });
    },
  });

  const create = async (input: CreateLocationInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };

  return {
    create,
    isLoading: mutation.isPending,
    error:
      mutation.error instanceof Error
        ? mutation.error.message
        : mutation.error
          ? String(mutation.error)
          : null,
  };
}

interface UpdateLocationInput {
  id: string;
  campaignId: string;
  name: string;
  locationType: string;
  description?: string;
  gmNotes?: string;
  isPublic?: boolean;
  parentLocations?: string[];
  tags?: string[];
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: UpdateLocationInput) => updateLocationFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['locations', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.locations.detail(variables.id, variables.campaignId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(variables.campaignId) });
      // Refresh GM screen / tabletop windows that may display this location
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'updateLocation', locationId: variables.id });
    },
  });

  const update = async (input: UpdateLocationInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };

  return {
    update,
    isLoading: mutation.isPending,
    error:
      mutation.error instanceof Error
        ? mutation.error.message
        : mutation.error
          ? String(mutation.error)
          : null,
  };
}

interface DeleteLocationInput {
  id: string;
  campaignId: string;
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: DeleteLocationInput) => deleteLocationFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['locations', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.removeQueries({
        queryKey: queryKeys.locations.detail(variables.id, variables.campaignId),
      });
      // Refresh GM screen / tabletop windows — server removes refs for deleted locations
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'deleteLocation', locationId: variables.id });
    },
  });

  const remove = async (input: DeleteLocationInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };

  return {
    remove,
    isLoading: mutation.isPending,
    error:
      mutation.error instanceof Error
        ? mutation.error.message
        : mutation.error
          ? String(mutation.error)
          : null,
  };
}
