import { Edit2, Monitor, Trash2, Radio } from 'lucide-react';
import { createElement } from 'react';
import type { MenuItem } from '~/components/shared/OverflowMenu';
import { useWikiCardActionsContext } from '~/components/wiki/shared/WikiCardActionsProvider';
import { canHydratePrivately } from '~/types/windowVisibility';

interface UseWikiCardActionsParams {
  collection: string;
  documentId: string;
  /** Per-item edit right from the list DTO. Absent means "not editable here". */
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  /**
   * Who may delete this item. Omit for the wiki default (GM-only delete). Pass
   * an explicit value for collections with a different rule — e.g. notes are
   * creator-only for delete (a GM has no rights on someone else's note), so the
   * notes panel passes `canDelete={note.canEdit}`.
   */
  canDelete?: boolean;
  /**
   * Offer "Push to Tabletop" even when there's no surface (e.g. the
   * Dashboard tab). Push always targets the tabletop's active screen
   * regardless of this flag — it only changes whether the item is offered
   * outside the Tabletop/GM Screens tabs. "Show on Tab" is unaffected: it
   * still requires a real surface, since there's nothing to "show here" on
   * the Dashboard.
   */
  allowPushFromDashboard?: boolean;
}

/**
 * Builds the overflow-menu items for a wiki card.
 *
 * Two distinct display actions:
 *  - "Show on Tab"      — private to the caller, any member, current tab.
 *  - "Push to Tabletop" — shared with everyone, GM only, ALWAYS the tabletop.
 *
 * The SHARED inputs (surface, screen ids, window lists, mutations) come from
 * WikiCardActionsProvider via context — computed ONCE for the whole Inspector
 * subtree — so the ~50 cards and ~15 ShowOnTabletopButton modals no longer each
 * subscribe to the campaign's hot React Query caches or register their own
 * mutation observers. This hook only applies the per-card gating on top.
 */
export function useWikiCardActions({
  collection,
  documentId,
  canEdit,
  onEdit,
  onDelete,
  canDelete,
  allowPushFromDashboard = false,
}: UseWikiCardActionsParams): { menuItems: MenuItem[] } {
  const {
    isGM,
    surface,
    tabletopScreenId,
    gmScreenId,
    privateWindows,
    tabletopSharedWindows,
    gmSharedWindows,
    openWindowMutate,
    addPrivateWindowMutate,
    focusExistingWindow,
  } = useWikiCardActionsContext();

  // Is this exact item (collection + documentId) already open on a given
  // surface+screen, in EITHER the caller's private list OR the shared list?
  const isAlreadyOpen = (
    surf: 'tabletop' | 'gmscreen',
    sid: string | null,
    sharedWindows: Array<{ collection: string; documentId: string }>
  ) =>
    !!sid &&
    (privateWindows.some(
      (pw) =>
        pw.surface === surf &&
        pw.screenId === sid &&
        pw.collection === collection &&
        pw.documentId === documentId
    ) ||
      sharedWindows.some((w) => w.collection === collection && w.documentId === documentId));

  const items: MenuItem[] = [];

  if (canEdit && onEdit) {
    items.push({
      key: 'edit',
      label: 'Edit',
      icon: createElement(Edit2, { className: 'h-3.5 w-3.5' }),
      onSelect: onEdit,
    });
  }

  // Some collections are never private-window-able by a non-GM — `note` most
  // visibly, since a player's own notes are listed to them with a full menu.
  // The server rejects those outright, so offering the item would just produce
  // a hard error and a GlitchTip report on a button the user was invited to
  // press. Same predicate on both sides, so they cannot drift.
  if (surface && canHydratePrivately(collection, isGM)) {
    // The target screen for this surface (existence-checked in the provider,
    // with the first-screen fallback for a fresh campaign).
    const screenId = surface === 'tabletop' ? tabletopScreenId : gmScreenId;
    // The shared window list for the surface we're looking at.
    const sharedWindows = surface === 'tabletop' ? tabletopSharedWindows : gmSharedWindows;

    items.push({
      key: 'show-on-tab',
      label: 'Show on Tab',
      icon: createElement(Monitor, { className: 'h-3.5 w-3.5' }),
      disabled: !screenId,
      title: screenId ? 'Show here — only you will see it' : 'No screen available',
      onSelect: () => {
        if (!screenId) return;
        // Already open on this tab in EITHER form (your private window OR a
        // shared one): the surface focuses + flashes it; nothing to add.
        if (isAlreadyOpen(surface, screenId, sharedWindows)) {
          focusExistingWindow(surface, collection, documentId);
          return;
        }
        addPrivateWindowMutate({ surface, screenId, collection, documentId });
      },
    });
  }

  // Push is GM-only and ALWAYS targets the tabletop, even from GM Screens
  // (or the Dashboard, when the caller opts in via allowPushFromDashboard).
  if (isGM && (surface || allowPushFromDashboard)) {
    items.push({
      key: 'push',
      label: 'Push to Tabletop',
      icon: createElement(Radio, { className: 'h-3.5 w-3.5' }),
      disabled: !tabletopScreenId,
      title: tabletopScreenId
        ? 'Show on the tabletop for everyone'
        : 'No tabletop screen available',
      onSelect: () => {
        if (!tabletopScreenId) return;
        // Already on the tabletop in EITHER form (a shared window the server
        // would dedup anyway, OR your own private window it wouldn't): focus the
        // existing one and DON'T open a second. No promotion — a private window
        // stays private.
        if (isAlreadyOpen('tabletop', tabletopScreenId, tabletopSharedWindows)) {
          focusExistingWindow('tabletop', collection, documentId);
          return;
        }
        openWindowMutate({
          screenId: tabletopScreenId,
          collection,
          documentId,
        });
      },
    });
  }

  // Delete defaults to GM-only (the wiki rule); a caller can override with an
  // explicit canDelete for collections with a different rule (e.g. notes).
  if ((canDelete ?? isGM) && onDelete) {
    items.push({
      key: 'delete',
      label: 'Delete',
      icon: createElement(Trash2, { className: 'h-3.5 w-3.5' }),
      danger: true,
      onSelect: onDelete,
    });
  }

  return { menuItems: items };
}
