import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { LoreData, LoreListItem, LoreLinkKind } from '~/types/lore';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  listLoreSchema,
  getLoreSchema,
  createLoreSchema,
  updateLoreSchema,
  deleteLoreSchema,
} from '~/types/schemas/lore';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listLoreFn = createServerFn({ method: 'GET' })
  .inputValidator(listLoreSchema)
  .handler(async ({ data }) => {
    const { listLore } = await import('~/server/functions/lore');
    return listLore({ data });
  });

const getLoreFn = createServerFn({ method: 'GET' })
  .inputValidator(getLoreSchema)
  .handler(async ({ data }) => {
    const { getLore } = await import('~/server/functions/lore');
    return getLore({ data });
  });

const createLoreFn = createServerFn({ method: 'POST' })
  .inputValidator(createLoreSchema)
  .handler(async ({ data }) => {
    const { createLore } = await import('~/server/functions/lore');
    return createLore({ data });
  });

const updateLoreFn = createServerFn({ method: 'POST' })
  .inputValidator(updateLoreSchema)
  .handler(async ({ data }) => {
    const { updateLore } = await import('~/server/functions/lore');
    return updateLore({ data });
  });

const deleteLoreFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteLoreSchema)
  .handler(async ({ data }) => {
    const { deleteLore } = await import('~/server/functions/lore');
    return deleteLore({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface LoreFilters {
  search?: string;
  tags?: string[];
  visibility?: 'all' | 'public' | 'private';
  linkedKind?: LoreLinkKind;
  linkedId?: string;
}

export function useLore(campaignId: string, filters?: LoreFilters) {
  const {
    data: lore = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.lore.list(campaignId, JSON.stringify(filters ?? {})),
    queryFn: () =>
      listLoreFn({
        data: {
          campaignId,
          search: filters?.search,
          tags: filters?.tags,
          visibility: filters?.visibility,
          linkedKind: filters?.linkedKind,
          linkedId: filters?.linkedId,
        },
      }),
    enabled: !!campaignId,
  });

  return {
    lore: lore as LoreListItem[],
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function useLoreEntry(id: string, campaignId: string) {
  const {
    data: lore = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.lore.detail(id, campaignId),
    queryFn: () => getLoreFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    lore: lore as LoreData | null,
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function useLinkedLore(campaignId: string, kind: string, id: string) {
  const {
    data: lore = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.lore.linked(campaignId, kind, id),
    queryFn: () =>
      listLoreFn({
        data: {
          campaignId,
          linkedKind: kind as LoreLinkKind,
          linkedId: id,
        },
      }),
    enabled: !!campaignId && !!kind && !!id,
  });

  return {
    lore: lore as LoreListItem[],
    isLoading,
    error: extractErrorMessage(error),
  };
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export interface CreateLoreInput {
  campaignId: string;
  title: string;
  content?: string;
  gmContent?: string;
  isPublic?: boolean;
  images?: {
    url: string;
    caption: string;
    crop: { x: number; y: number; width: number; height: number } | null;
  }[];
  links?: { kind: LoreLinkKind; id: string }[];
  tags?: string[];
}

export const useCreateLore = createMutationHook({
  actionName: 'create',
  mutationFn: async (input: CreateLoreInput) => createLoreFn({ data: input }),
  onSuccess: (queryClient, _data, { campaignId }) => {
    queryClient.invalidateQueries({ queryKey: ['lore', 'list', campaignId], exact: false });
    queryClient.invalidateQueries({ queryKey: ['lore', 'linked', campaignId], exact: false });
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
  },
  errorContext: () => ({ action: 'createLore' }),
});

export interface UpdateLoreInput {
  id: string;
  campaignId: string;
  title: string;
  content?: string;
  gmContent?: string;
  isPublic?: boolean;
  images?: {
    url: string;
    caption: string;
    crop: { x: number; y: number; width: number; height: number } | null;
  }[];
  links?: { kind: LoreLinkKind; id: string }[];
  tags?: string[];
}

export const useUpdateLore = createMutationHook({
  actionName: 'update',
  mutationFn: async (input: UpdateLoreInput) => updateLoreFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['lore', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.lore.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: ['lore', 'linked', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
  },
  errorContext: (variables) => ({ action: 'updateLore', loreId: variables.id }),
});

export interface DeleteLoreInput {
  id: string;
  campaignId: string;
}

export const useDeleteLore = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: DeleteLoreInput) => deleteLoreFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['lore', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.removeQueries({
      queryKey: queryKeys.lore.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: ['lore', 'linked', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
  },
  errorContext: (variables) => ({ action: 'deleteLore', loreId: variables.id }),
});
