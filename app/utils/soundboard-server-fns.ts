import { createServerFn } from '@tanstack/react-start';
import {
  getPackageSchema,
  createPackageSchema,
  updatePackageSchema,
  deletePackageSchema,
  clonePackageSchema,
  listPackageAssetsSchema,
  loadBoardStateSchema,
  saveBoardStateSchema,
} from '~/types/schemas/soundboard';
import { requireActor } from '~/utils/audio-server-fns';

// ---------------------------------------------------------------------------
// Browser-facing server-fn wrappers for ~/server/functions/packages and
// ~/server/functions/soundboard.
//
// Structure copied exactly from ~/utils/audio-server-fns.ts: `requireActor`
// (imported from there, not re-defined — see its doc comment) resolves the
// session's OAuth provider id to this app's Mongo `_id` before anything below
// touches a query, and `~/server/session` (transitively, inside
// `requireActor`) is only ever reached via a dynamic import, never a
// module-scope one — a static import would (a) trip the `no-restricted-
// imports` lint rule that keeps ~/server/* out of app/utils/**, and (b) pull
// server-only code into the client bundle. `createServerFn`'s `.handler()`
// body only ever executes on the server, so the dynamic imports inside each
// handler below never reach the browser.
//
// `requireActor()` returns `{ userId, sessionUserId }`. `userId` (the Mongo
// `_id`) is the only value that may scope a query — it is what every
// `~/server/functions/packages` and `~/server/functions/soundboard` function
// spreads into its own `Actor` and uses to filter/stamp documents.
// `sessionUserId` (the OAuth provider id) is telemetry-only. Phase 1 shipped
// the provider id into a query and every call CastError'd; that split is what
// keeps it from happening again here.
//
// Board-state asymmetry: `loadBoardStateFn`/`saveBoardStateFn` pass the same
// `{ data, userId, sessionUserId }` shape as every package wrapper below, but
// `~/server/functions/soundboard`'s `loadBoardState`/`saveBoardState` do NOT
// use `userId` for authorization — they call `requireCampaignMember`
// internally (membership for load, membership+isGM for save) and use ITS
// independently-verified id to scope reads and stamp `updatedBy`. This
// wrapper's `userId`/`sessionUserId` reach those two functions for telemetry
// tagging only. Do not add a second campaign-membership check here — that
// would duplicate, and could drift from, the one `soundboard.ts` already
// owns.
// ---------------------------------------------------------------------------

export const listPackagesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { listPackages } = await import('~/server/functions/packages');
  return listPackages(await requireActor());
});

export const getPackageFn = createServerFn({ method: 'GET' })
  .inputValidator(getPackageSchema)
  .handler(async ({ data }) => {
    const { getPackage } = await import('~/server/functions/packages');
    return getPackage({ data, ...(await requireActor()) });
  });

export const createPackageFn = createServerFn({ method: 'POST' })
  .inputValidator(createPackageSchema)
  .handler(async ({ data }) => {
    const { createPackage } = await import('~/server/functions/packages');
    return createPackage({ data, ...(await requireActor()) });
  });

export const updatePackageFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePackageSchema)
  .handler(async ({ data }) => {
    const { updatePackage } = await import('~/server/functions/packages');
    return updatePackage({ data, ...(await requireActor()) });
  });

export const deletePackageFn = createServerFn({ method: 'POST' })
  .inputValidator(deletePackageSchema)
  .handler(async ({ data }) => {
    const { deletePackage } = await import('~/server/functions/packages');
    return deletePackage({ data, ...(await requireActor()) });
  });

export const clonePackageFn = createServerFn({ method: 'POST' })
  .inputValidator(clonePackageSchema)
  .handler(async ({ data }) => {
    const { clonePackage } = await import('~/server/functions/packages');
    return clonePackage({ data, ...(await requireActor()) });
  });

// Task 21: the assets one package's items reference — package-gated, not the
// owner-scoped library browser (`listAudioAssetsFn`). See
// `~/server/functions/packages`'s `listPackageAssets` doc comment for the
// two-gate authorization rule this wraps.
export const listPackageAssetsFn = createServerFn({ method: 'GET' })
  .inputValidator(listPackageAssetsSchema)
  .handler(async ({ data }) => {
    const { listPackageAssets } = await import('~/server/functions/packages');
    return listPackageAssets({ data, ...(await requireActor()) });
  });

export const loadBoardStateFn = createServerFn({ method: 'GET' })
  .inputValidator(loadBoardStateSchema)
  .handler(async ({ data }) => {
    const { loadBoardState } = await import('~/server/functions/soundboard');
    return loadBoardState({ data, ...(await requireActor()) });
  });

export const saveBoardStateFn = createServerFn({ method: 'POST' })
  .inputValidator(saveBoardStateSchema)
  .handler(async ({ data }) => {
    const { saveBoardState } = await import('~/server/functions/soundboard');
    return saveBoardState({ data, ...(await requireActor()) });
  });
