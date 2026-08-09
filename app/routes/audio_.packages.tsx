import { useCallback } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { getMe } from '~/server/functions/rpc';
import { Topbar } from '~/components/Topbar';
import { PackageList } from '~/components/soundboard/PackageList';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import { useDeleteConfirm } from '~/hooks/useDeleteConfirm';
import {
  listPackagesFn,
  createPackageFn,
  clonePackageFn,
  deletePackageFn,
} from '~/utils/soundboard-server-fns';
import type { createPackageSchema } from '~/types/schemas/soundboard';
import { queryKeys } from '~/utils/queryKeys';
import { captureException } from '~/utils/telemetry-client';
import { isClientRefusal } from '~/lib/client-refusal';
import type { AudioPackageSummaryData } from '~/types/soundboard';

/**
 * `createPackageSchema`'s shape, not a structural literal (per the brief) —
 * typed against `z.input` (the schema's PRE-`.parse()` shape, where
 * `items`/`moods`' `.default([])` makes them optional) rather than
 * `z.infer`/`z.output`, so this stays a compile error if the schema ever
 * drops `name`'s requiredness or gains a new required field, instead of
 * silently structurally matching forever. A freshly created package is
 * unnamed by the user yet — the rename field this task adds to the editor
 * route is where the GM actually names it; this default only needs to exist
 * long enough to satisfy `createPackageSchema`'s `name` `min(1)` and get the
 * user into the editor.
 */
const NEW_PACKAGE_INPUT: z.input<typeof createPackageSchema> = { name: 'New Package' };

/**
 * `clonePackageSchema`'s `name` bound (`z.string().min(1).max(200)`) — kept
 * as a local literal rather than importing a shared constant so this file
 * doesn't need a schema-file change to fix a UI-only overflow risk (see
 * `cloneDisplayName` below). If the schema's bound ever moves, this needs to
 * move with it; there is no single source of truth to import here without
 * exporting a new constant from `~/types/schemas/soundboard`, which is more
 * surface than a length clamp needs.
 */
const CLONE_NAME_MAX_LENGTH = 200;
const CLONE_SUFFIX = ' (copy)';

/**
 * The client-computed name a clone gets, distinguishing it from its source
 * both in this list and in the board's package picker (a plain `<select>`
 * listing `candidate.name` with no badge or other distinguishing UI at all —
 * see `campaigns/$campaignId/soundboard.tsx`'s `#package-pick`) without
 * requiring the user to open the editor and rename it first.
 *
 * Exported for direct unit testing of the clamp: a source name near the
 * schema's 200-char cap plus the 7-char suffix would otherwise overflow it,
 * and the UI must not offer a clone action that the server is guaranteed to
 * reject.
 */
export function cloneDisplayName(sourceName: string): string {
  const maxBaseLength = CLONE_NAME_MAX_LENGTH - CLONE_SUFFIX.length;
  const base = sourceName.length > maxBaseLength ? sourceName.slice(0, maxBaseLength) : sourceName;
  return `${base}${CLONE_SUFFIX}`;
}

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

  const createMutation = useMutation({
    mutationFn: () => createPackageFn({ data: NEW_PACKAGE_INPUT }),
    onSuccess: (created) => {
      invalidatePackages();
      navigate({ to: '/audio/packages/$packageId', params: { packageId: created.id } });
    },
    onError: (e) => {
      // A refusal is not a fault — see `~/lib/client-refusal.ts`.
      if (!isClientRefusal(e)) captureException(e, { action: 'PackagesListPage.createPackage' });
    },
  });

  const cloneMutation = useMutation({
    // `clonePackage` (Task 5) has always accepted an optional `data.name` —
    // the gap this task closes is that nothing here ever supplied one, so
    // a clone was indistinguishable from its source in both this list and
    // the board's package picker. A client-computed "(copy)" suffix (the
    // brief's own suggested wording) rather than a prompt dialog or relying
    // solely on the new rename field: cloning stays the single click it
    // already was — no modal interrupts the flow — and the clone is
    // immediately distinguishable in the list without a required follow-up
    // trip to the editor. The rename field (added to the editor route in
    // this same task) is still there for a GM who wants something other
    // than the default suffix. This needs NO server change: `clonePackage`'s
    // `data.name ?? src.name` already does exactly the right thing with a
    // supplied name.
    mutationFn: (pkg: AudioPackageSummaryData) =>
      clonePackageFn({ data: { id: pkg.id, name: cloneDisplayName(pkg.name) } }),
    onSuccess: invalidatePackages,
    onError: (e) => {
      // A refusal is not a fault — see `~/lib/client-refusal.ts`.
      if (!isClientRefusal(e)) captureException(e, { action: 'PackagesListPage.clonePackage' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (pkg: AudioPackageSummaryData) => deletePackageFn({ data: { id: pkg.id } }),
    onSuccess: invalidatePackages,
    onError: (e) => {
      // A refusal is not a fault — see `~/lib/client-refusal.ts`.
      if (!isClientRefusal(e)) captureException(e, { action: 'PackagesListPage.deletePackage' });
    },
  });

  const { pendingDelete, deleteError, requestDelete, cancelDelete, confirmDelete } =
    useDeleteConfirm<AudioPackageSummaryData>(
      (pkg) => deleteMutation.mutateAsync(pkg),
      'Failed to delete package. Please try again.'
    );

  return (
    <div className="min-h-screen flex flex-col bg-[#080A12]">
      <Topbar />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="font-sans font-semibold text-[15px] text-white tracking-widest">
            SOUND PACKAGES
          </h1>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="shrink-0 rounded bg-blue-600 px-4 py-1.5 font-sans text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            {createMutation.isPending ? 'Creating…' : 'New package'}
          </button>
        </div>

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

        {createMutation.error && (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {errorMessage(createMutation.error, 'Failed to create package. Please try again.')}
          </p>
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
