import { Monitor } from 'lucide-react';
import { useWikiCardActions } from '~/hooks/useWikiCardActions';

interface ShowOnTabletopButtonProps {
  campaignId: string;
  collection: string;
  documentId: string;
  /** Only rendered when true — the GM gate. */
  isGM: boolean;
}

/**
 * GM-only button that opens a wiki item as a window on the tabletop's active
 * screen (falling back to the first screen only on first visit, before any
 * screen has been made active). Designed to be dropped into any wiki
 * view-modal header or card action area.
 *
 * Delegates to useWikiCardActions' `push` action so this button and the
 * wiki-card overflow menu share one implementation. `allowPushFromDashboard`
 * is set because this button is also reachable from Dashboard widgets
 * (PartyMembersWidget/KeyAlliesWidget view-modals), not just the
 * Tabletop/GM Screens tabs the menu normally gates on.
 */
export function ShowOnTabletopButton({
  campaignId: _campaignId,
  collection,
  documentId,
  isGM,
}: ShowOnTabletopButtonProps) {
  const { menuItems } = useWikiCardActions({
    collection,
    documentId,
    allowPushFromDashboard: true,
  });
  const push = menuItems.find((item) => item.key === 'push');

  if (!isGM || !push) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // prevent bubbling to parent click handlers
        push.onSelect();
      }}
      disabled={push.disabled}
      title={push.title}
      aria-label="Show on Tabletop"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-teal-400 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Monitor className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Show on Tabletop</span>
    </button>
  );
}
