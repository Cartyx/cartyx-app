import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { CalendarData, CalDate } from '~/types/calendar';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  getCalendarSchema,
  upsertCalendarSchema,
  setCurrentDateSchema,
  deleteCalendarSchema,
} from '~/types/schemas/calendars';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const getCalendarFn = createServerFn({ method: 'GET' })
  .inputValidator(getCalendarSchema)
  .handler(async ({ data }) => {
    const { getCalendar } = await import('~/server/functions/calendars');
    return getCalendar({ data });
  });

const upsertCalendarFn = createServerFn({ method: 'POST' })
  .inputValidator(upsertCalendarSchema)
  .handler(async ({ data }) => {
    const { upsertCalendar } = await import('~/server/functions/calendars');
    return upsertCalendar({ data });
  });

const setCurrentDateFn = createServerFn({ method: 'POST' })
  .inputValidator(setCurrentDateSchema)
  .handler(async ({ data }) => {
    const { setCurrentDate } = await import('~/server/functions/calendars');
    return setCurrentDate({ data });
  });

const deleteCalendarFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteCalendarSchema)
  .handler(async ({ data }) => {
    const { deleteCalendar } = await import('~/server/functions/calendars');
    return deleteCalendar({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCalendar(campaignId: string) {
  const {
    data: calendar = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.calendar.detail(campaignId),
    queryFn: () => getCalendarFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });

  return {
    calendar: calendar as CalendarData | null,
    isLoading,
    error: extractErrorMessage(error),
  };
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export type UpsertCalendarInput = { campaignId: string } & Omit<
  CalendarData,
  'id' | 'createdBy' | 'createdAt' | 'updatedAt' | 'canEdit'
>;

export const useUpsertCalendar = createMutationHook({
  actionName: 'save',
  mutationFn: async (input: UpsertCalendarInput) => upsertCalendarFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.calendar.detail(variables.campaignId) });
    queryClient.invalidateQueries({
      queryKey: ['events', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.events.epic(variables.campaignId) });
  },
  errorContext: () => ({ action: 'upsertCalendar' }),
});

export const useSetCurrentDate = createMutationHook({
  actionName: 'setCurrentDate',
  mutationFn: async (input: { campaignId: string; currentDate: CalDate }) =>
    setCurrentDateFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.calendar.detail(variables.campaignId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.events.epic(variables.campaignId) });
  },
  errorContext: () => ({ action: 'setCurrentDate' }),
});

export const useDeleteCalendar = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: { campaignId: string }) => deleteCalendarFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    // The calendar is gone; drop its cached detail rather than invalidating (which would refetch a null). Mirrors useDeleteLore.
    queryClient.removeQueries({ queryKey: queryKeys.calendar.detail(variables.campaignId) });
  },
  errorContext: () => ({ action: 'deleteCalendar' }),
});
