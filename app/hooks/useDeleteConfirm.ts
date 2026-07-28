import { useState } from 'react';

export interface DeleteConfirmState<T> {
  /** The item awaiting confirmation, or `undefined` when no dialog is open. */
  pendingDelete: T | undefined;
  /** User-facing message set when the last delete attempt failed. */
  deleteError: string | null;
  /** Open the confirm dialog for `item`. */
  requestDelete: (item: T) => void;
  /** Dismiss the confirm dialog without deleting. */
  cancelDelete: () => void;
  /** Run the delete; closes the dialog on success, surfaces `errorMessage` on failure. */
  confirmDelete: () => Promise<void>;
}

/**
 * Shared confirm-then-delete state for the wiki panels.
 *
 * A failed delete must never close the dialog as though it worked — the card
 * would still be sitting in the list and the user would read that as a broken
 * UI. The two delete shapes in the wiki both need handling:
 *
 *   - hooks built by `createMutationHook` swallow the error and resolve to
 *     `null` (they report to GlitchTip, which tells developers, not users)
 *   - `useMonsterMutations.remove` is a raw mutation whose `mutateAsync`
 *     *rejects* instead
 *
 * Both are failures. `null` and a rejection both keep the dialog open and set
 * `deleteError`; any other resolved value (including `undefined`) is a success.
 */
export function useDeleteConfirm<T>(
  remove: (item: T) => Promise<unknown>,
  errorMessage: string
): DeleteConfirmState<T> {
  const [pendingDelete, setPendingDelete] = useState<T | undefined>();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requestDelete = (item: T) => {
    setDeleteError(null);
    setPendingDelete(item);
  };

  const cancelDelete = () => {
    setPendingDelete(undefined);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);

    let succeeded: boolean;
    try {
      succeeded = (await remove(pendingDelete)) !== null;
    } catch {
      // Already reported by the mutation hook's own onError.
      succeeded = false;
    }

    if (succeeded) {
      setPendingDelete(undefined);
    } else {
      setDeleteError(errorMessage);
    }
  };

  return { pendingDelete, deleteError, requestDelete, cancelDelete, confirmDelete };
}
