import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { useCampaign } from '~/hooks/useCampaigns';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';
import {
  useTabletopScreenList,
  useTabletopScreenDetail,
  useTabletopMutations,
} from '~/hooks/useTabletopScreens';
import { useGMScreenList, useGMScreenDetail } from '~/hooks/useGMScreens';
import type { PrivateWindowData } from '~/types/tabletop';

/** A window as far as card-action dedup cares: identity is collection+documentId. */
type SharedWindow = { collection: string; documentId: string };

type OpenWindowMutate = ReturnType<typeof useTabletopMutations>['openWindow']['mutate'];
type AddPrivateWindowMutate = ReturnType<
  typeof useTabletopPlayerState
>['addPrivateWindow']['mutate'];

export interface WikiCardActionsContextValue {
  campaignId: string;
  isGM: boolean;
  /** The surface the user is looking at; Dashboard/Maps have none. */
  surface: 'tabletop' | 'gmscreen' | null;
  /** Existence-checked active screen ids (persisted id only if it still exists). */
  tabletopScreenId: string | null;
  gmScreenId: string | null;
  /** The caller's private windows (from player state). */
  privateWindows: PrivateWindowData[];
  /** Everyone-visible windows for each surface (empty unless that detail is fetched). */
  tabletopSharedWindows: SharedWindow[];
  gmSharedWindows: SharedWindow[];
  /** Referentially-stable React Query mutate fns. */
  openWindowMutate: OpenWindowMutate;
  addPrivateWindowMutate: AddPrivateWindowMutate;
  /** Ask the active surface to bring an already-open window forward. */
  focusExistingWindow: (
    surface: 'tabletop' | 'gmscreen',
    collection: string,
    documentId: string
  ) => void;
}

/**
 * Exported only so `WikiCardActionsStubProvider` can supply a fixed value in
 * Storybook, where the real provider cannot mount (it reads
 * `useParams({ from: '/campaigns/$campaignId/play' })`). App code should always
 * go through `WikiCardActionsProvider` / `useWikiCardActionsContext`.
 */
export const WikiCardActionsContext = createContext<WikiCardActionsContextValue | null>(null);

// Stable empty fallbacks so the memoized value stays referentially stable while
// the underlying queries have no data (null screen / null player state).
const EMPTY_PRIVATE: PrivateWindowData[] = [];
const EMPTY_SHARED: SharedWindow[] = [];

/**
 * Computes the shared wiki-card-action data ONCE for the whole Inspector subtree
 * and exposes it via context, so the ~50 wiki/note cards and ~15
 * ShowOnTabletopButton modals no longer each subscribe to the campaign's hot
 * React Query caches (player state, two screen lists, two screen details) and
 * register their own mutation observers. See useWikiCardActions for the per-card
 * gating that reads this value.
 */
export function WikiCardActionsProvider({ children }: { children: ReactNode }) {
  const { campaignId } = useParams({ from: '/campaigns/$campaignId/play' });
  const { tab } = useSearch({ from: '/campaigns/$campaignId/play' });
  const { campaign } = useCampaign(campaignId);
  const isGM = campaign?.isGM ?? false;

  const { screens: tabletopScreens } = useTabletopScreenList(campaignId);
  // GM-gated: listGMScreens is requireCampaignGM, so for a player this query can
  // only ever throw Forbidden — once per play-page load, each one a GlitchTip
  // error, all of it swallowed here since we only read `screens`. Players have
  // no GM screens to target anyway, so gmScreenId simply stays null for them.
  const { screens: gmScreens } = useGMScreenList(campaignId, { enabled: isGM });
  const tabletopMutations = useTabletopMutations(campaignId);
  const { playerState, addPrivateWindow } = useTabletopPlayerState(campaignId);

  // Existence-checked active screen ids: use the PERSISTED active screen only if
  // it still exists in the current list (a deleted-but-non-null id would target a
  // phantom screen through a bare `??`); otherwise fall back to the first screen
  // (fresh-campaign first-visit case). Mirrors GMScreensView / the old hook.
  const tabletopScreenId =
    playerState?.activeScreenId && tabletopScreens.some((s) => s.id === playerState.activeScreenId)
      ? playerState.activeScreenId
      : (tabletopScreens[0]?.id ?? null);
  const gmScreenId =
    playerState?.activeGMScreenId && gmScreens.some((s) => s.id === playerState.activeGMScreenId)
      ? playerState.activeGMScreenId
      : (gmScreens[0]?.id ?? null);

  // Which surface is the user looking at? Dashboard/Maps have no surface.
  //
  // The `&& isGM` mirrors play.tsx's `effectiveTab`, which coerces a non-GM away
  // from the GM-only tab. Reading the raw `tab` without it means a player who
  // lands on `?tab=gmscreens` sees the Dashboard while this provider believes
  // the surface is 'gmscreen' — and the card menus offer a permanently disabled
  // "Show on Tab" pointing at a surface that isn't on screen.
  const surface: 'tabletop' | 'gmscreen' | null =
    tab === 'tabletop' ? 'tabletop' : tab === 'gmscreens' && isGM ? 'gmscreen' : null;

  // Fetch a surface's detail ONLY when its shared window list will be read, else
  // pass null so `enabled: !!screenId` short-circuits the query. A provider can't
  // see a per-consumer `allowPushFromDashboard`, so tabletop detail is fetched
  // whenever it can be read from a surface tab (show-on-tab dedup on Tabletop, or
  // the GM-only Push branch on any surface). The `allowPushFromDashboard` modals
  // (PartyMembersWidget/KeyAlliesWidget) DO open on the Dashboard, where surface
  // is null and this detail isn't fetched — but that's harmless: the server
  // dedups Push, so the only thing skipped is the CLIENT-side "already open"
  // check that would focus/flash an existing window, which only matters when the
  // user is actually on the tabletop looking at it. Nothing regresses versus the
  // old per-card gating.
  const tabletopDetailId =
    surface === 'tabletop' || (isGM && surface !== null) ? tabletopScreenId : null;
  const gmDetailId = surface === 'gmscreen' ? gmScreenId : null;
  const { screen: tabletopScreen } = useTabletopScreenDetail(campaignId, tabletopDetailId);
  const { screen: gmScreen } = useGMScreenDetail(campaignId, gmDetailId);

  const privateWindows = playerState?.privateWindows ?? EMPTY_PRIVATE;
  const tabletopSharedWindows = tabletopScreen?.windows ?? EMPTY_SHARED;
  const gmSharedWindows = gmScreen?.windows ?? EMPTY_SHARED;

  const openWindowMutate = tabletopMutations.openWindow.mutate;
  const addPrivateWindowMutate = addPrivateWindow.mutate;

  // Implemented as a window event so the wiki (Inspector subtree) can reach
  // TabletopView / GMScreensView without shared state — the same bridge pattern
  // the dice roller uses (see app/utils/diceRollerBridge.ts).
  const focusExistingWindow = useCallback(
    (surf: 'tabletop' | 'gmscreen', collection: string, documentId: string) => {
      window.dispatchEvent(
        new CustomEvent('cartyx:focus-window', {
          detail: { surface: surf, collection, documentId, campaignId },
        })
      );
    },
    [campaignId]
  );

  const value = useMemo<WikiCardActionsContextValue>(
    () => ({
      campaignId,
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
    }),
    [
      campaignId,
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
    ]
  );

  return (
    <WikiCardActionsContext.Provider value={value}>{children}</WikiCardActionsContext.Provider>
  );
}

/**
 * Reads the shared wiki-card-action data. Throws if no provider is mounted, so a
 * missing provider fails loudly in tests rather than silently subscribing.
 */
export function useWikiCardActionsContext(): WikiCardActionsContextValue {
  const value = useContext(WikiCardActionsContext);
  if (value === null) {
    throw new Error('useWikiCardActionsContext must be used within a WikiCardActionsProvider');
  }
  return value;
}
