import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LocationTypeData } from '~/types/location';
import { captureException } from '~/providers/PostHogProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listLocationTypesSchema,
  createLocationTypeSchema,
  deleteLocationTypeSchema,
} from '~/types/schemas/locations';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const listLocationTypesFn = createServerFn({ method: 'GET' })
  .inputValidator(listLocationTypesSchema)
  .handler(async ({ data }) => {
    const { listLocationTypes } = await import('~/server/functions/location-types');
    return listLocationTypes({ data });
  });

const createLocationTypeFn = createServerFn({ method: 'POST' })
  .inputValidator(createLocationTypeSchema)
  .handler(async ({ data }) => {
    const { createLocationType } = await import('~/server/functions/location-types');
    return createLocationType({ data });
  });

const deleteLocationTypeFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteLocationTypeSchema)
  .handler(async ({ data }) => {
    const { deleteLocationType } = await import('~/server/functions/location-types');
    return deleteLocationType({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useLocationTypes(campaignId: string) {
  const {
    data: locationTypes = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.locationTypes.list(campaignId),
    queryFn: () => listLocationTypesFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });

  return {
    locationTypes: locationTypes as LocationTypeData[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useCreateLocationType() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { campaignId: string; name: string }) =>
      createLocationTypeFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.locationTypes.list(campaignId),
      });
    },
    onError: (e) => {
      captureException(e, { action: 'createLocationType' });
    },
  });

  const create = async (input: { campaignId: string; name: string }) => {
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

export function useDeleteLocationType() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { id: string; campaignId: string }) =>
      deleteLocationTypeFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.locationTypes.list(campaignId),
      });
    },
    onError: (e) => {
      captureException(e, { action: 'deleteLocationType' });
    },
  });

  const remove = async (input: { id: string; campaignId: string }) => {
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
