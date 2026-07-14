import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QuestData, QuestListItem, QuestLinkKind, QuestStatus } from '~/types/quest';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listQuestsSchema,
  getQuestSchema,
  createQuestSchema,
  updateQuestSchema,
  deleteQuestSchema,
  listQuestsForEntitySchema,
} from '~/types/schemas/quests';

const listQuestsFn = createServerFn({ method: 'GET' })
  .inputValidator(listQuestsSchema)
  .handler(async ({ data }) => {
    const { listQuests } = await import('~/server/functions/quests');
    return listQuests({ data });
  });

const getQuestFn = createServerFn({ method: 'GET' })
  .inputValidator(getQuestSchema)
  .handler(async ({ data }) => {
    const { getQuest } = await import('~/server/functions/quests');
    return getQuest({ data });
  });

const createQuestFn = createServerFn({ method: 'POST' })
  .inputValidator(createQuestSchema)
  .handler(async ({ data }) => {
    const { createQuest } = await import('~/server/functions/quests');
    return createQuest({ data });
  });

const updateQuestFn = createServerFn({ method: 'POST' })
  .inputValidator(updateQuestSchema)
  .handler(async ({ data }) => {
    const { updateQuest } = await import('~/server/functions/quests');
    return updateQuest({ data });
  });

const deleteQuestFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteQuestSchema)
  .handler(async ({ data }) => {
    const { deleteQuest } = await import('~/server/functions/quests');
    return deleteQuest({ data });
  });

const listQuestsForEntityFn = createServerFn({ method: 'GET' })
  .inputValidator(listQuestsForEntitySchema)
  .handler(async ({ data }) => {
    const { listQuestsForEntity } = await import('~/server/functions/quests');
    return listQuestsForEntity({ data });
  });

interface ListQuestsFilters {
  search?: string;
  tags?: string[];
  status?: QuestStatus;
  enabled?: boolean;
}

export function useQuests(campaignId: string, filters?: ListQuestsFilters) {
  const { search, tags, status } = filters ?? {};
  const {
    data: quests = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.quests.list(campaignId, search, tags, status),
    queryFn: () =>
      listQuestsFn({
        data: {
          campaignId,
          search,
          tags,
          status,
        },
      }),
    enabled: (filters?.enabled ?? true) && !!campaignId,
  });
  return {
    quests: quests as QuestListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useQuest(id: string, campaignId: string) {
  const {
    data: quest = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.quests.detail(id, campaignId),
    queryFn: () => getQuestFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });
  return {
    quest: quest as QuestData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useQuestsForEntity(
  campaignId: string,
  kind: QuestLinkKind,
  id: string,
  enabled = true
) {
  const { data: quests = [], isLoading } = useQuery({
    queryKey: queryKeys.quests.forEntity(campaignId, kind, id),
    queryFn: () => listQuestsForEntityFn({ data: { campaignId, kind, id } }),
    enabled: enabled && !!campaignId && !!id,
  });
  return { quests: quests as QuestListItem[], isLoading };
}

function errMsg(e: unknown): string | null {
  return e instanceof Error ? e.message : e ? String(e) : null;
}

export function useCreateQuest() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof createQuestFn>[0]['data']) =>
      createQuestFn({ data: input }),
    onSuccess: (_d, { campaignId }) => {
      qc.invalidateQueries({ queryKey: ['quests', 'list', campaignId], exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => captureException(e, { action: 'createQuest' }),
  });
  return {
    create: async (input: Parameters<typeof createQuestFn>[0]['data']) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    isLoading: mutation.isPending,
    error: errMsg(mutation.error),
  };
}

export function useUpdateQuest() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof updateQuestFn>[0]['data']) =>
      updateQuestFn({ data: input }),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({ queryKey: ['quests', 'list', variables.campaignId], exact: false });
      qc.invalidateQueries({
        queryKey: queryKeys.quests.detail(variables.id, variables.campaignId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(variables.campaignId) });
      qc.invalidateQueries({
        queryKey: ['quests', 'forEntity', variables.campaignId],
        exact: false,
      });
      qc.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e) => captureException(e, { action: 'updateQuest' }),
  });
  return {
    update: async (input: Parameters<typeof updateQuestFn>[0]['data']) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    isLoading: mutation.isPending,
    error: errMsg(mutation.error),
  };
}

export function useDeleteQuest() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { id: string; campaignId: string }) => deleteQuestFn({ data: input }),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({ queryKey: ['quests', 'list', variables.campaignId], exact: false });
      qc.removeQueries({ queryKey: queryKeys.quests.detail(variables.id, variables.campaignId) });
      qc.invalidateQueries({
        queryKey: ['quests', 'forEntity', variables.campaignId],
        exact: false,
      });
      qc.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e) => captureException(e, { action: 'deleteQuest' }),
  });
  return {
    remove: async (input: { id: string; campaignId: string }) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    isLoading: mutation.isPending,
    error: errMsg(mutation.error),
  };
}
