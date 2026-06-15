import { createServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import type { CharacterData, CharacterListItem } from '~/types/character';
import { queryKeys } from '~/utils/queryKeys';
import { extractErrorMessage } from '~/utils/errors';
import { createMutationHook } from '~/hooks/createMutationHook';
import {
  listCharactersSchema,
  getCharacterSchema,
  createCharacterSchema,
  updateCharacterSchema,
  deleteCharacterSchema,
  updateCharacterStatusSchema,
  addCharacterRelationshipSchema,
  updateCharacterRelationshipSchema,
  removeCharacterRelationshipSchema,
} from '~/types/schemas/characters';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listCharactersFn = createServerFn({ method: 'GET' })
  .inputValidator(listCharactersSchema)
  .handler(async ({ data }) => {
    const { listCharacters } = await import('~/server/functions/characters');
    return listCharacters({ data });
  });

const getCharacterFn = createServerFn({ method: 'GET' })
  .inputValidator(getCharacterSchema)
  .handler(async ({ data }) => {
    const { getCharacter } = await import('~/server/functions/characters');
    return getCharacter({ data });
  });

const createCharacterFn = createServerFn({ method: 'POST' })
  .inputValidator(createCharacterSchema)
  .handler(async ({ data }) => {
    const { createCharacter } = await import('~/server/functions/characters');
    return createCharacter({ data });
  });

const updateCharacterFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCharacterSchema)
  .handler(async ({ data }) => {
    const { updateCharacter } = await import('~/server/functions/characters');
    return updateCharacter({ data });
  });

const deleteCharacterFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteCharacterSchema)
  .handler(async ({ data }) => {
    const { deleteCharacter } = await import('~/server/functions/characters');
    return deleteCharacter({ data });
  });

const updateCharacterStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCharacterStatusSchema)
  .handler(async ({ data }) => {
    const { updateCharacterStatus } = await import('~/server/functions/characters');
    return updateCharacterStatus({ data });
  });

const addCharacterRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator(addCharacterRelationshipSchema)
  .handler(async ({ data }) => {
    const { addCharacterRelationship } = await import('~/server/functions/characters');
    return addCharacterRelationship({ data });
  });

const updateCharacterRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCharacterRelationshipSchema)
  .handler(async ({ data }) => {
    const { updateCharacterRelationship } = await import('~/server/functions/characters');
    return updateCharacterRelationship({ data });
  });

const removeCharacterRelationshipFn = createServerFn({ method: 'POST' })
  .inputValidator(removeCharacterRelationshipSchema)
  .handler(async ({ data }) => {
    const { removeCharacterRelationship } = await import('~/server/functions/characters');
    return removeCharacterRelationship({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface ListCharactersFilters {
  sessionId?: string;
  search?: string;
  visibility?: 'all' | 'public' | 'private';
  tags?: string[];
}

export function useCharacters(campaignId: string, filters?: ListCharactersFilters) {
  const sessionId = filters?.sessionId;
  const search = filters?.search;
  const visibility = filters?.visibility;
  const tags = filters?.tags;

  const {
    data: characters = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.characters.list(campaignId, sessionId, search, visibility, tags),
    queryFn: () =>
      listCharactersFn({
        data: {
          campaignId,
          sessionId,
          search,
          visibility,
          tags,
        },
      }),
    enabled: !!campaignId,
  });

  return {
    characters: characters as CharacterListItem[],
    isLoading,
    error: extractErrorMessage(error),
  };
}

export function useCharacter(id: string, campaignId: string) {
  const {
    data: character = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.characters.detail(id, campaignId),
    queryFn: () => getCharacterFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    character: character as CharacterData | null,
    isLoading,
    error: extractErrorMessage(error),
  };
}

interface CreateCharacterInput {
  campaignId: string;
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
  sessionId?: string;
  sessions?: string[];
}

export const useCreateCharacter = createMutationHook({
  actionName: 'create',
  mutationFn: async (input: CreateCharacterInput) => createCharacterFn({ data: input }),
  onSuccess: (queryClient, _data, { campaignId }) => {
    queryClient.invalidateQueries({ queryKey: ['characters', 'list', campaignId], exact: false });
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
  },
  errorContext: () => ({ action: 'createCharacter' }),
});

interface UpdateCharacterInput {
  id: string;
  campaignId: string;
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
  sessionId?: string;
  sessions?: string[];
}

export const useUpdateCharacter = createMutationHook({
  actionName: 'update',
  mutationFn: async (input: UpdateCharacterInput) => updateCharacterFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['characters', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.id, variables.campaignId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(variables.campaignId) });
    // Refresh GM screen windows that may display this character's content
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
  },
  errorContext: (variables) => ({ action: 'updateCharacter', characterId: variables.id }),
});

interface DeleteCharacterInput {
  id: string;
  campaignId: string;
}

export const useDeleteCharacter = createMutationHook({
  actionName: 'remove',
  mutationFn: async (input: DeleteCharacterInput) => deleteCharacterFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['characters', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.removeQueries({
      queryKey: queryKeys.characters.detail(variables.id, variables.campaignId),
    });
    // Refresh GM screen windows — server removes refs for deleted characters
    queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
  },
  errorContext: (variables) => ({ action: 'deleteCharacter', characterId: variables.id }),
});

// ---------------------------------------------------------------------------
// useUpdateCharacterStatus
// ---------------------------------------------------------------------------

interface UpdateCharacterStatusInput {
  id: string;
  campaignId: string;
  value: 'alive' | 'deceased';
}

export const useUpdateCharacterStatus = createMutationHook({
  actionName: 'updateStatus',
  mutationFn: async (input: UpdateCharacterStatusInput) => updateCharacterStatusFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['characters', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.id, variables.campaignId),
    });
  },
  errorContext: (variables) => ({ action: 'updateCharacterStatus', characterId: variables.id }),
});

// ---------------------------------------------------------------------------
// useAddCharacterRelationship
// ---------------------------------------------------------------------------

interface AddCharacterRelationshipInput {
  characterId: string;
  campaignId: string;
  targetCharacterId: string;
  descriptor: string;
  reciprocalDescriptor: string;
  isPublic?: boolean;
}

export const useAddCharacterRelationship = createMutationHook({
  actionName: 'addRelationship',
  mutationFn: async (input: AddCharacterRelationshipInput) =>
    addCharacterRelationshipFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['characters', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.characterId, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.targetCharacterId, variables.campaignId),
    });
  },
  errorContext: (variables) => ({
    action: 'addCharacterRelationship',
    characterId: variables.characterId,
  }),
});

// ---------------------------------------------------------------------------
// useUpdateCharacterRelationship
// ---------------------------------------------------------------------------

interface UpdateCharacterRelationshipInput {
  characterId: string;
  campaignId: string;
  targetCharacterId: string;
  descriptor?: string;
  reciprocalDescriptor?: string;
  isPublic?: boolean;
}

export const useUpdateCharacterRelationship = createMutationHook({
  actionName: 'updateRelationship',
  mutationFn: async (input: UpdateCharacterRelationshipInput) =>
    updateCharacterRelationshipFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['characters', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.characterId, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.targetCharacterId, variables.campaignId),
    });
  },
  errorContext: (variables) => ({
    action: 'updateCharacterRelationship',
    characterId: variables.characterId,
  }),
});

// ---------------------------------------------------------------------------
// useRemoveCharacterRelationship
// ---------------------------------------------------------------------------

interface RemoveCharacterRelationshipInput {
  characterId: string;
  campaignId: string;
  targetCharacterId: string;
}

export const useRemoveCharacterRelationship = createMutationHook({
  actionName: 'removeRelationship',
  mutationFn: async (input: RemoveCharacterRelationshipInput) =>
    removeCharacterRelationshipFn({ data: input }),
  onSuccess: (queryClient, _data, variables) => {
    queryClient.invalidateQueries({
      queryKey: ['characters', 'list', variables.campaignId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.characterId, variables.campaignId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.characters.detail(variables.targetCharacterId, variables.campaignId),
    });
  },
  errorContext: (variables) => ({
    action: 'removeCharacterRelationship',
    characterId: variables.characterId,
  }),
});
