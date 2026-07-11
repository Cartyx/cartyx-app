import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import type { MonsterData, MonsterListItem } from '~/types/monster';
import {
  listMonstersSchema,
  getMonsterSchema,
  createMonsterSchema,
  updateMonsterSchema,
  deleteMonsterSchema,
} from '~/types/schemas/monsters';

// ---------------------------------------------------------------------------
// Server fn wrappers — dynamic imports keep mongoose server-only.
// ---------------------------------------------------------------------------

const listMonstersFn = createServerFn({ method: 'GET' })
  .inputValidator(listMonstersSchema)
  .handler(async ({ data }) => {
    const { listMonsters } = await import('~/server/functions/monsters');
    return listMonsters({ data });
  });

const getMonsterFn = createServerFn({ method: 'GET' })
  .inputValidator(getMonsterSchema)
  .handler(async ({ data }) => {
    const { getMonster } = await import('~/server/functions/monsters');
    return getMonster({ data });
  });

const createMonsterFn = createServerFn({ method: 'POST' })
  .inputValidator(createMonsterSchema)
  .handler(async ({ data }) => {
    const { createMonster } = await import('~/server/functions/monsters');
    return createMonster({ data });
  });

const updateMonsterFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMonsterSchema)
  .handler(async ({ data }) => {
    const { updateMonster } = await import('~/server/functions/monsters');
    return updateMonster({ data });
  });

const deleteMonsterFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteMonsterSchema)
  .handler(async ({ data }) => {
    const { deleteMonster } = await import('~/server/functions/monsters');
    return deleteMonster({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface ListMonstersFilters {
  search?: string;
  tags?: string[];
  sessionId?: string;
  minCr?: number;
  maxCr?: number;
}

export function useMonsters(
  campaignId: string | null | undefined,
  isGM: boolean,
  filters?: ListMonstersFilters
) {
  return useQuery({
    queryKey: queryKeys.monsters.list(
      campaignId ?? '',
      filters?.search,
      filters?.tags,
      filters?.sessionId,
      filters?.minCr,
      filters?.maxCr
    ),
    // Hook is GM-gated client-side too. Server still enforces independently.
    enabled: Boolean(campaignId) && isGM,
    queryFn: async (): Promise<MonsterListItem[]> => {
      const res = await listMonstersFn({
        data: {
          campaignId: campaignId!,
          search: filters?.search,
          tags: filters?.tags,
          sessionId: filters?.sessionId,
          minCr: filters?.minCr,
          maxCr: filters?.maxCr,
        },
      });
      return res.monsters;
    },
  });
}

export function useMonster(
  campaignId: string | null | undefined,
  monsterId: string | null | undefined,
  isGM: boolean
) {
  return useQuery({
    queryKey: queryKeys.monsters.detail(campaignId ?? '', monsterId ?? ''),
    enabled: Boolean(campaignId && monsterId) && isGM,
    queryFn: async (): Promise<MonsterData> => {
      const res = await getMonsterFn({
        data: { id: monsterId!, campaignId: campaignId! },
      });
      return res.monster;
    },
  });
}

export function useMonsterMutations(campaignId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.monsters.all });

  const create = useMutation({
    mutationFn: async (
      input: Omit<Parameters<typeof createMonsterFn>[0]['data'], 'campaignId'>
    ) => {
      const res = await createMonsterFn({ data: { ...input, campaignId } });
      return res.monster;
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMonsterMutations.create' }),
  });

  const update = useMutation({
    mutationFn: async (
      input: Omit<Parameters<typeof updateMonsterFn>[0]['data'], 'campaignId'>
    ) => {
      const res = await updateMonsterFn({ data: { ...input, campaignId } });
      return res.monster;
    },
    onSuccess: (m) => {
      qc.invalidateQueries({
        queryKey: queryKeys.monsters.detail(campaignId, m.id),
      });
      invalidate();
    },
    onError: (e) => captureException(e, { action: 'useMonsterMutations.update' }),
  });

  const remove = useMutation({
    mutationFn: async (monsterId: string) => {
      return await deleteMonsterFn({ data: { id: monsterId, campaignId } });
    },
    onSuccess: invalidate,
    onError: (e) => captureException(e, { action: 'useMonsterMutations.remove' }),
  });

  return { create, update, remove };
}
