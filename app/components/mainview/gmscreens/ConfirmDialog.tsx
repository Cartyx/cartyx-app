/**
 * Moved to `~/components/shared/ConfirmDialog` — the wiki card overflow menus
 * need the same dialog, so it is no longer gmscreens-specific. This re-export
 * shim keeps the existing gmscreens importers (and its story) working.
 *
 * Prefer importing from `~/components/shared/ConfirmDialog` in new code.
 */
export { ConfirmDialog, type ConfirmDialogProps } from '~/components/shared/ConfirmDialog';
