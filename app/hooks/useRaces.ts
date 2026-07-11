import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RaceData, RaceListItem } from '~/types/race';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listRacesSchema,
  getRaceSchema,
  createRaceSchema,
  updateRaceSchema,
  deleteRaceSchema,
} from '~/types/schemas/races';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listRacesFn = createServerFn({ method: 'GET' })
  .inputValidator(listRacesSchema)
  .handler(async ({ data }) => {
    const { listRaces } = await import('~/server/functions/races');
    return listRaces({ data });
  });

const getRaceFn = createServerFn({ method: 'GET' })
  .inputValidator(getRaceSchema)
  .handler(async ({ data }) => {
    const { getRace } = await import('~/server/functions/races');
    return getRace({ data });
  });

const createRaceFn = createServerFn({ method: 'POST' })
  .inputValidator(createRaceSchema)
  .handler(async ({ data }) => {
    const { createRace } = await import('~/server/functions/races');
    return createRace({ data });
  });

const updateRaceFn = createServerFn({ method: 'POST' })
  .inputValidator(updateRaceSchema)
  .handler(async ({ data }) => {
    const { updateRace } = await import('~/server/functions/races');
    return updateRace({ data });
  });

const deleteRaceFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteRaceSchema)
  .handler(async ({ data }) => {
    const { deleteRace } = await import('~/server/functions/races');
    return deleteRace({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface ListRacesFilters {
  search?: string;
  tags?: string[];
  enabled?: boolean;
}

export function useRaces(campaignId: string, filters?: ListRacesFilters) {
  const search = filters?.search;
  const tags = filters?.tags;

  const {
    data: races = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.races.list(campaignId, search, tags),
    queryFn: () =>
      listRacesFn({
        data: {
          campaignId,
          search,
          tags,
        },
      }),
    enabled: (filters?.enabled ?? true) && !!campaignId,
  });

  return {
    races: races as RaceListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useRace(id: string, campaignId: string) {
  const {
    data: race = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.races.detail(id, campaignId),
    queryFn: () => getRaceFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    race: race as RaceData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

interface CreateRaceInput {
  campaignId: string;
  title: string;
  content: string;
  tags?: string[];
}

export function useCreateRace() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateRaceInput) => createRaceFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['races', 'list', campaignId], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => {
      captureException(e, { action: 'createRace' });
    },
  });

  const create = async (input: CreateRaceInput) => {
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

interface UpdateRaceInput {
  id: string;
  campaignId: string;
  title: string;
  content: string;
  tags?: string[];
}

export function useUpdateRace() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: UpdateRaceInput) => updateRaceFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['races', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.races.detail(variables.id, variables.campaignId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(variables.campaignId) });
      // Refresh GM screen windows that display this race's content
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'updateRace', raceId: variables.id });
    },
  });

  const update = async (input: UpdateRaceInput) => {
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

interface DeleteRaceInput {
  id: string;
  campaignId: string;
}

export function useDeleteRace() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: DeleteRaceInput) => deleteRaceFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['races', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.removeQueries({
        queryKey: queryKeys.races.detail(variables.id, variables.campaignId),
      });
      // Refresh GM screen windows — server removes refs for deleted races
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'deleteRace', raceId: variables.id });
    },
  });

  const remove = async (input: DeleteRaceInput) => {
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
