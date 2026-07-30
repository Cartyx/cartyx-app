import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { getMe } from '~/server/functions/rpc';
import { Topbar } from '~/components/Topbar';
import { PackageEditor } from '~/components/soundboard/PackageEditor';
import { MoodEditor } from '~/components/soundboard/MoodEditor';
import { getPackageFn, updatePackageFn } from '~/utils/soundboard-server-fns';
import { listAudioAssetsFn } from '~/utils/audio-server-fns';
import { queryKeys } from '~/utils/queryKeys';
import { captureException } from '~/utils/telemetry-client';
import type { AudioFilters } from '~/components/audio/AudioFilterBar';
import type { AudioAssetData, AudioEnvironment, AudioMood } from '~/types/audio';
import type { MoodData, PackageItemData } from '~/types/soundboard';

/** Server-side page size for the asset picker — same value `/audio` uses. */
const PAGE_SIZE = 50;

type AssetPage = { items: AudioAssetData[]; nextCursor: string | null };

function flattenAssetPages(data: { pages: AssetPage[] } | undefined): AudioAssetData[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * `updatePackage`'s `$set` only touches fields the caller actually sends
 * (confirmed by reading `~/server/functions/packages.ts`) — so a save that
 * sends `items` alone leaves a package's existing `moods` in the DB
 * untouched, and any `moods[].states[]` entry whose `itemId` named an item
 * this route's editor just removed becomes a dangling reference forever
 * (the board layer tolerates it safely today — `resolveAllItems` iterates
 * `pkg.items`, never `mood.states` — but it's still dead, silently
 * accumulating data with no future consumer defending against it).
 *
 * This route is what creates that orphan (removing an item is this task's
 * UI, not Task 15's mood editor), so it's what prunes it: every `states[]`
 * entry is kept ONLY if its `itemId` still names a surviving item — nothing
 * here rebuilds `states` from `items`, which would silently drop every
 * per-state override (`volume`, `fadeSeconds`, `randomIntervalMin/Max`,
 * even a bare `playing: true`/`false` toggle) for every item that
 * survived, not just the one that was removed. Filtering by id membership
 * is the only operation that changes exactly what needs to change.
 *
 * Exported for direct unit testing, same reasoning as `flattenAssetPages`
 * above and `flattenAudioPages`/`shouldPoll` in `~/routes/audio.tsx`.
 */
export function pruneOrphanedMoodStates(moods: MoodData[], items: PackageItemData[]): MoodData[] {
  const survivingIds = new Set(items.map((item) => item.id));
  return moods.map((mood) => ({
    ...mood,
    states: mood.states.filter((state) => survivingIds.has(state.itemId)),
  }));
}

/**
 * Exported for direct unit-testing, matching `audioBeforeLoad`
 * (`~/routes/audio.tsx`) and `audioPackagesBeforeLoad`
 * (`~/routes/audio_.packages.tsx`) exactly — same per-user guard, copied
 * from `dashboard.tsx:6-12`.
 */
export async function packageEditorBeforeLoad() {
  const user = await getMe();
  if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
  return { user };
}

// FILENAME: `audio_.packages_.$packageId.tsx` — TWO trailing underscores,
// not one. This needed re-verifying empirically rather than copying Task
// 13's `audio_.` convention directly, and the first attempt (`audio_.packages.
// $packageId.tsx`, matching Task 13's report verbatim) was itself wrong:
//
// 1. A single underscore on `audio_` only opts this route out of nesting
//    under `~/routes/audio.tsx` (the flat audio library page) — the exact
//    hazard Task 13's report describes. It does NOT opt out of nesting under
//    `~/routes/audio_.packages.tsx` (Task 13's OWN route file), because
//    TanStack Router's flat-file convention nests a route under the LONGEST
//    matching prefix that has its own route file, and `audio_.packages` is
//    exactly that prefix here (it's Task 13's route id verbatim). Built
//    `audio_.packages.$packageId.tsx`, ran `npx vite build` (regenerates
//    `routeTree.gen.ts` — see Task 13's report on why `npm run typecheck`
//    alone does not), and confirmed: `AudioPackagesPackageIdRoute`'s
//    `getParentRoute: () => AudioPackagesRoute` (Task 13's list route, NOT
//    root), and `AudioPackagesRoute` itself flipped to
//    `AudioPackagesRouteWithChildren`. `PackagesListPage` (Task 13's
//    component) renders no `<Outlet />` anywhere in its JSX — it's a
//    complete, self-contained page — so nesting a child under it silently
//    turns it into exactly the kind of Outlet-less layout Task 13's report
//    warned `audio.tsx` would become: navigating to `/audio/packages/<id>`
//    would match this child route but never actually render
//    `PackageEditorPage`, because nothing in the matched tree above it
//    delegates rendering to a child.
//
// 2. The fix is a SECOND trailing underscore, on the `packages` segment too:
//    `packages_`. With both `audio_.packages_.$packageId.tsx`, no existing
//    route file's id is a prefix of `audio_.packages_` (there is no
//    `audio_.tsx`, and `audio_.packages_` itself doesn't match Task 13's
//    `audio_.packages` id — the trailing underscore makes them different
//    strings), so nothing nests. Rebuilt and confirmed:
//    `AudioPackagesPackageIdRoute`'s `getParentRoute: () => rootRouteImport`
//    (not `AudioPackagesRoute`), `path: '/audio/packages/$packageId'` (the
//    URL — unaffected; both underscores are stripped from the rendered path,
//    same as Task 13's single one, only the internal id keeps them:
//    `/audio_/packages_/$packageId`), and `AudioPackagesRoute` reverted to a
//    plain `typeof AudioPackagesRoute` — no `WithChildren`, no children
//    array. `git diff --stat app/routes/audio_.packages.tsx` is empty: that
//    route was never touched by this file's existence.
//
// One correction to Task 13's report: it claims `createFileRoute`'s string
// argument "keys off the rendered FULL PATH... does not encode the
// filename's underscore" — but Task 13's OWN committed file uses
// `createFileRoute('/audio_/packages')` (the underscored id form), not
// `/audio/packages`. I wrote this file's literal as `/audio/packages/
// $packageId` (full path, no underscores) first; `npx vite build`'s route
// generator rewrote it back to the id form
// (`/audio_/packages_/$packageId`) on disk, unprompted, exactly mirroring
// Task 13's file. That's the tool's own canonical form for a route whose id
// and full path differ — matching it here rather than fighting the
// generator on every future build.
export const Route = createFileRoute('/audio_/packages_/$packageId')({
  beforeLoad: packageEditorBeforeLoad,
  component: PackageEditorPage,
});

export function PackageEditorPage() {
  const { packageId } = Route.useParams();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<AudioFilters>({});

  const {
    data: pkg,
    isLoading: pkgLoading,
    error: pkgError,
  } = useQuery({
    queryKey: queryKeys.packages.detail(packageId),
    queryFn: () => getPackageFn({ data: { id: packageId } }),
  });

  // Local draft of `items`, seeded from the loaded package and re-seeded
  // whenever a save resolves with a fresh copy (see `saveMutation.onSuccess`
  // below). Kept separate from `pkg.items` itself — `PackageEditor` fires
  // `onItemsChange` on every keystroke-level edit (a volume drag, a checkbox
  // toggle), and sending a full `updatePackageFn` round trip on every one of
  // those would be both a network flood and a source of out-of-order-response
  // races overwriting a newer local edit with a stale server response. This
  // route batches: edits accumulate here, and an explicit Save persists them
  // (see `updatePackageFn` being a full-array replace of `items`, not a
  // per-item patch — the whole current draft is what's sent).
  const [items, setItems] = useState<PackageItemData[] | null>(null);
  // Same local-draft-plus-explicit-Save pattern as `items` above, and seeded
  // by the same effect: `MoodEditor` fires `onMoodsChange` on every mood
  // add/remove/rename and every per-item state edit, and batching those into
  // one draft (rather than a server round trip per keystroke) is exactly why
  // `items` already works this way. Composing with `items`' save is the
  // whole point — see `saveMutation` below for how the two combine into a
  // SINGLE `updatePackageFn` call rather than two racing writes to the same
  // document.
  const [moods, setMoods] = useState<MoodData[] | null>(null);
  useEffect(() => {
    if (pkg) {
      setItems(pkg.items);
      setMoods(pkg.moods);
    }
  }, [pkg]);

  const isSystemPackage = pkg?.ownerId === null;
  const dirty =
    (items !== null && pkg !== undefined && items !== pkg.items) ||
    (moods !== null && pkg !== undefined && moods !== pkg.moods);

  const assetsQuery = useInfiniteQuery<
    AssetPage,
    Error,
    InfiniteData<AssetPage>,
    QueryKey,
    string | null
  >({
    queryKey: queryKeys.audio.list(filters),
    queryFn: ({ pageParam }) =>
      listAudioAssetsFn({
        data: {
          ...filters,
          cursor: pageParam ?? undefined,
          // Same widening-then-narrowing cast `~/routes/audio.tsx` uses:
          // `AudioFilters.environment`/`.mood` are typed as plain `string[]`
          // even though `AudioFilterBar`'s chip UI only ever populates them
          // from `AUDIO_ENVIRONMENTS`/`AUDIO_MOODS`. `listAudioAssetsSchema`
          // is the real runtime boundary regardless of this cast.
          environment: filters.environment as AudioEnvironment[] | undefined,
          mood: filters.mood as AudioMood[] | undefined,
          limit: PAGE_SIZE,
        },
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Disabled for a system package: the picker (and the whole "add sounds"
    // section) never renders for one, so there's no reason to page the
    // library in behind it.
    enabled: !isSystemPackage,
  });
  const assets = useMemo(() => flattenAssetPages(assetsQuery.data), [assetsQuery.data]);

  /**
   * ONE save path for both `items` and `moods` — not two. `PackageEditor`
   * (Task 14) and `MoodEditor` (this task) are both fully controlled and
   * never call a server fn themselves; they only stage local drafts here via
   * `handleItemsChange`/`handleMoodsChange`. This mutation is the single
   * place either draft reaches the server, in a single `updatePackageFn`
   * call keyed by whatever is in `items`/`moods` state at the moment "Save
   * changes" is clicked. That's what rules out the two-racing-writes
   * failure mode the brief warns about: there is no second mutation, no
   * second `updatePackageFn` call, and no interleaving to race, because
   * both drafts are read out of the SAME `handleSave` closure into the SAME
   * mutate() call. A user editing an item's volume and a mood's override in
   * the same sitting sends both in the one request that "Save changes"
   * fires; there is no per-editor save button to click out of order.
   *
   * Pruning uses `nextMoods` (the live draft, which may include mood edits
   * made in this same sitting) against `nextItems` (ditto for items) — not
   * `pkg?.moods`, which would ignore any in-progress mood edit and silently
   * discard it by re-deriving from stale server data.
   */
  const saveMutation = useMutation({
    mutationFn: ({
      items: nextItems,
      moods: nextMoods,
    }: {
      items: PackageItemData[];
      moods: MoodData[];
    }) =>
      updatePackageFn({
        data: {
          id: packageId,
          items: nextItems,
          // Always sent alongside `items`, not only when an item was
          // actually removed: pruning is a no-op filter when nothing
          // shrank (every state already names a surviving item), so there
          // is no cheaper-but-correct way to send it conditionally, and
          // "only prune on removal" would require this route to track
          // which edit just happened rather than just what's true of the
          // current items/moods pair.
          moods: pruneOrphanedMoodStates(nextMoods, nextItems),
        },
      }),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.packages.detail(packageId), updated);
      setItems(updated.items);
      setMoods(updated.moods);
      void qc.invalidateQueries({ queryKey: queryKeys.packages.all });
    },
    onError: (e) => captureException(e, { action: 'PackageEditorPage.save' }),
  });

  const handleItemsChange = useCallback((next: PackageItemData[]) => {
    setItems(next);
  }, []);

  const handleMoodsChange = useCallback((next: MoodData[]) => {
    setMoods(next);
  }, []);

  const handleSave = () => {
    if (items && moods) saveMutation.mutate({ items, moods });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080A12]">
      <Topbar />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {pkgLoading && <p className="text-sm text-slate-500">Loading package…</p>}

        {pkgError && (
          <p role="alert" className="text-sm text-red-400">
            {errorMessage(pkgError, 'Failed to load package.')}
          </p>
        )}

        {pkg && items && moods && (
          <>
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <h1 className="font-sans font-semibold text-[15px] text-white tracking-widest">
                  {pkg.name.toUpperCase()}
                </h1>
                {isSystemPackage && (
                  <p className="mt-1 text-xs text-amber-400">
                    This is a system package and cannot be edited directly — clone it from the
                    package list first.
                  </p>
                )}
              </div>

              {!isSystemPackage && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || saveMutation.isPending}
                  className="shrink-0 rounded bg-blue-600 px-4 py-1.5 font-sans text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600"
                >
                  {saveMutation.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                </button>
              )}
            </div>

            <PackageEditor
              items={items}
              onItemsChange={handleItemsChange}
              assets={assets}
              loading={assetsQuery.isLoading}
              filters={filters}
              onFiltersChange={setFilters}
              onLoadMore={() => void assetsQuery.fetchNextPage()}
              hasMore={Boolean(assetsQuery.hasNextPage)}
              loadingMore={assetsQuery.isFetchingNextPage}
              readOnly={isSystemPackage}
            />

            <div className="mt-8">
              <MoodEditor
                items={items}
                moods={moods}
                onMoodsChange={handleMoodsChange}
                readOnly={isSystemPackage}
              />
            </div>

            {saveMutation.error && (
              <p role="alert" className="mt-4 text-sm text-red-400">
                {errorMessage(saveMutation.error, 'Failed to save changes. Please try again.')}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
