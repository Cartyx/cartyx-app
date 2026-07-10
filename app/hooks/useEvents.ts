import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { EventData, EventListItem, EventLinkKind } from '~/types/event';
import type { CalDate } from '~/types/calendar';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  listEventsSchema,
  getEventSchema,
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
} from '~/types/schemas/events';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listEventsFn = createServerFn({ method: 'GET' })
  .inputValidator(listEventsSchema)
  .handler(async ({ data }) => {
    const { listEvents } = await import('~/server/functions/events');
    return listEvents({ data });
  });

const getEventFn = createServerFn({ method: 'GET' })
  .inputValidator(getEventSchema)
  .handler(async ({ data }) => {
    const { getEvent } = await import('~/server/functions/events');
    return getEvent({ data });
  });

const createEventFn = createServerFn({ method: 'POST' })
  .inputValidator(createEventSchema)
  .handler(async ({ data }) => {
    const { createEvent } = await import('~/server/functions/events');
    return createEvent({ data });
  });

const updateEventFn = createServerFn({ method: 'POST' })
  .inputValidator(updateEventSchema)
  .handler(async ({ data }) => {
    const { updateEvent } = await import('~/server/functions/events');
    return updateEvent({ data });
  });

const deleteEventFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteEventSchema)
  .handler(async ({ data }) => {
    const { deleteEvent } = await import('~/server/functions/events');
    return deleteEvent({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface EventFilters {
  search?: string;
  tags?: string[];
  visibility?: 'all' | 'public' | 'private';
  epicOnly?: boolean;
  linkedKind?: EventLinkKind;
  linkedId?: string;
}

export function useEvents(campaignId: string, filters?: EventFilters) {
  const {
    data: events = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.events.list(campaignId, JSON.stringify(filters ?? {})),
    queryFn: () =>
      listEventsFn({
        data: {
          campaignId,
          search: filters?.search,
          tags: filters?.tags,
          visibility: filters?.visibility,
          epicOnly: filters?.epicOnly,
          linkedKind: filters?.linkedKind,
          linkedId: filters?.linkedId,
        },
      }),
    enabled: !!campaignId,
  });

  return {
    events: events as EventListItem[],
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function useEpicEvents(campaignId: string) {
  const {
    data: events = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.events.epic(campaignId),
    queryFn: () => listEventsFn({ data: { campaignId, epicOnly: true } }),
    enabled: !!campaignId,
  });

  return {
    events: events as EventListItem[],
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function useEvent(id: string, campaignId: string) {
  const {
    data: event = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.events.detail(id, campaignId),
    queryFn: () => getEventFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    event: event as EventData | null,
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function useLinkedEvents(campaignId: string, kind: string, id: string) {
  const {
    data: events = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.events.linked(campaignId, kind, id),
    queryFn: () =>
      listEventsFn({
        data: {
          campaignId,
          linkedKind: kind as EventLinkKind,
          linkedId: id,
        },
      }),
    enabled: !!campaignId && !!kind && !!id,
  });

  return {
    events: events as EventListItem[],
    isLoading,
    error: extractErrorMessage(error),
  };
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export interface EventMutationInput {
  id?: string;
  campaignId: string;
  title: string;
  content?: string;
  gmContent?: string;
  isPublic?: boolean;
  isEpic?: boolean;
  start: CalDate;
  end?: CalDate | null;
  links?: { kind: EventLinkKind; id: string }[];
  sessionId?: string | null;
  images?: {
    url: string;
    caption: string;
    crop: { x: number; y: number; width: number; height: number } | null;
  }[];
  tags?: string[];
  color?: string | null;
}

function invalidateEvents(
  queryClient: import('@tanstack/react-query').QueryClient,
  campaignId: string
) {
  queryClient.invalidateQueries({ queryKey: ['events', 'list', campaignId], exact: false });
  queryClient.invalidateQueries({ queryKey: ['events', 'linked', campaignId], exact: false });
  queryClient.invalidateQueries({ queryKey: queryKeys.events.epic(campaignId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
}

export const useCreateEvent = createMutationHook({
  actionName: 'create',
  mutationFn: async (input: EventMutationInput) => createEventFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    invalidateEvents(queryClient, variables.campaignId);
  },
  errorContext: () => ({ action: 'createEvent' }),
});

export const useUpdateEvent = createMutationHook({
  actionName: 'update',
  mutationFn: async (input: EventMutationInput & { id: string }) => updateEventFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    invalidateEvents(queryClient, variables.campaignId);
    queryClient.invalidateQueries({
      queryKey: queryKeys.events.detail(variables.id, variables.campaignId),
    });
  },
  errorContext: (variables) => ({ action: 'updateEvent', eventId: variables.id }),
});

export const useDeleteEvent = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: { id: string; campaignId: string }) => deleteEventFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    invalidateEvents(queryClient, variables.campaignId);
    queryClient.removeQueries({
      queryKey: queryKeys.events.detail(variables.id, variables.campaignId),
    });
  },
  errorContext: (variables) => ({ action: 'deleteEvent', eventId: variables.id }),
});
