import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

/**
 * Shared form-lifecycle scaffolding for the wiki edit/create modals
 * (characters / players / races). These modals all repeated the same
 * mechanical lifecycle, independent of their field sets:
 *
 *   - reset every form field when the modal opens or the edited record's id
 *     changes (clears stale values from a previously-edited record)
 *   - populate the fields once the fetched record resolves in edit mode
 *   - track `hasSubmitted` / `fieldErrors`, and re-run validation on every
 *     change *after* the first submit attempt so errors update live
 *   - close on the Escape key, with the listener active only while the modal
 *     is open (so it does not interfere with other dialogs)
 *
 * The hook owns only that lifecycle. The fields themselves stay in the
 * component as ordinary `useState`, because each modal has a different field
 * set; the hook is told how to reset/populate them via callbacks. This keeps
 * the abstraction thin and behavior-preserving — it removes the duplicated
 * wiring, not the per-modal specifics.
 *
 * `reset` and `populate` are read through refs so the reset/populate effects
 * can key off the exact same triggers as the original hand-written effects
 * (`[recordId, isOpen]` and `[isEdit, record]`) without re-running on every
 * render just because the caller passes fresh inline closures.
 *
 * @typeParam TErrors  the modal's field-error shape (e.g. `{ firstName?: string }`)
 * @typeParam TRecord  the fetched record shape used to populate in edit mode
 */
export interface UseModalFormOptions<TErrors extends object, TRecord> {
  /** Whether the modal is currently open. Gates the reset and Escape listener. */
  isOpen: boolean;
  /** Called to close the modal (Escape key, etc.). */
  onClose: () => void;
  /**
   * Identity of the record being edited (undefined in create mode). A change
   * to this value re-triggers the reset, exactly like the hand-written
   * `[recordId, isOpen]` reset effects.
   */
  recordId?: string;
  /** True in edit mode. Gates population. */
  isEdit: boolean;
  /** The fetched record, or null/undefined until it resolves. */
  record: TRecord | null | undefined;
  /** Clears every form field back to its create-mode default. */
  reset: () => void;
  /** Copies values out of the resolved record into the form fields. */
  populate: (record: TRecord) => void;
  /** Pure validator returning the current field-error map. */
  validate: () => TErrors;
}

export interface UseModalFormResult<TErrors extends object> {
  fieldErrors: TErrors;
  setFieldErrors: Dispatch<SetStateAction<TErrors>>;
  hasSubmitted: boolean;
  setHasSubmitted: Dispatch<SetStateAction<boolean>>;
  /**
   * Marks the form as submitted, runs `validate`, stores the result in
   * `fieldErrors`, and returns the error map. Callers check whether it is
   * empty to decide whether to proceed.
   */
  runValidation: () => TErrors;
}

export function useModalForm<TErrors extends object, TRecord>({
  isOpen,
  onClose,
  recordId,
  isEdit,
  record,
  reset,
  populate,
  validate,
}: UseModalFormOptions<TErrors, TRecord>): UseModalFormResult<TErrors> {
  const [fieldErrors, setFieldErrors] = useState<TErrors>({} as TErrors);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Keep the latest reset/populate callbacks without making them effect deps —
  // they are recreated every render by callers, but the effects must only fire
  // on the original triggers.
  const resetRef = useRef(reset);
  const populateRef = useRef(populate);
  resetRef.current = reset;
  populateRef.current = populate;

  // Close on Escape key — only active when the modal is open so it does not
  // interfere with other dialogs.
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Reset form when opening or switching records — clears stale values and the
  // submit/error state. Mirrors the hand-written `[recordId, isOpen]` effects.
  useEffect(() => {
    resetRef.current();
    setFieldErrors({} as TErrors);
    setHasSubmitted(false);
  }, [recordId, isOpen]);

  // Populate form once the fetched record resolves in edit mode.
  useEffect(() => {
    if (isEdit && record) {
      populateRef.current(record);
    }
  }, [isEdit, record]);

  // Re-validate on every change once the user has attempted a submit, so errors
  // update live.
  useEffect(() => {
    if (hasSubmitted) setFieldErrors(validate());
  }, [hasSubmitted, validate]);

  const runValidation = useCallback((): TErrors => {
    setHasSubmitted(true);
    const errors = validate();
    setFieldErrors(errors);
    return errors;
  }, [validate]);

  return {
    fieldErrors,
    setFieldErrors,
    hasSubmitted,
    setHasSubmitted,
    runValidation,
  };
}
