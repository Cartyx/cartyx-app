import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listSessionsSchema,
  getSessionCatchUpSchema,
  createSessionSchema,
  updateSessionSchema,
} from '~/types/schemas/sessions';
import { activateSessionSchema } from '~/types/schemas/campaigns';

const listSessionsFn = createServerFn({ method: 'GET' })
  .inputValidator(listSessionsSchema)
  .handler(async ({ data }) => {
    const { listSessions } = await import('~/server/functions/sessions');
    return listSessions({ data });
  });

const getSessionCatchUpFn = createServerFn({ method: 'GET' })
  .inputValidator(getSessionCatchUpSchema)
  .handler(async ({ data }) => {
    const { getSessionCatchUp } = await import('~/server/functions/sessions');
    return getSessionCatchUp({ data });
  });

const createSessionFn = createServerFn({ method: 'POST' })
  .inputValidator(createSessionSchema)
  .handler(async ({ data }) => {
    const { createSession } = await import('~/server/functions/sessions');
    return createSession({ data });
  });

const updateSessionFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSessionSchema)
  .handler(async ({ data }) => {
    const { updateSession } = await import('~/server/functions/sessions');
    return updateSession({ data });
  });

const activateSessionFn = createServerFn({ method: 'POST' })
  .inputValidator(activateSessionSchema)
  .handler(async ({ data }) => {
    const { activateSession } = await import('~/server/functions/campaigns');
    return activateSession({ data });
  });

export function useSessions(campaignId: string, includeCompleted: boolean) {
  const {
    data: sessions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.sessions.list(campaignId, includeCompleted),
    queryFn: () => listSessionsFn({ data: { campaignId, includeCompleted } }),
  });
  return {
    sessions,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

/**
 * Fetch a single session's catch-up markdown on demand. Enabled only when both
 * ids are present, so the query stays idle until a session is actually opened.
 */
export function useSessionCatchUp(campaignId: string, sessionId: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sessions.catchUp(campaignId, sessionId),
    queryFn: () => getSessionCatchUpFn({ data: { campaignId, sessionId } }),
    enabled: !!campaignId && !!sessionId,
  });
  return {
    catchUp: data?.catchUp ?? null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { campaignId: string; name: string; startDate: string }) =>
      createSessionFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'list', campaignId], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
    },
    onError: (e, { campaignId }) => {
      captureException(e, { action: 'createSession', campaignId });
    },
  });

  const create = async (input: { campaignId: string; name: string; startDate: string }) => {
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

export function useUpdateSession() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: {
      sessionId: string;
      campaignId: string;
      name?: string;
      startDate?: string;
      endDate?: string;
      summary?: string;
    }) => updateSessionFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'list', campaignId], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
    },
    onError: (e, { campaignId }) => {
      captureException(e, { action: 'updateSession', campaignId });
    },
  });

  const update = async (input: {
    sessionId: string;
    campaignId: string;
    name?: string;
    startDate?: string;
    endDate?: string;
    summary?: string;
  }) => {
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

export function useActivateSession() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { campaignId: string; sessionId: string; endDate?: string }) =>
      activateSessionFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'list', campaignId], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(campaignId) });
    },
    onError: (e, { campaignId }) => {
      captureException(e, { action: 'activateSession', campaignId });
    },
  });

  const activate = async (input: { campaignId: string; sessionId: string; endDate?: string }) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };

  return {
    activate,
    isLoading: mutation.isPending,
    error:
      mutation.error instanceof Error
        ? mutation.error.message
        : mutation.error
          ? String(mutation.error)
          : null,
  };
}
