import { createServerFn } from '@tanstack/react-start';
import {
  packageWriteLimiter,
  packageEditLimiter,
  boardStateLimiter,
  rateLimitMessage,
} from '~/lib/audio-rate-limits';
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
//
// RATE LIMITING. Applied identically to `~/utils/audio-server-fns.ts` (read
// that module's note for the full reasoning) — after `requireActor()`, keyed
// on the Mongo `_id`, before the `~/server/functions/*` call, refusing with
// the module's own client-error class so a rejection files no GlitchTip
// event. Two buckets from `~/lib/audio-rate-limits.ts` land here:
//
//  - `packageWriteLimiter` on `createPackageFn`/`clonePackageFn` — the two
//    that MINT a package against the 100-per-user cap.
//  - `packageEditLimiter` on `updatePackageFn`. This one is a final-review
//    addition that SUPERSEDES Task 2's decision to leave it open; that
//    decision was argued on footprint alone, and footprint is not the only
//    cost. An update is the largest single write on this surface (a
//    whole-document `$set` of `items` and `moods`, up to ~410 KiB — several
//    hundred times a `saveBoardState`, which is gated) and fires one
//    un-awaited `package_updated` Umami event per call at caller-controlled
//    volume. Task 7's stale-write fence does not bound either: the refusal
//    carries `currentUpdatedAt`, so a replay loop succeeds every iteration.
//    The numbers are sized for a human pressing "Save changes" — see
//    `~/lib/audio-rate-limits.ts`.
//  - `boardStateLimiter` on `saveBoardStateFn` only.
//
// `deletePackageFn` is the one WRITE here with no bucket, and the reason is
// specific to it rather than shared with update: it is a single `deleteOne`
// by `{_id, ownerId}` with no document body to amplify, and its
// `package_deleted` event fires only on a row that really was removed — a
// replay hits `deletedCount: 0` and throws `PackageClientError`, which files
// nothing. Its event volume is bounded by the packages the caller owns, and
// the only ways to get more are the two gated minting endpoints above,
// behind a 100-package cap.
//
// READS ARE UNGATED — `listPackagesFn`, `getPackageFn`,
// `listPackageAssetsFn`, `loadBoardStateFn`. Per the design: a read bound
// risks breaking a legitimate board reload, which fires several of these at
// once, and one refused read leaves a half-loaded board. See
// `~/lib/audio-rate-limits.ts` for the full note.
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
    const { createPackage, PackageClientError } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = packageWriteLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new PackageClientError(rateLimitMessage('sound package', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return createPackage({ data, ...actor });
  });

export const updatePackageFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePackageSchema)
  .handler(async ({ data }) => {
    const { updatePackage, PackageClientError } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = packageEditLimiter.check(actor.userId);
    if (!gate.allowed) {
      // `PackageClientError`, not `PackageStaleWriteError` — a rate-limit
      // refusal is not a conflict, and the editor's `isStalePackageWriteError`
      // check must not mistake it for one and offer an "overwrite" button
      // that would only burn the caller's next token. It files no GlitchTip
      // event either, same as every other bucket's refusal on this surface.
      throw new PackageClientError(rateLimitMessage('package edit', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return updatePackage({ data, ...actor });
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
    const { clonePackage, PackageClientError } = await import('~/server/functions/packages');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = packageWriteLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new PackageClientError(rateLimitMessage('sound package', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return clonePackage({ data, ...actor });
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
    const { saveBoardState, SoundboardClientError } = await import('~/server/functions/soundboard');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = boardStateLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new SoundboardClientError(rateLimitMessage('board save', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return saveBoardState({ data, ...actor });
  });
