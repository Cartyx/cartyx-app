import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RuleData, RuleListItem } from '~/types/rule';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listRulesSchema,
  getRuleSchema,
  createRuleSchema,
  updateRuleSchema,
  deleteRuleSchema,
} from '~/types/schemas/rules';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const listRulesFn = createServerFn({ method: 'GET' })
  .inputValidator(listRulesSchema)
  .handler(async ({ data }) => {
    const { listRules } = await import('~/server/functions/rules');
    return listRules({ data });
  });

const getRuleFn = createServerFn({ method: 'GET' })
  .inputValidator(getRuleSchema)
  .handler(async ({ data }) => {
    const { getRule } = await import('~/server/functions/rules');
    return getRule({ data });
  });

const createRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(createRuleSchema)
  .handler(async ({ data }) => {
    const { createRule } = await import('~/server/functions/rules');
    return createRule({ data });
  });

const updateRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(updateRuleSchema)
  .handler(async ({ data }) => {
    const { updateRule } = await import('~/server/functions/rules');
    return updateRule({ data });
  });

const deleteRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteRuleSchema)
  .handler(async ({ data }) => {
    const { deleteRule } = await import('~/server/functions/rules');
    return deleteRule({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface ListRulesFilters {
  search?: string;
  visibility?: 'all' | 'public' | 'private';
  tags?: string[];
}

export function useRules(campaignId: string, filters?: ListRulesFilters) {
  const search = filters?.search;
  const visibility = filters?.visibility;
  const tags = filters?.tags;

  const {
    data: rules = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.rules.list(campaignId, search, visibility, tags),
    queryFn: () =>
      listRulesFn({
        data: {
          campaignId,
          search,
          visibility,
          tags,
        },
      }),
    enabled: !!campaignId,
  });

  return {
    rules: rules as RuleListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useRule(id: string, campaignId: string) {
  const {
    data: rule = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.rules.detail(id, campaignId),
    queryFn: () => getRuleFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    rule: rule as RuleData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

interface CreateRuleInput {
  campaignId: string;
  title: string;
  content: string;
  tags?: string[];
  isPublic?: boolean;
}

export function useCreateRule() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateRuleInput) => createRuleFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['rules', 'list', campaignId], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => {
      captureException(e, { action: 'createRule' });
    },
  });

  const create = async (input: CreateRuleInput) => {
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

interface UpdateRuleInput {
  id: string;
  campaignId: string;
  title: string;
  content: string;
  tags?: string[];
  isPublic?: boolean;
}

export function useUpdateRule() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: UpdateRuleInput) => updateRuleFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['rules', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.rules.detail(variables.id, variables.campaignId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(variables.campaignId) });
      // Refresh GM screen windows that may display this rule's content
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'updateRule', ruleId: variables.id });
    },
  });

  const update = async (input: UpdateRuleInput) => {
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

interface DeleteRuleInput {
  id: string;
  campaignId: string;
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: DeleteRuleInput) => deleteRuleFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['rules', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.removeQueries({
        queryKey: queryKeys.rules.detail(variables.id, variables.campaignId),
      });
      // Refresh GM screen windows — server removes refs for deleted rules
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'deleteRule', ruleId: variables.id });
    },
  });

  const remove = async (input: DeleteRuleInput) => {
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
