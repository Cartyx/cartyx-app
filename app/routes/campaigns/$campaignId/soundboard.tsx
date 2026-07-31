import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { getMe } from '~/server/functions/rpc';
import { Topbar } from '~/components/Topbar';
import { BoardGrid } from '~/components/soundboard/BoardGrid';
import { MoodBar } from '~/components/soundboard/MoodBar';
import { MasterBar } from '~/components/soundboard/MasterBar';
import { useSoundboard } from '~/hooks/useSoundboard';
import { useCampaign } from '~/hooks/useCampaigns';
import {
  listPackagesFn,
  getPackageFn,
  listPackageAssetsFn,
  loadBoardStateFn,
} from '~/utils/soundboard-server-fns';
import { queryKeys } from '~/utils/queryKeys';
import type { AudioAssetData } from '~/types/audio';
import type { AudioPackageData, BoardStateData } from '~/types/soundboard';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A board with no package loaded genuinely has no assets, and `useSoundboard`
 * reads `assets: undefined` as "the query has not settled" and refuses to
 * build the engine. A module-level constant (rather than a fresh `[]` per
 * render) also keeps the hook's `assets` reference stable across renders.
 */
const NO_ASSETS: readonly AudioAssetData[] = [];

/**
 * Exported (not inlined into `createFileRoute`) so it is unit-testable without
 * depending on `createFileRoute`'s return shape — the convention
 * `audio_.packages.tsx` and `audio.tsx` already follow. Matches
 * `dashboard.tsx:6-12` exactly, per this task's brief: a session check and
 * nothing more.
 *
 * No campaign-membership or GM check here on purpose. `loadBoardStateFn`
 * requires membership and `saveBoardStateFn` requires GM, both enforced
 * server-side inside `~/server/functions/soundboard` via
 * `requireCampaignMember` — duplicating either here would create a second
 * copy that can drift from the one that actually protects the data. What the
 * route does with GM-ness is an OPTIMISATION, not a boundary: `persist` below
 * suppresses writes it knows will be rejected, so a non-GM does not emit a
 * guaranteed-failing save (and a GlitchTip event) on every single command.
 */
export async function soundboardBeforeLoad() {
  const user = await getMe();
  if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
  return { user };
}

// FILENAME: `app/routes/campaigns/$campaignId/soundboard.tsx` — a plain file in
// the EXISTING `campaigns/$campaignId/` directory, with no trailing-underscore
// care of the kind Tasks 13/14 needed.
//
// Verified from the generated tree rather than assumed, because assuming is
// what bit both of those tasks. There is no `app/routes/campaigns/$campaignId.tsx`
// beside this directory, so no file can be turned into a pathless layout by
// adding a child to it — which is the entire hazard the underscore exists to
// avoid. `routeTree.gen.ts` already carries three siblings generated from this
// same directory (`edit`, `play`, `sessions`), every one of them with
// `getParentRoute: () => rootRouteImport` and a full flat path, and this file
// regenerates as a fourth of exactly that shape.
export const Route = createFileRoute('/campaigns/$campaignId/soundboard')({
  beforeLoad: soundboardBeforeLoad,
  component: SoundboardPage,
});

/**
 * The in-campaign GM board — the surface everything else in this phase feeds.
 *
 * This outer component owns every query and NOTHING else. `useSoundboard` and
 * the board controls live in `BoardSurface` below, which is `key`ed so that
 * clearing the board genuinely unmounts it — see `boardGeneration`.
 *
 * The four query results and where each goes:
 *
 * 1. **`loadBoardStateFn` → `initialState`** — the hydrate seam. The hook
 *    applies it directly instead of replaying commands: a replay of `setMood`
 *    + per-item `play` cannot express an item the mood names but the GM had
 *    STOPPED (`setMood` resolves it back to playing), and a replay would also
 *    re-save what it just read, making "opened the board" the last write to
 *    `updatedBy`. Forgetting this key is the SILENT failure — the hook cannot
 *    tell "forgot" from "this board does not hydrate", so the board would
 *    never restore and the `[pkg]` effect's `loadPackage` would overwrite the
 *    persisted board with a blank one, logging nothing anywhere.
 * 2. **`getPackageFn` → `pkg` + `packagePending`** — passing `packagePending:
 *    false` while the query is still running concludes hydration against
 *    `pkg === null`; the `[pkg]` effect then arms a prompt-urgency write of a
 *    blank board and DURABLY destroys the persisted `moodId` and every item's
 *    `playing`/`volume`.
 * 3. **`listPackageAssetsFn` → `assets`** — Task 21's package-scoped read,
 *    never `listAudioAssetsFn`. The library list is owner-scoped and
 *    cursor-paginated at 50 while a package holds up to 64 items; the engine
 *    caches a failed load as unplayable for its whole lifetime, so a package
 *    straddling that boundary gets permanently dead pads.
 * 4. **`getCampaignFn` → `persist`** — see `BoardSurface`, which refuses to
 *    render any dispatching control until this one has settled.
 */
export function SoundboardPage() {
  const { campaignId } = Route.useParams();
  const { campaign, isLoading: campaignLoading, error: campaignError } = useCampaign(campaignId);

  // --- the persisted board -------------------------------------------------
  const boardQuery = useQuery({
    queryKey: queryKeys.soundboard.boardState(campaignId),
    queryFn: () => loadBoardStateFn({ data: { campaignId } }),
  });

  // --- the package picker --------------------------------------------------
  const packagesQuery = useQuery({
    queryKey: queryKeys.packages.list(),
    queryFn: () => listPackagesFn(),
  });
  const packages = useMemo(() => packagesQuery.data?.items ?? [], [packagesQuery.data]);

  /**
   * THREE states, not two, and the distinction is load-bearing:
   *
   * - `undefined` — the GM has not picked anything this session; the persisted
   *   package is what loads.
   * - `null` — the GM explicitly chose "— none —". The board is cleared.
   * - a string — the GM picked that package.
   *
   * Collapsing the first two into `null` (which is what this was) makes
   * "— none —" a no-op: it falls straight back through `??` to the persisted
   * package and the board never clears.
   */
  const [pickedPackageId, setPickedPackageId] = useState<string | null | undefined>(undefined);
  const packageId =
    pickedPackageId !== undefined ? pickedPackageId : (boardQuery.data?.packageId ?? null);
  const clearedByGM = pickedPackageId === null;

  /**
   * Bumped ONLY when the GM clears the board, and used as `BoardSurface`'s
   * `key`, so clearing remounts the whole soundboard.
   *
   * A remount is the documented requirement, not a stylistic choice:
   * `useSoundboard`'s `[pkg]` effect does `if (pkg) dispatch(loadPackage)`, so
   * `pkg` going null dispatches NOTHING — the previous package stays in
   * `BoardState`, its items keep playing with no pads on screen to stop them,
   * and `toBoardStatePayload` keeps persisting the old `packageId` so the
   * clear does not even survive a reload. The hook's own comment says as much:
   * "There is no command for unloading … Task 17 should unmount the board
   * instead."
   *
   * Keyed on an explicit counter rather than on `packageId` so that switching
   * BETWEEN packages does not remount: that path is handled correctly by the
   * `[pkg]` effect, and a remount there would tear down the `AudioContext` and
   * force the GM to re-do the enable-audio gesture mid-session.
   */
  const [boardGeneration, setBoardGeneration] = useState(0);

  const handlePickPackage = useCallback((value: string) => {
    const next = value === '' ? null : value;
    setPickedPackageId(next);
    if (next === null) setBoardGeneration((generation) => generation + 1);
  }, []);

  // --- the loaded package --------------------------------------------------
  const packageQuery = useQuery({
    queryKey: queryKeys.packages.detail(packageId ?? ''),
    queryFn: () => getPackageFn({ data: { id: packageId as string } }),
    enabled: packageId !== null,
  });
  const pkg = packageQuery.data ?? null;
  // The `packageId !== null` half guards a real v5 behaviour — a DISABLED
  // query still reports `isPending: true`. It is currently belt-and-braces
  // (the hook only consults `packagePending` when the persisted state names a
  // package, which implies the query is enabled), but it stops being so the
  // moment `packageId` can diverge from `boardQuery.data.packageId` — which it
  // now can, via the picker's explicit-null.
  const packagePending = packageId !== null && packageQuery.isPending;

  // --- the package's assets ------------------------------------------------
  const assetsQuery = useQuery({
    queryKey: queryKeys.packages.assets(packageId ?? ''),
    queryFn: () => listPackageAssetsFn({ data: { packageId: packageId as string } }),
    enabled: packageId !== null,
  });
  // `undefined` while in flight (the hook's "not settled"), an explicit empty
  // array when there is genuinely no package to have assets for.
  const assets = packageId === null ? NO_ASSETS : assetsQuery.data?.items;

  /**
   * What the hook hydrates from.
   *
   * `null` — not the persisted board — once the GM has explicitly cleared,
   * because after a clear there is nothing to restore. Handing the remounted
   * surface the old board instead would make the hydration effect take its
   * "persisted board names a package that did not resolve" branch and file a
   * `captureException` on every single "— none —" click: an error-reporting
   * loop for an ordinary, deliberate GM action.
   */
  const initialState: BoardStateData | null | 'pending' = clearedByGM
    ? null
    : boardQuery.isPending
      ? 'pending'
      : (boardQuery.data ?? null);

  return (
    <div className="flex min-h-screen flex-col bg-[#080A12]">
      <Topbar />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans text-[15px] font-semibold tracking-widest text-white">
            SOUNDBOARD
          </h1>
          <Link
            to="/audio/packages"
            className="text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Manage packages
          </Link>
        </div>

        {boardQuery.error && (
          <p role="alert" className="mb-4 text-sm text-red-400">
            {errorMessage(boardQuery.error, 'Failed to load the saved board.')}
          </p>
        )}

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <label
            className="text-xs uppercase tracking-widest text-slate-500"
            htmlFor="package-pick"
          >
            Package
          </label>
          <select
            id="package-pick"
            value={packageId ?? ''}
            onChange={(e) => handlePickPackage(e.target.value)}
            className="rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="">— none —</option>
            {packages.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          {packagesQuery.error && (
            <span role="alert" className="text-sm text-red-400">
              {errorMessage(packagesQuery.error, 'Failed to load packages.')}
            </span>
          )}
        </div>

        {packageQuery.error && (
          <p role="alert" className="mb-4 text-sm text-red-400">
            {errorMessage(packageQuery.error, 'Failed to load this package.')}
          </p>
        )}
        {assetsQuery.error && (
          <p role="alert" className="mb-4 text-sm text-red-400">
            {errorMessage(assetsQuery.error, 'Failed to load this package’s sounds.')}
          </p>
        )}

        {/* Nothing that can DISPATCH renders until we know whether this caller
            is the GM. `persist` is the only consumer of that answer, and it
            defaults to "not the GM", so a command issued while the campaign
            query is in flight is silently never persisted — and if that query
            fails outright, the board would never save for the entire session
            with `saveError` left `null`. Failing visibly here is the whole
            point; that class of silence is what this surface exists to remove.

            `&& !campaign` is the load-bearing half. TanStack Query v5 keeps
            `data` and sets `status: 'error'` when a BACKGROUND refetch fails
            (`query-core`'s `onError` leaves `data` alone), and this query runs
            with the default `refetchOnWindowFocus` at `staleTime: 0` — so a GM
            alt-tabbing back during a network blip is the ordinary trigger.
            Branching on the error alone unmounts `BoardSurface`, disposing the
            `AudioContext` and stopping every sound mid-session. That is the
            design's governing rule inverted: "audio is never interrupted by a
            persistence or network failure. The engine owns sound; the server is
            a mirror." A stale-but-present campaign answers the only question
            this gate asks (is this caller the GM), so the board plays on and
            the failure is a notice, not a teardown. */}
        {campaignError && !campaign ? (
          <p role="alert" data-testid="campaign-error" className="text-sm text-red-400">
            {campaignError} — the board cannot be used until this campaign loads.
          </p>
        ) : campaignLoading ? (
          <p data-testid="campaign-loading" className="text-sm text-slate-500">
            Loading campaign…
          </p>
        ) : (
          <>
            {campaignError && (
              <p role="status" data-testid="campaign-stale" className="mb-4 text-sm text-amber-400">
                Campaign details could not be refreshed ({campaignError}). The board is still live.
              </p>
            )}
            <BoardSurface
              key={boardGeneration}
              campaignId={campaignId}
              packageId={packageId}
              pkg={pkg}
              assets={assets}
              cleared={clearedByGM}
              initialState={initialState}
              packagePending={packagePending}
              // `isGM`, NOT `isOwner`. `saveBoardState` authorizes through
              // `requireCampaignMember`'s `isGM` — `gameMasterId === userId`
              // OR a member row with `role: 'gm'` — while `isOwner` is
              // strictly the first of those. `serializeCampaign` computes
              // both from the same document, and `isGM` mirrors the server
              // predicate exactly, so this is the field that belongs here.
              // Latent today (`joinCampaign` only ever writes `role:
              // 'player'`), but the failure mode for a co-GM is silent:
              // `persist: false` suppresses every write with `saveError`
              // left `null`, so their board never survives a reload and
              // nothing tells them why. Still `=== true` — an unsettled or
              // failed campaign query means "not proven GM", not "GM".
              persist={campaign?.isGM === true}
              boardUnavailable={Boolean(packageQuery.error ?? assetsQuery.error)}
              boardStatePending={boardQuery.isPending}
            />
          </>
        )}
      </main>
    </div>
  );
}

interface BoardSurfaceProps {
  campaignId: string;
  /** The package the board should be showing, or `null` for a cleared board. */
  packageId: string | null;
  pkg: AudioPackageData | null;
  /** `undefined` = the asset query has not resolved. NEVER coerced to `[]`. */
  assets: readonly AudioAssetData[] | undefined;
  /**
   * This instance exists because the GM cleared the board, so the empty board
   * needs to be WRITTEN rather than merely displayed — see the mount effect.
   */
  cleared: boolean;
  initialState: BoardStateData | null | 'pending';
  packagePending: boolean;
  persist: boolean;
  /** The package or its assets failed to load; the errors are already shown. */
  boardUnavailable: boolean;
  boardStatePending: boolean;
}

/**
 * Everything stateful: the hook, the handlers, and the three controls.
 *
 * Split from `SoundboardPage` so that clearing the board can `key`-remount it
 * (see `boardGeneration`), and so that the queries and the audio state are not
 * tangled in one 300-line component.
 */
function BoardSurface({
  campaignId,
  packageId,
  pkg,
  assets,
  cleared,
  initialState,
  packagePending,
  persist,
  boardUnavailable,
  boardStatePending,
}: BoardSurfaceProps) {
  const { state, dispatch, audioReady, audioError, enableAudio, saveError, loadErrors } =
    useSoundboard(campaignId, pkg, { assets, initialState, packagePending, persist });

  // Every handler below is `useCallback`-stable, and that is load-bearing
  // rather than cosmetic: `BoardPad` is memoized with the default shallow
  // comparator, so a fresh inline arrow here re-renders all 64 pads on every
  // board interaction — the exact defeat phase 1 hit with `useDeleteConfirm`.
  // `dispatch` is itself stable (`useSoundboard` wraps it in `useCallback` over
  // stable deps), so these never change identity for the life of the board.
  const handlePlay = useCallback(
    (itemId: string) => dispatch({ type: 'play', itemId }),
    [dispatch]
  );
  const handleStop = useCallback(
    (itemId: string) => dispatch({ type: 'stop', itemId }),
    [dispatch]
  );
  const handleVolumeChange = useCallback(
    (itemId: string, volume: number) => dispatch({ type: 'setItemVolume', itemId, volume }),
    [dispatch]
  );
  const handleSelectMood = useCallback(
    (moodId: string) => dispatch({ type: 'setMood', moodId }),
    [dispatch]
  );
  const handleMasterVolumeChange = useCallback(
    (volume: number) => dispatch({ type: 'setMasterVolume', volume }),
    [dispatch]
  );
  const handleStopAll = useCallback(() => dispatch({ type: 'stopAll' }), [dispatch]);

  /**
   * A clear must PERSIST, not merely render.
   *
   * This instance mounts with `pkg: null` and `initialState: null`, so the
   * `[pkg]` effect never dispatches and nothing else arms a save — the GM
   * clears the board, closes the tab, and the old package is back on reload.
   * (The outgoing instance's unmount flush does not cover this: it only fires
   * if a debounce happened to be pending, and what it writes is the OLD
   * package.) `stopAll` is prompt-urgency and always returns a fresh state
   * object, so it arms a write of exactly what the board now is:
   * `packageId: null`, `moodId: null`, `items: []`.
   *
   * Ordering is safe by construction rather than by luck: `useSoundboard` is
   * called first in this component, so ITS effects — including the hydration
   * effect that flips `hydratedRef` — are registered before this one and run
   * first. Were it the other way round, `scheduleSave`'s clobber gate would
   * silently drop this write.
   */
  useEffect(() => {
    if (cleared) dispatch({ type: 'stopAll' });
  }, [cleared, dispatch]);

  const playingCount = state.items.filter((item) => item.playing).length;

  /**
   * Whether the enable-audio control may be clicked yet.
   *
   * BOTH halves are needed. `assets !== undefined` is the hook's own contract.
   * `!boardStatePending` is the subtler one: until the saved board says which
   * package is loaded, `packageId` is `null`, so `assets` is the
   * legitimately-empty `NO_ASSETS` and the first half is already satisfied.
   * The damage from enabling there is not merely "an engine over an empty
   * list": hydration is about to restore `playing: true` items, the hook's
   * `[state]` effect calls `engine.apply` on them, and `loadAsset` throws
   * against the unsettled list — so `unplayable` permanently swallows exactly
   * the pads the GM had running when they reloaded.
   */
  const audioEnableReady = !boardStatePending && assets !== undefined;

  /**
   * Whether the MOOD BAR and the PADS may be shown — i.e. whether an action
   * taken here can reach a settled asset list.
   *
   * This is the same failure as above, on the mid-session path, and it is the
   * one nothing else catches. `getPackageFn` and `listPackageAssetsFn` are
   * independent queries fired on the same render; when the package wins, a
   * mood is one click away while `assets` is still `undefined`. That click
   * resolves every item the mood names to `playing: true`, `engine.apply`
   * calls `loadAsset`, `loadAsset` throws "ran before the asset list settled",
   * and the engine adds each asset to an `unplayable` set it NEVER clears.
   * Those pads are silent for the rest of the session and the only trace is a
   * GlitchTip event.
   */
  const boardDataReady = pkg !== null && assets !== undefined;

  return (
    <>
      {/* The audio gesture. An `AudioContext` created outside a user gesture
          starts suspended, so without this the GM's first pad press silently
          does nothing — the worst failure a live tool can have. It stays
          clickable after a failure on purpose: every failure path in
          `enableAudio` is retryable, and a dead button after one bad gesture
          is exactly what the hook's Critical fix removed. */}
      {!audioReady && (
        <div
          data-testid="enable-audio"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2"
        >
          <span className="text-sm text-amber-200">
            Audio is off. Enable it before the session starts — browsers only allow sound after a
            click.
          </span>
          <button
            type="button"
            onClick={() => void enableAudio()}
            disabled={!audioEnableReady}
            // Stable accessible name across both states — the visible label
            // changes, the control does not.
            aria-label="Enable audio"
            className="ml-auto rounded bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {audioEnableReady ? 'Enable audio' : 'Loading sounds…'}
          </button>
        </div>
      )}

      {audioError && (
        <p role="alert" data-testid="audio-error" className="mb-4 text-sm text-red-400">
          {audioError}
        </p>
      )}

      {/* A failed save is a banner, never a modal or an error boundary: the
          engine owns sound and the server is only a mirror, so audio keeps
          playing and the GM is told without being interrupted. */}
      {saveError && (
        <p role="alert" data-testid="save-error" className="mb-4 text-sm text-amber-400">
          Could not save the board: {saveError}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {boardDataReady && (
          <MoodBar moods={pkg.moods} activeMoodId={state.moodId} onSelectMood={handleSelectMood} />
        )}

        {/* Master volume and Stop All stay available even mid-load: neither can
            start a sound, and Stop All is a panic button that must never be
            the thing a loading spinner is covering. */}
        <MasterBar
          masterVolume={state.masterVolume}
          onMasterVolumeChange={handleMasterVolumeChange}
          onStopAll={handleStopAll}
          playingCount={playingCount}
        />

        {packageId === null ? (
          <p data-testid="board-empty" className="text-sm text-slate-500">
            Pick a package to load its pads onto the board.
          </p>
        ) : boardUnavailable ? (
          <p data-testid="board-unavailable" className="text-sm text-slate-500">
            This package could not be loaded, so its pads are unavailable.
          </p>
        ) : !boardDataReady ? (
          /* NOT the grid with an empty asset list. `BoardGrid` reads "no asset
             for this item" as "the asset was deleted" and says so on every
             pad, which would turn a perfectly normal load into an on-screen
             claim that the GM's library had been wiped. */
          <p data-testid="board-loading" className="text-sm text-slate-500">
            Loading package…
          </p>
        ) : (
          <BoardGrid
            items={pkg.items}
            assets={assets}
            itemStates={state.items}
            loadErrors={loadErrors}
            onPlay={handlePlay}
            onStop={handleStop}
            onVolumeChange={handleVolumeChange}
          />
        )}
      </div>
    </>
  );
}
