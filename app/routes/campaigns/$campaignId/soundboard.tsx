import { useCallback, useMemo, useState } from 'react';
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
 * It owns four pieces of query state and threads three of them into
 * `useSoundboard`, which is where every non-obvious decision in this file
 * comes from:
 *
 * 1. **`initialState`** — `loadBoardStateFn`'s result, the hydrate seam. The
 *    hook applies it directly instead of replaying commands: a replay of
 *    `setMood` + per-item `play` cannot express an item the mood names but the
 *    GM had STOPPED (`setMood` resolves it back to playing), and a replay would
 *    also re-save what it just read, making "opened the board" the last write
 *    to `updatedBy`. Forgetting this key is the SILENT failure — the hook
 *    cannot tell "forgot" from "this board does not hydrate", so the board
 *    would simply never restore and the `[pkg]` effect's `loadPackage` would
 *    overwrite the persisted board with a blank one, logging nothing anywhere.
 * 2. **`packagePending`** — whether the package query is in flight. It
 *    defaults to `false`, and passing `false` while the query is still running
 *    concludes hydration against `pkg === null`; the `[pkg]` effect then arms a
 *    prompt-urgency write of a blank board and DURABLY destroys the persisted
 *    `moodId` and every item's `playing`/`volume`.
 * 3. **`assets`** — from Task 21's package-scoped `listPackageAssetsFn`, never
 *    `listAudioAssetsFn`. The library list is owner-scoped and cursor-paginated
 *    at 50 while a package holds up to 64 items; the engine caches a failed
 *    load as unplayable for its whole lifetime, so a package straddling that
 *    boundary gets permanently dead pads. `undefined` means "not settled" and
 *    the hook refuses to build an engine against it, which is why the
 *    enable-audio control is gated on the same signal.
 *
 * The fourth, `persist`, is the non-GM suppression described on
 * `soundboardBeforeLoad` above.
 */
export function SoundboardPage() {
  const { campaignId } = Route.useParams();
  const { campaign } = useCampaign(campaignId);

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

  // The GM's in-session choice wins over what was persisted; before they make
  // one, the persisted package is what the board loads. `null` on both means
  // nothing is loaded, which is a legal board state everywhere below.
  const [pickedPackageId, setPickedPackageId] = useState<string | null>(null);
  const packageId = pickedPackageId ?? boardQuery.data?.packageId ?? null;

  // --- the loaded package --------------------------------------------------
  const packageQuery = useQuery({
    queryKey: queryKeys.packages.detail(packageId ?? ''),
    queryFn: () => getPackageFn({ data: { id: packageId as string } }),
    enabled: packageId !== null,
  });
  const pkg = packageQuery.data ?? null;
  // A DISABLED query reports `isPending` too, which would mean "in flight"
  // forever for a board with no package — hence the explicit `packageId` half.
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

  const { state, dispatch, audioReady, audioError, enableAudio, saveError } = useSoundboard(
    campaignId,
    pkg,
    {
      assets,
      initialState: boardQuery.isPending ? 'pending' : (boardQuery.data ?? null),
      packagePending,
      persist: campaign?.isOwner === true,
    }
  );

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

  const playingCount = state.items.filter((item) => item.playing).length;
  /**
   * Whether the enable-audio control may be clicked yet.
   *
   * BOTH halves are needed. `assets !== undefined` is the hook's own contract.
   * `!boardQuery.isPending` is the subtler one: until the saved board says
   * which package is loaded, `packageId` is `null`, so `assets` is the
   * legitimately-empty `NO_ASSETS` and the first half is already satisfied.
   * Enabling on that would let the GM build an engine against an empty list
   * moments before the real package arrives — and the engine caches every
   * failed load as unplayable for its whole lifetime, so the board would come
   * up with every pad permanently dead and nothing to show for it.
   */
  const assetsSettled = !boardQuery.isPending && assets !== undefined;

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

        {/* The audio gesture. An `AudioContext` created outside a user gesture
            starts suspended, so without this the GM's first pad press silently
            does nothing — the worst failure a live tool can have. It stays
            clickable after a failure on purpose: every failure path in
            `enableAudio` is retryable, and a dead button after one bad gesture
            is exactly what the hook's Critical fix removed. It is DISABLED only
            while the asset query is unsettled, because the hook refuses to
            build an engine then and a refused build looks identical to a
            working one until the first silent pad. */}
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
              disabled={!assetsSettled}
              // Stable accessible name across both states — the visible label
              // changes, the control does not.
              aria-label="Enable audio"
              className="ml-auto rounded bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {assetsSettled ? 'Enable audio' : 'Loading sounds…'}
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
            onChange={(e) => setPickedPackageId(e.target.value === '' ? null : e.target.value)}
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

        <div className="flex flex-col gap-4">
          <MoodBar
            moods={pkg?.moods ?? []}
            activeMoodId={state.moodId}
            onSelectMood={handleSelectMood}
          />

          <MasterBar
            masterVolume={state.masterVolume}
            onMasterVolumeChange={handleMasterVolumeChange}
            onStopAll={handleStopAll}
            playingCount={playingCount}
          />

          {packageId === null ? (
            <p className="text-sm text-slate-500">
              Pick a package to load its pads onto the board.
            </p>
          ) : packagePending ? (
            <p className="text-sm text-slate-500">Loading package…</p>
          ) : (
            <BoardGrid
              items={pkg?.items ?? []}
              assets={assets ?? NO_ASSETS}
              itemStates={state.items}
              onPlay={handlePlay}
              onStop={handleStop}
              onVolumeChange={handleVolumeChange}
            />
          )}
        </div>
      </main>
    </div>
  );
}
