import { useCallback } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe } from '~/server/functions/rpc';
import { Topbar } from '~/components/Topbar';
import { PackageList } from '~/components/soundboard/PackageList';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import { useDeleteConfirm } from '~/hooks/useDeleteConfirm';
import { listPackagesFn, clonePackageFn, deletePackageFn } from '~/utils/soundboard-server-fns';
import { queryKeys } from '~/utils/queryKeys';
import { captureException } from '~/utils/telemetry-client';
import type { AudioPackageData } from '~/types/soundboard';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Exported (not inlined into `createFileRoute`) for the same reason
 * `audioBeforeLoad` in `~/routes/audio.tsx` is: directly unit-testable
 * without depending on `createFileRoute`'s return shape. Matches
 * `dashboard.tsx:6-12` exactly — package authoring is per-user, and every
 * server fn this route calls throws without a session.
 */
export async function audioPackagesBeforeLoad() {
  const user = await getMe();
  if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
  return { user };
}

// FILENAME: `audio_.packages.tsx` — flat, with a TRAILING UNDERSCORE on the
// `audio_` segment. This is a two-step correction of the plan's routing
// note (docs/specs/2026-07-30-soundboard-packages-plan.md, "Routing shape —
// verify before Task 13"), verified empirically, not assumed:
//
// 1. A DIRECTORY `app/routes/audio/packages.tsx` beside the existing FLAT
//    `app/routes/audio.tsx` (17 KB leaf route for `/audio`) makes TanStack
//    Router treat `audio.tsx` as a pathless LAYOUT for its new children —
//    exactly the hazard the plan flagged.
//
// 2. The plan's suggested escape hatch — a plain dotted flat file,
//    `audio.packages.tsx` (no underscore) — does NOT avoid this. Verified by
//    generating `routeTree.gen.ts` with that exact filename: TanStack
//    Router's flat-file convention treats `.` as nesting by default
//    regardless of directory vs. dotted-filename form, so
//    `audio.packages.tsx` still produced `getParentRoute: () => AudioRoute`
//    and turned `AudioRoute` into a `AudioRouteWithChildren` — the plan's
//    fallback was itself wrong, not just risky.
//
// The fix is TanStack Router's actual "non-nested route" convention (same
// idea as Remix flat routes): a TRAILING underscore on the segment that
// would otherwise match a parent file opts out of nesting under it, while
// the underscore is stripped from the rendered URL. `audio_.packages.tsx`
// generates `AudioPackagesRoute` with `getParentRoute: () => rootRouteImport`
// (not `AudioRoute`), `path: '/audio/packages'` (the URL — unaffected), and
// leaves `AudioRoute` a plain `typeof AudioRoute` (no `WithChildren`, no
// children array) — `/audio` is untouched, byte-for-byte the same component
// it already was. `createFileRoute('/audio/packages')` below is the correct
// literal either way: the type argument keys off the FULL PATH (URL), not
// the internal route id (`/audio_/packages`), so it does not encode the
// filename's underscore.
//
// Evidence: see the Task 13 report for the exact `routeTree.gen.ts` diffs
// for both the rejected `audio.packages.tsx` attempt and this file.
export const Route = createFileRoute('/audio_/packages')({
  beforeLoad: audioPackagesBeforeLoad,
  component: PackagesListPage,
});

export function PackagesListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const {
    data,
    isLoading,
    error: listError,
  } = useQuery({
    queryKey: queryKeys.packages.list(),
    queryFn: () => listPackagesFn(),
  });
  const packages = data?.items ?? [];

  const invalidatePackages = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.packages.all });
  }, [qc]);

  const cloneMutation = useMutation({
    mutationFn: (pkg: AudioPackageData) => clonePackageFn({ data: { id: pkg.id } }),
    onSuccess: invalidatePackages,
    onError: (e) => captureException(e, { action: 'PackagesListPage.clonePackage' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (pkg: AudioPackageData) => deletePackageFn({ data: { id: pkg.id } }),
    onSuccess: invalidatePackages,
    onError: (e) => captureException(e, { action: 'PackagesListPage.deletePackage' }),
  });

  const { pendingDelete, deleteError, requestDelete, cancelDelete, confirmDelete } =
    useDeleteConfirm<AudioPackageData>(
      (pkg) => deleteMutation.mutateAsync(pkg),
      'Failed to delete package. Please try again.'
    );

  return (
    <div className="min-h-screen flex flex-col bg-[#080A12]">
      <Topbar />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="font-sans font-semibold text-[15px] text-white tracking-widest mb-8">
          SOUND PACKAGES
        </h1>

        {isLoading && <p className="text-sm text-slate-500">Loading packages…</p>}

        {listError && (
          <p role="alert" className="text-sm text-red-400">
            {errorMessage(listError, 'Failed to load packages.')}
          </p>
        )}

        {!isLoading && !listError && (
          <PackageList
            packages={packages}
            onEdit={(pkg) =>
              navigate({ to: '/audio/packages/$packageId', params: { packageId: pkg.id } })
            }
            onClone={(pkg) => cloneMutation.mutate(pkg)}
            onDelete={requestDelete}
            cloningId={cloneMutation.isPending ? (cloneMutation.variables?.id ?? null) : null}
          />
        )}

        {cloneMutation.error && (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {errorMessage(cloneMutation.error, 'Failed to clone package. Please try again.')}
          </p>
        )}

        {pendingDelete && (
          <ConfirmDialog
            title="Delete package"
            message={`Delete "${pendingDelete.name}"? This cannot be undone.`}
            confirmLabel="Delete"
            danger
            isLoading={deleteMutation.isPending}
            error={deleteError}
            onConfirm={confirmDelete}
            onCancel={cancelDelete}
          />
        )}
      </main>
    </div>
  );
}
