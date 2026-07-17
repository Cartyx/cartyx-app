import { useParams, useSearch } from '@tanstack/react-router';
import { Edit2, Monitor, Trash2, Radio } from 'lucide-react';
import { createElement } from 'react';
import type { MenuItem } from '~/components/shared/OverflowMenu';
import { useCampaign } from '~/hooks/useCampaigns';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';
import { useTabletopScreenList, useTabletopMutations } from '~/hooks/useTabletopScreens';

interface UseWikiCardActionsParams {
  collection: string;
  documentId: string;
  /** Per-item edit right from the list DTO. Absent means "not editable here". */
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
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
}: UseWikiCardActionsParams): { menuItems: MenuItem[] } {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { tab } = useSearch({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const { screens } = useTabletopScreenList(campaignId);
  const tabletopMutations = useTabletopMutations(campaignId);
  const { playerState, addPrivateWindow } = useTabletopPlayerState(campaignId);

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
    const screenId =
      surface === 'tabletop' ? playerState?.activeScreenId : playerState?.activeGMScreenId;

    const alreadyPrivate = (playerState?.privateWindows ?? []).some(
      (pw) =>
        pw.surface === surface &&
        pw.screenId === screenId &&
        pw.collection === collection &&
        pw.documentId === documentId
    );

    items.push({
      key: 'show-on-tab',
      label: 'Show on Tab',
      icon: createElement(Monitor, { className: 'h-3.5 w-3.5' }),
      disabled: !screenId,
      title: screenId ? 'Show here — only you will see it' : 'No screen available',
      onSelect: () => {
        if (!screenId) return;
        // Already open: the surface focuses + flashes it; nothing to add.
        if (alreadyPrivate) {
          focusExistingWindow(surface, collection, documentId);
          return;
        }
        addPrivateWindow.mutate({ surface, screenId, collection, documentId });
      },
    });
  }

  // Push is GM-only and ALWAYS targets the tabletop, even from GM Screens.
  if (isGM && surface) {
    const tabletopScreenId = playerState?.activeScreenId ?? screens[0]?.id ?? null;
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
        tabletopMutations.openWindow.mutate({
          screenId: tabletopScreenId,
          collection,
          documentId,
        });
      },
    });
  }

  if (isGM && onDelete) {
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
function focusExistingWindow(surface: string, collection: string, documentId: string) {
  window.dispatchEvent(
    new CustomEvent('cartyx:focus-window', { detail: { surface, collection, documentId } })
  );
}
