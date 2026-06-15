import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { PlayerData, PlayerListItem } from '~/types/player';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  listPlayersSchema,
  getPlayerSchema,
  updatePlayerSchema,
  deletePlayerSchema,
  updatePlayerStatusSchema,
  playerRelationshipSchema,
  removePlayerRelationshipSchema,
  validateInviteCodeSchema,
  completeJoinWizardSchema,
} from '~/types/schemas/players';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listPlayersFn = createServerFn({ method: 'GET' })
  .inputValidator(listPlayersSchema)
  .handler(async ({ data }) => {
    const { listPlayers } = await import('~/server/functions/players');
    return listPlayers({ data });
  });

const getPlayerFn = createServerFn({ method: 'GET' })
  .inputValidator(getPlayerSchema)
  .handler(async ({ data }) => {
    const { getPlayer } = await import('~/server/functions/players');
    return getPlayer({ data });
  });

const updatePlayerFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePlayerSchema)
  .handler(async ({ data }) => {
    const { updatePlayer } = await import('~/server/functions/players');
    return updatePlayer({ data });
  });

const deletePlayerFn = createServerFn({ method: 'POST' })
  .inputValidator(deletePlayerSchema)
  .handler(async ({ data }) => {
    const { deletePlayer } = await import('~/server/functions/players');
    return deletePlayer({ data });
  });

const updatePlayerStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePlayerStatusSchema)
  .handler(async ({ data }) => {
    const { updatePlayerStatus } = await import('~/server/functions/players');
    return updatePlayerStatus({ data });
  });

const addPlayerRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator(playerRelationshipSchema)
  .handler(async ({ data }) => {
    const { addPlayerRelationship } = await import('~/server/functions/players');
    return addPlayerRelationship({ data });
  });

const updatePlayerRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator(playerRelationshipSchema)
  .handler(async ({ data }) => {
    const { updatePlayerRelationship } = await import('~/server/functions/players');
    return updatePlayerRelationship({ data });
  });

const removePlayerRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator(removePlayerRelationshipSchema)
  .handler(async ({ data }) => {
    const { removePlayerRelationship } = await import('~/server/functions/players');
    return removePlayerRelationship({ data });
  });

const validateInviteCodeFn = createServerFn({ method: 'POST' })
  .inputValidator(validateInviteCodeSchema)
  .handler(async ({ data }) => {
    const { validateInviteCode } = await import('~/server/functions/players');
    return validateInviteCode({ data });
  });

const completeJoinWizardFn = createServerFn({ method: 'POST' })
  .inputValidator(completeJoinWizardSchema)
  .handler(async ({ data }) => {
    const { completeJoinWizard } = await import('~/server/functions/players');
    return completeJoinWizard({ data });
  });

const getActivePlayerSchema = z.object({
  campaignId: z.string().min(1),
});

const getActivePlayerFn = createServerFn({ method: 'GET' })
  .inputValidator(getActivePlayerSchema)
  .handler(async ({ data }) => {
    const { getActivePlayer } = await import('~/server/functions/players');
    return getActivePlayer({ data });
  });

// ---------------------------------------------------------------------------
// Query Hooks
// ---------------------------------------------------------------------------

export function usePlayers(campaignId: string, search?: string) {
  const {
    data: players = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.players.list(campaignId, search),
    queryFn: () =>
      listPlayersFn({
        data: {
          campaignId,
          search,
        },
      }),
    enabled: !!campaignId,
  });

  return {
    players: players as PlayerListItem[],
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function usePlayer(id: string, campaignId: string) {
  const {
    data: player = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.players.detail(id, campaignId),
    queryFn: () => getPlayerFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    player: player as PlayerData | null,
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function useActivePlayer(campaignId: string) {
  const {
    data: player = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.players.active(campaignId),
    queryFn: () => getActivePlayerFn({ data: { campaignId } }),
    enabled: !!campaignId,
  });

  return {
    player: player as PlayerData | null,
    isLoading,
    error: extractErrorMessage(error),
  };
}

// ---------------------------------------------------------------------------
// Mutation Hooks
// ---------------------------------------------------------------------------

interface UpdatePlayerInput {
  id: string;
  campaignId: string;
  firstName: string;
  lastName: string;
  race: string;
  characterClass: string;
  age: number;
  gender?: string;
  location?: string;
  link?: string;
  picture?: string;
  pictureCrop?: { x: number; y: number; width: number; height: number } | null;
  description?: string;
  backstory?: string;
  gmNotes?: string;
  color?: string;
  eyeColor?: string;
  hairColor?: string;
  weight?: number | null;
  height?: string;
  size?: string;
  appearance?: string;
}

export const useUpdatePlayer = createMutationHook({
  actionName: 'update',
  mutationFn: async (input: UpdatePlayerInput) => updatePlayerFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['players', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.active(variables.campaignId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
  },
  errorContext: (variables) => ({ action: 'updatePlayer', playerId: variables.id }),
});

interface DeletePlayerInput {
  id: string;
  campaignId: string;
}

export const useDeletePlayer = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: DeletePlayerInput) => deletePlayerFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['players', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.removeQueries({
      queryKey: queryKeys.players.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.active(variables.campaignId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
  },
  errorContext: (variables) => ({ action: 'deletePlayer', playerId: variables.id }),
});

interface UpdatePlayerStatusInput {
  id: string;
  campaignId: string;
  value: 'alive' | 'deceased';
}

export const useUpdatePlayerStatus = createMutationHook({
  actionName: 'updateStatus',
  mutationFn: async (input: UpdatePlayerStatusInput) => updatePlayerStatusFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['players', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.active(variables.campaignId),
    });
  },
  errorContext: (variables) => ({ action: 'updatePlayerStatus', playerId: variables.id }),
});

interface AddPlayerRelationshipInput {
  playerId: string;
  campaignId: string;
  characterId: string;
  descriptor: string;
  isPublic?: boolean;
}

export const useAddPlayerRelationship = createMutationHook({
  actionName: 'addRelationship',
  mutationFn: async (input: AddPlayerRelationshipInput) => addPlayerRelationshipFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.detail(variables.playerId, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.active(variables.campaignId),
    });
  },
  errorContext: (variables) => ({
    action: 'addPlayerRelationship',
    playerId: variables.playerId,
  }),
});

interface UpdatePlayerRelationshipInput {
  playerId: string;
  campaignId: string;
  characterId: string;
  descriptor: string;
  isPublic?: boolean;
}

export const useUpdatePlayerRelationship = createMutationHook({
  actionName: 'updateRelationship',
  mutationFn: async (input: UpdatePlayerRelationshipInput) =>
    updatePlayerRelationshipFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.detail(variables.playerId, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.active(variables.campaignId),
    });
  },
  errorContext: (variables) => ({
    action: 'updatePlayerRelationship',
    playerId: variables.playerId,
  }),
});

interface RemovePlayerRelationshipInput {
  playerId: string;
  campaignId: string;
  characterId: string;
}

export const useRemovePlayerRelationship = createMutationHook({
  actionName: 'removeRelationship',
  mutationFn: async (input: RemovePlayerRelationshipInput) =>
    removePlayerRelationshipFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.detail(variables.playerId, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.players.active(variables.campaignId),
    });
  },
  errorContext: (variables) => ({
    action: 'removePlayerRelationship',
    playerId: variables.playerId,
  }),
});

interface ValidateInviteCodeInput {
  inviteCode: string;
}

export const useValidateInviteCode = createMutationHook({
  actionName: 'validate',
  mutationFn: async (input: ValidateInviteCodeInput) => validateInviteCodeFn({ data: input }),
  errorContext: () => ({ action: 'validateInviteCode' }),
});

interface CompleteJoinWizardInput {
  campaignId: string;
  player: {
    firstName: string;
    lastName: string;
    race: string;
    characterClass: string;
    age: number;
    gender?: string;
    location?: string;
    link?: string;
    picture?: string;
    pictureCrop?: { x: number; y: number; width: number; height: number } | null;
    description?: string;
    backstory?: string;
    color?: string;
    eyeColor?: string;
    hairColor?: string;
    weight?: number | null;
    height?: string;
    size?: string;
    appearance?: string;
  };
  characters?: Array<{
    firstName: string;
    lastName: string;
    race?: string;
    characterClass?: string;
    age?: number | null;
    location?: string;
    link?: string;
    picture?: string;
    pictureCrop?: { x: number; y: number; width: number; height: number } | null;
    notes?: string;
    gmNotes?: string;
    tags?: string[];
    isPublic?: boolean;
    relationship: {
      descriptor: string;
      isPublic?: boolean;
    };
  }>;
}

export const useCompleteJoinWizard = createMutationHook({
  actionName: 'complete',
  mutationFn: async (input: CompleteJoinWizardInput) => completeJoinWizardFn({ data: input }),
  onSuccess: (queryClient) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
  },
  errorContext: () => ({ action: 'completeJoinWizard' }),
});
