import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { LocationData, LocationListItem } from '~/types/location';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  listLocationsSchema,
  getLocationSchema,
  createLocationSchema,
  updateLocationSchema,
  deleteLocationSchema,
  addLocationImageSchema,
  deleteLocationImageSchema,
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

const addLocationImageFn = createServerFn({ method: 'POST' })
  .inputValidator(addLocationImageSchema)
  .handler(async ({ data }) => {
    const { addLocationImage } = await import('~/server/functions/locations');
    return addLocationImage({ data });
  });

const deleteLocationImageFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteLocationImageSchema)
  .handler(async ({ data }) => {
    const { deleteLocationImage } = await import('~/server/functions/locations');
    return deleteLocationImage({ data });
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
    error: extractErrorMessage(error),
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
    error: extractErrorMessage(error),
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

export const useCreateLocation = createMutationHook({
  actionName: 'create',
  mutationFn: async (input: CreateLocationInput) => createLocationFn({ data: input }),
  onSuccess: (queryClient, _data, { campaignId }) => {
    queryClient.invalidateQueries({
      queryKey: ['locations', 'list', campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
  },
  errorContext: () => ({ action: 'createLocation' }),
});

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

export const useUpdateLocation = createMutationHook({
  actionName: 'update',
  mutationFn: async (input: UpdateLocationInput) => updateLocationFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
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
  errorContext: (variables) => ({ action: 'updateLocation', locationId: variables.id }),
});

interface DeleteLocationInput {
  id: string;
  campaignId: string;
}

export const useDeleteLocation = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: DeleteLocationInput) => deleteLocationFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
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
  errorContext: (variables) => ({ action: 'deleteLocation', locationId: variables.id }),
});

// ---------------------------------------------------------------------------
// Image hooks
// ---------------------------------------------------------------------------

interface AddLocationImageInput {
  id: string;
  campaignId: string;
  imageKey: string;
  url: string;
  title: string;
}

export const useAddLocationImage = createMutationHook({
  actionName: 'addImage',
  mutationFn: async (input: AddLocationImageInput) => addLocationImageFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.locations.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.all });
  },
  errorContext: (variables) => ({ action: 'addLocationImage', locationId: variables.id }),
});

interface DeleteLocationImageInput {
  id: string;
  campaignId: string;
  imageKey: string;
}

export const useDeleteLocationImage = createMutationHook({
  actionName: 'deleteImage',
  mutationFn: async (input: DeleteLocationImageInput) => deleteLocationImageFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.locations.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.tabletop.all });
  },
  errorContext: (variables) => ({ action: 'deleteLocationImage', locationId: variables.id }),
});
