import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteData, NoteListItem } from '~/types/note';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listNotesSchema,
  getNoteSchema,
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
} from '~/types/schemas/notes';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// TanStack Start compiles these to RPC stubs on the client.
// ---------------------------------------------------------------------------

const listNotesFn = createServerFn({ method: 'GET' })
  .inputValidator(listNotesSchema)
  .handler(async ({ data }) => {
    const { listNotes } = await import('~/server/functions/notes');
    return listNotes({ data });
  });

const getNoteFn = createServerFn({ method: 'GET' })
  .inputValidator(getNoteSchema)
  .handler(async ({ data }) => {
    const { getNote } = await import('~/server/functions/notes');
    return getNote({ data });
  });

const createNoteFn = createServerFn({ method: 'POST' })
  .inputValidator(createNoteSchema)
  .handler(async ({ data }) => {
    const { createNote } = await import('~/server/functions/notes');
    return createNote({ data });
  });

const updateNoteFn = createServerFn({ method: 'POST' })
  .inputValidator(updateNoteSchema)
  .handler(async ({ data }) => {
    const { updateNote } = await import('~/server/functions/notes');
    return updateNote({ data });
  });

const deleteNoteFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteNoteSchema)
  .handler(async ({ data }) => {
    const { deleteNote } = await import('~/server/functions/notes');
    return deleteNote({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface ListNotesFilters {
  sessionId?: string;
  search?: string;
  visibility?: 'all' | 'public' | 'private';
  tags?: string[];
}

export function useNotes(campaignId: string, filters?: ListNotesFilters) {
  const sessionId = filters?.sessionId;
  const search = filters?.search;
  const visibility = filters?.visibility;
  const tags = filters?.tags;

  const {
    data: notes = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.notes.list(campaignId, sessionId, search, visibility, tags),
    queryFn: () =>
      listNotesFn({
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
    notes: notes as NoteListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useNote(id: string, campaignId: string) {
  const {
    data: note = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.notes.detail(id, campaignId),
    queryFn: () => getNoteFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });

  return {
    note: note as NoteData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

interface CreateNoteInput {
  campaignId: string;
  sessionId?: string;
  title: string;
  note: string;
  tags?: string[];
  isPublic?: boolean;
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateNoteInput) => createNoteFn({ data: input }),
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'list', campaignId], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => {
      captureException(e, { action: 'createNote' });
    },
  });

  const create = async (input: CreateNoteInput) => {
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

interface UpdateNoteInput {
  id: string;
  campaignId: string;
  sessionId?: string;
  title: string;
  note: string;
  tags?: string[];
  isPublic?: boolean;
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: UpdateNoteInput) => updateNoteFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['notes', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.notes.detail(variables.id, variables.campaignId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(variables.campaignId) });
      // Refresh GM screen windows that may display this note's content
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'updateNote', noteId: variables.id });
    },
  });

  const update = async (input: UpdateNoteInput) => {
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

interface DeleteNoteInput {
  id: string;
  campaignId: string;
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: DeleteNoteInput) => deleteNoteFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['notes', 'list', variables.campaignId],
        exact: false,
      });
      queryClient.removeQueries({
        queryKey: queryKeys.notes.detail(variables.id, variables.campaignId),
      });
      // Refresh GM screen windows — server removes refs for deleted notes
      queryClient.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'deleteNote', noteId: variables.id });
    },
  });

  const remove = async (input: DeleteNoteInput) => {
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
