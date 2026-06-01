import type { MouseEvent } from 'react';
import { Monitor } from 'lucide-react';
import { useTabletopScreenList, useTabletopMutations } from '~/hooks/useTabletopScreens';

interface ShowOnTabletopButtonProps {
  campaignId: string;
  collection: string;
  documentId: string;
  /** Only rendered when true — the GM gate. */
  isGM: boolean;
}

/**
 * GM-only button that opens a wiki item as a window on the first available
 * tabletop screen. Designed to be dropped into any wiki view-modal header or
 * card action area.
 *
 * Phase 1: targets the first screen in the list. A screen-picker can be added
 * in a later phase if the GM has multiple screens.
 */
export function ShowOnTabletopButton({
  campaignId,
  collection,
  documentId,
  isGM,
}: ShowOnTabletopButtonProps) {
  const { screens } = useTabletopScreenList(campaignId);
  const mutations = useTabletopMutations(campaignId);

  if (!isGM) return null;

  // Phase 1: use the first screen. If there are no screens yet the button is
  // rendered but disabled so the GM can see the affordance.
  const targetScreenId = screens[0]?.id ?? null;

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // prevent bubbling to parent click handlers
    if (!targetScreenId) return;
    mutations.openWindow.mutate({
      screenId: targetScreenId,
      collection,
      documentId,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!targetScreenId || mutations.openWindow.isPending}
      title={targetScreenId ? 'Show on Tabletop' : 'No tabletop screen available'}
      aria-label="Show on Tabletop"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-teal-400 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Monitor className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Show on Tabletop</span>
    </button>
  );
}
