import { useParams, useSearch } from '@tanstack/react-router';
import { Edit2, Monitor, Trash2, Radio } from 'lucide-react';
import { createElement } from 'react';
import type { MenuItem } from '~/components/shared/OverflowMenu';
import { useCampaign } from '~/hooks/useCampaigns';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';
import {
  useTabletopScreenList,
  useTabletopScreenDetail,
  useTabletopMutations,
} from '~/hooks/useTabletopScreens';
import { useGMScreenList, useGMScreenDetail } from '~/hooks/useGMScreens';

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
 * Reads the main-view tab from the router rather than taking it as a prop: the
 * prop chain from play.tsx dead-ends at MainView, and the panels already reach
 * for the router directly (see WikiPanel/MapsPanel).
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
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { tab } = useSearch({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const { screens: tabletopScreens } = useTabletopScreenList(campaignId);
  const { screens: gmScreens } = useGMScreenList(campaignId);
  const tabletopMutations = useTabletopMutations(campaignId);
  const { playerState, addPrivateWindow } = useTabletopPlayerState(campaignId);

  // Hoist the target screen ids so the detail hooks can run unconditionally
  // (hooks can't live inside the branches below). Both mirror the persisted
  // active screen with a first-screen fallback for a fresh campaign, exactly
  // as the display-action branches do.
  const tabletopScreenId = playerState?.activeScreenId ?? tabletopScreens[0]?.id ?? null;
  const gmScreenId = playerState?.activeGMScreenId ?? gmScreens[0]?.id ?? null;

  // The SHARED window lists for each surface (everyone-visible windows). Needed
  // so a display action dedups across BOTH the caller's private windows AND the
  // shared windows — opening the same item twice (in either form) must instead
  // focus the one that's already there.
  const { screen: tabletopScreen } = useTabletopScreenDetail(campaignId, tabletopScreenId);
  const { screen: gmScreen } = useGMScreenDetail(campaignId, gmScreenId);

  // Is this exact item (collection + documentId) already open on a given
  // surface+screen, in EITHER the caller's private list OR the shared list?
  const isAlreadyOpen = (
    surf: 'tabletop' | 'gmscreen',
    sid: string | null,
    sharedWindows: Array<{ collection: string; documentId: string }>
  ) =>
    !!sid &&
    ((playerState?.privateWindows ?? []).some(
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

  // Which surface is the user looking at? Dashboard has no surface, so both
  // display actions are hidden there.
  const surface = tab === 'tabletop' ? 'tabletop' : tab === 'gmscreens' ? 'gmscreen' : null;

  if (surface) {
    // The target screen for this surface (already hoisted above with the
    // first-screen fallback for a fresh campaign — see tabletopScreenId).
    const screenId = surface === 'tabletop' ? tabletopScreenId : gmScreenId;
    // The shared window list for the surface we're looking at.
    const sharedWindows =
      (surface === 'tabletop' ? tabletopScreen?.windows : gmScreen?.windows) ?? [];

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
        addPrivateWindow.mutate({ surface, screenId, collection, documentId });
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
        if (isAlreadyOpen('tabletop', tabletopScreenId, tabletopScreen?.windows ?? [])) {
          focusExistingWindow('tabletop', collection, documentId);
          return;
        }
        tabletopMutations.openWindow.mutate({
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

/**
 * Ask the active surface to bring an already-open window forward. Implemented
 * as a window event so the wiki (Inspector subtree) can reach TabletopView /
 * GMScreensView without shared state — the same bridge pattern the dice roller
 * uses (see app/utils/diceRollerBridge.ts).
 */
function focusExistingWindow(
  surface: 'tabletop' | 'gmscreen',
  collection: string,
  documentId: string
) {
  window.dispatchEvent(
    new CustomEvent('cartyx:focus-window', { detail: { surface, collection, documentId } })
  );
}
