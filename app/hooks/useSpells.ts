import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SpellData, SpellListItem, SpellSchool } from '~/types/spell';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listSpellsSchema,
  getSpellSchema,
  createSpellSchema,
  updateSpellSchema,
  deleteSpellSchema,
  duplicateSpellSchema,
} from '~/types/schemas/spells';

const listSpellsFn = createServerFn({ method: 'GET' })
  .inputValidator(listSpellsSchema)
  .handler(async ({ data }) => {
    const { listSpells } = await import('~/server/functions/spells');
    return listSpells({ data });
  });

const getSpellFn = createServerFn({ method: 'GET' })
  .inputValidator(getSpellSchema)
  .handler(async ({ data }) => {
    const { getSpell } = await import('~/server/functions/spells');
    return getSpell({ data });
  });

const createSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(createSpellSchema)
  .handler(async ({ data }) => {
    const { createSpell } = await import('~/server/functions/spells');
    return createSpell({ data });
  });

const updateSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSpellSchema)
  .handler(async ({ data }) => {
    const { updateSpell } = await import('~/server/functions/spells');
    return updateSpell({ data });
  });

const deleteSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteSpellSchema)
  .handler(async ({ data }) => {
    const { deleteSpell } = await import('~/server/functions/spells');
    return deleteSpell({ data });
  });

const duplicateSpellFn = createServerFn({ method: 'POST' })
  .inputValidator(duplicateSpellSchema)
  .handler(async ({ data }) => {
    const { duplicateSpell } = await import('~/server/functions/spells');
    return duplicateSpell({ data });
  });

interface ListSpellsFilters {
  search?: string;
  tags?: string[];
  level?: number;
  school?: SpellSchool;
  enabled?: boolean;
}

export function useSpells(campaignId: string, filters?: ListSpellsFilters) {
  const { search, tags, level, school } = filters ?? {};
  const {
    data: spells = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.spells.list(campaignId, search, tags, level, school),
    queryFn: () => listSpellsFn({ data: { campaignId, search, tags, level, school } }),
    enabled: (filters?.enabled ?? true) && !!campaignId,
  });
  return {
    spells: spells as SpellListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useSpell(id: string, campaignId: string) {
  const {
    data: spell = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.spells.detail(id, campaignId),
    queryFn: () => getSpellFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });
  return {
    spell: spell as SpellData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

 
type CreateSpellInput = Parameters<typeof createSpellFn>[0]['data'];
type UpdateSpellInput = Parameters<typeof updateSpellFn>[0]['data'];

function errString(e: unknown): string | null {
  return e instanceof Error ? e.message : e ? String(e) : null;
}

export function useCreateSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateSpellInput) => createSpellFn({ data: input }),
    onSuccess: (_d, { campaignId }) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', campaignId], exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => captureException(e, { action: 'createSpell' }),
  });
  const create = async (input: CreateSpellInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { create, isLoading: mutation.isPending, error: errString(mutation.error) };
}

export function useUpdateSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: UpdateSpellInput) => updateSpellFn({ data: input }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', v.campaignId], exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.spells.detail(v.id, v.campaignId) });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(v.campaignId) });
    },
    onError: (e, v) => captureException(e, { action: 'updateSpell', spellId: v.id }),
  });
  const update = async (input: UpdateSpellInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { update, isLoading: mutation.isPending, error: errString(mutation.error) };
}

export function useDeleteSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { id: string; campaignId: string }) => deleteSpellFn({ data: input }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', v.campaignId], exact: false });
      qc.removeQueries({ queryKey: queryKeys.spells.detail(v.id, v.campaignId) });
    },
    onError: (e, v) => captureException(e, { action: 'deleteSpell', spellId: v.id }),
  });
  const remove = async (input: { id: string; campaignId: string }) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { remove, isLoading: mutation.isPending, error: errString(mutation.error) };
}

export function useDuplicateSpell() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { id: string; campaignId: string }) =>
      duplicateSpellFn({ data: input }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['spells', 'list', v.campaignId], exact: false });
    },
    onError: (e, v) => captureException(e, { action: 'duplicateSpell', spellId: v.id }),
  });
  const duplicate = async (input: { id: string; campaignId: string }) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };
  return { duplicate, isLoading: mutation.isPending, error: errString(mutation.error) };
}
