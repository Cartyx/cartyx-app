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

// ---------------------------------------------------------------------------
// Browser-facing server-fn wrappers for ~/server/functions/packages and
// ~/server/functions/soundboard.
//
// Structure copied exactly from ~/utils/audio-server-fns.ts: `requireActor`
// (see ~/utils/require-actor.ts) resolves the session's OAuth provider id to
// this app's Mongo `_id` before anything below touches a query.
//
// `requireActor` is reached via a dynamic `await import('~/utils/require-
// actor')` INSIDE each handler below, never a module-scope `import` — this
// file previously had `import { requireActor } from '~/utils/audio-server-
// fns'` at module scope, which broke `npm run build` (see ~/utils/require-
// actor.ts's doc comment for the exact mechanism: a static import edge makes
// the imported module's `~/server/session` chain reachable from the client's
// module graph even though every call site is inside a stripped `.handler()`
// body). `createServerFn`'s `.handler()` body only ever executes on the
// server, so the dynamic imports inside each handler below never reach the
// browser.
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
  const { requireActor } = await import('~/utils/require-actor');
  return listPackages(await requireActor());
});

export const getPackageFn = createServerFn({ method: 'GET' })
  .inputValidator(getPackageSchema)
  .handler(async ({ data }) => {
    const { getPackage } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
    return getPackage({ data, ...(await requireActor()) });
  });

export const createPackageFn = createServerFn({ method: 'POST' })
  .inputValidator(createPackageSchema)
  .handler(async ({ data }) => {
    const { createPackage } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
    return createPackage({ data, ...(await requireActor()) });
  });

export const updatePackageFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePackageSchema)
  .handler(async ({ data }) => {
    const { updatePackage } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
    return updatePackage({ data, ...(await requireActor()) });
  });

export const deletePackageFn = createServerFn({ method: 'POST' })
  .inputValidator(deletePackageSchema)
  .handler(async ({ data }) => {
    const { deletePackage } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
    return deletePackage({ data, ...(await requireActor()) });
  });

export const clonePackageFn = createServerFn({ method: 'POST' })
  .inputValidator(clonePackageSchema)
  .handler(async ({ data }) => {
    const { clonePackage } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
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
    const { requireActor } = await import('~/utils/require-actor');
    return listPackageAssets({ data, ...(await requireActor()) });
  });

export const loadBoardStateFn = createServerFn({ method: 'GET' })
  .inputValidator(loadBoardStateSchema)
  .handler(async ({ data }) => {
    const { loadBoardState } = await import('~/server/functions/soundboard');
    const { requireActor } = await import('~/utils/require-actor');
    return loadBoardState({ data, ...(await requireActor()) });
  });

export const saveBoardStateFn = createServerFn({ method: 'POST' })
  .inputValidator(saveBoardStateSchema)
  .handler(async ({ data }) => {
    const { saveBoardState } = await import('~/server/functions/soundboard');
    const { requireActor } = await import('~/utils/require-actor');
    return saveBoardState({ data, ...(await requireActor()) });
  });
