import { createServerFn } from '@tanstack/react-start';
import {
  audioIngestLimiter,
  libraryMutationLimiter,
  orphanCleanupLimiter,
  rateLimitMessage,
} from '~/lib/audio-rate-limits';
import {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
  attachOnceVariantUploadSchema,
  confirmOnceVariantUploadSchema,
  listAudioAssetsSchema,
  updateAudioAssetSchema,
  bulkTagAudioAssetsSchema,
  deleteAudioAssetSchema,
  retryAudioAssetSchema,
  scanOrphanAudioSchema,
  deleteOrphanAudioSchema,
} from '~/types/schemas/audio';

// ---------------------------------------------------------------------------
// Browser-facing server-fn wrappers for ~/server/functions/audio.
//
// ~/server/functions/audio.ts takes an explicit `userId` rather than
// resolving the session itself (unlike most other ~/server/functions/*
// modules) because it's shared between two ingest adapters that authenticate
// differently: this file (cookie session, for the GM's browser) and the
// phase-3 HTTP routes under ~/routes/api/audio/ (bearer token, for the
// Python generator — see ~/server/functions/audio-auth.ts). Resolving auth
// here keeps that difference out of the shared implementation, so validation
// and the HeadObject size check in confirmAudioUpload can't drift between
// the two callers.
//
// `requireActor` (identity resolution — see ~/utils/require-actor.ts for the
// full rationale) is reached via a dynamic `await import('~/utils/require-
// actor')` INSIDE each handler below, never a module-scope `import`, and it
// is never re-exported from this module either. A static import/export pair
// used to exist here (this file defined `requireActor` and exported it for
// `~/utils/soundboard-server-fns.ts` to import) and broke `npm run build`:
// see ~/utils/require-actor.ts's doc comment for the exact mechanism. The
// short version: a static import edge into (or out of) a module makes the
// imported code reachable from the client's module graph even when every
// call site is inside a `.handler()` body that TanStack Start strips from
// the client bundle — the bundler can't know "only ever called from inside
// a handler" from the import graph alone. Dynamic imports, scoped inside
// each handler, avoid that: `createServerFn`'s `.handler()` body only ever
// executes on the server, so the dynamic import inside it never reaches the
// browser. This mirrors the existing pattern in ~/utils/uploadToR2.ts and
// ~/server/functions/rpc.ts, which dynamically import their server-only
// implementation modules the same way — and now applies to `requireActor`
// itself, not just `~/server/session` underneath it.
//
// `SessionUser.id` is the OAuth provider's subject id (see
// `toSessionUser`/`upsertUser` in `~/server/utils/oauth.ts`), not this app's
// Mongo `_id` — but `AudioAsset.ownerId` is a Mongoose `ObjectId` `ref:
// 'User'` (`~/server/db/models/AudioAsset.ts`), same as every other
// per-user-scoped collection (e.g. `Campaign.gameMasterId`). Every other
// caller that scopes a query this way resolves the real id first via
// `User.findOne({ providerId: user.id })` (see `~/server/functions/
// campaigns.ts`); skipping that step here and handing `AudioAsset.find`/
// `.create` the provider id string instead throws a Mongoose `CastError` on
// every call, for every user — caught by this task's E2E suite hitting a
// genuinely seeded, real `ownerId`.
//
// `requireActor()` returns BOTH ids, because the two are used for different
// things and conflating them is what produced the split telemetry identity
// this branch shipped with. `userId` (Mongo `_id`) is the only value that
// may scope a query; `sessionUserId` (the OAuth provider id) is the identity
// every other server function in this codebase tags telemetry with, so the
// same human stays one person in GlitchTip and Umami whether they are
// uploading an image or an audio file. See the `Actor` type in
// `~/server/functions/audio.ts`.
//
// RATE LIMITING. The five ingest handlers below (both upload halves, both
// once-variant halves, and `retryAudioAssetFn`) share one per-account token
// bucket, `audioIngestLimiter` — see `~/lib/audio-rate-limits.ts` for the
// numbers and the legitimate-burst reasoning behind each. Three properties of
// how it is applied here are load-bearing:
//
//  1. It runs AFTER `requireActor()`, so the key is the caller's Mongo `_id`
//     rather than an IP. An abuser cannot rotate out of their own bucket, and
//     a shared NAT is not one bucket.
//  2. It runs BEFORE the `~/server/functions/audio` call, so a refused
//     request never reaches Mongo or R2. That is what the
//     `not.toHaveBeenCalled()` assertions in
//     `tests/utils/audio-server-fns.test.ts` pin: a test that only asserted
//     the rejection would still pass with this gate deleted, because
//     something further down throws anyway.
//  3. It refuses with `AudioClientError`, which `reportAudioError` excludes
//     from GlitchTip. A limiter that filed an event per rejection would hand
//     an attacker the exact telemetry-amplification lever this phase exists
//     to close — the rejection volume is the attacker's parameter.
//
// TWO MORE buckets cover the rest of this file's writes:
// `libraryMutationLimiter` on `updateAudioAssetFn`/`deleteAudioAssetFn`, and
// the tighter `orphanCleanupLimiter` on the two orphan-cleanup wrappers at the
// bottom. See the note above each, and `~/lib/audio-rate-limits.ts` for the
// sizing.
//
// EXACTLY THREE ENDPOINTS HERE ARE UNGATED, and the reason is specific to each
// rather than a blanket claim. An earlier version of this comment asserted
// that every non-ingest endpoint "enqueues no work, spends no R2, and grows no
// footprint"; review found that false for `deleteAudioAsset` on both counts,
// so the list below states only what is true of the endpoint it names:
//
//  - `listAudioAssetsFn` — a read. Bounded by its projection and its `limit`;
//    a cursor it cannot decode raises `AudioClientError`, which files nothing.
//  - `bulkTagAudioAssetsFn` — an `updateMany` that returns `{ modified: 0 }`
//    when nothing matches. It has NO not-found throw, so unlike its two
//    single-asset siblings it has no caller-triggerable capture path at all,
//    and its `ids` array is bounded by `.max(200)` in the schema.
//  - `getAudioStorageUsageFn` (Task 5) — a read with no caller input at all,
//    so there is no shape for a caller to vary and nothing to raise
//    `AudioClientError` over. It runs the one `$group` aggregation the design
//    doc already costs at "tens of milliseconds" (see
//    `~/server/functions/audio-quota.ts`), touches no R2, and its cost scales
//    with the caller's own asset count, not with how often they call it.
//
// If a new endpoint is added here, it needs a bucket unless one of those
// sentences can be written truthfully about it.
//
// `~/lib/audio-rate-limits` is imported STATICALLY, unlike everything else
// reached from these handlers, and that is safe precisely because it is
// import-free apart from `~/lib/rate-limit` (also import-free). Nothing that
// touches mongoose or `@sentry/node` may be added to it — see
// `~/utils/require-actor.ts`.

export const createAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(createAudioUploadSchema)
  .handler(async ({ data }) => {
    const { createAudioUpload, AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = audioIngestLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('upload', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return createAudioUpload({ data, ...actor });
  });

export const confirmAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(confirmAudioUploadSchema)
  .handler(async ({ data }) => {
    const { confirmAudioUpload, AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = audioIngestLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('upload', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return confirmAudioUpload({ data, ...actor });
  });

// Task 18: attach a `∞`/`1×` once-variant to an existing `music` asset.
// Same presign -> PUT -> confirm shape as createAudioUploadFn/
// confirmAudioUploadFn above, just targeting an existing row instead of
// creating one — and so the same ingest bucket: a once-variant confirm
// enqueues transcode work exactly like a source confirm does, and a bucket
// that skipped it would leave the queue-starvation lever half-open.
export const createOnceVariantUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(attachOnceVariantUploadSchema)
  .handler(async ({ data }) => {
    const { createOnceVariantUpload, AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = audioIngestLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('upload', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return createOnceVariantUpload({ data, ...actor });
  });

export const confirmOnceVariantUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(confirmOnceVariantUploadSchema)
  .handler(async ({ data }) => {
    const { confirmOnceVariantUpload, AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = audioIngestLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('upload', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return confirmOnceVariantUpload({ data, ...actor });
  });

export const listAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(listAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    return listAudioAssets({ data, ...(await requireActor()) });
  });

export const updateAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(updateAudioAssetSchema)
  .handler(async ({ data }) => {
    const { updateAudioAsset, AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = libraryMutationLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('library edit', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return updateAudioAsset({ data, ...actor });
  });

export const bulkTagAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(bulkTagAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    return bulkTagAudioAssets({ data, ...(await requireActor()) });
  });

// On the SAME ingest bucket as the four upload halves above, which the
// design's table does not name explicitly. It belongs there on effect rather
// than on name: `retryAudioAsset` flips a `failed` asset back to `pending`
// with `attempts: 0`, which is precisely what a confirm does — it makes a row
// claimable by the single-replica worker. Called in a loop against ONE asset
// it enqueues unbounded transcode work, so a limiter that covered `confirm`
// but not `retry` would leave the queue-starvation lever the design names
// open under a different verb.
export const retryAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(retryAudioAssetSchema)
  .handler(async ({ data }) => {
    const { retryAudioAsset, AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = audioIngestLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('retry', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return retryAudioAsset({ data, ...actor });
  });

// On `libraryMutationLimiter` with `updateAudioAssetFn`: this one spends R2 —
// up to six `DeleteObjectCommand` calls per request — and both share a
// caller-triggerable not-found path. See `~/lib/audio-rate-limits.ts`.
export const deleteAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteAudioAssetSchema)
  .handler(async ({ data }) => {
    const { deleteAudioAsset, AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = libraryMutationLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('library edit', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return deleteAudioAsset({ data, ...actor });
  });

// Task 5: the usage figure `/audio` renders as "X of Y used" near the
// dropzone. Wraps TWO functions, both already used server-side by
// `assertUnderStorageQuota` (`~/server/functions/audio.ts`) to enforce the
// write-side quota:
//
//  - `getUserStorageUsage` (`~/server/functions/audio-quota.ts`) — the same
//    aggregation the quota check runs, scoped to the caller's own `ownerId`.
//  - `getAudioUserQuotaBytes` (`~/server/functions/audio.ts`) — reads
//    `AUDIO_USER_QUOTA_BYTES` fresh from server env on every call, the exact
//    function the enforcement path calls. Returning ITS result, rather than
//    hand-copying "2 GiB" into a client-side constant, is what keeps the
//    number this bar shows from ever drifting off the number that actually
//    refuses an upload — including after Task 11 lets an operator change the
//    env var without an image rebuild: the next call to this function picks
//    the new value up with no client change at all.
//
// No `.inputValidator()` — this takes nothing from the caller, same shape as
// `listPackagesFn` in `~/utils/soundboard-server-fns.ts`.
export const getAudioStorageUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getUserStorageUsage } = await import('~/server/functions/audio-quota');
  const { getAudioUserQuotaBytes } = await import('~/server/functions/audio');
  const { requireActor } = await import('~/utils/require-actor');
  const { userId } = await requireActor();
  const usage = await getUserStorageUsage(userId);
  return { ...usage, limitBytes: getAudioUserQuotaBytes() };
});

// ---------------------------------------------------------------------------
// Owner-scoped orphan cleanup (see ~/server/functions/audio-cleanup.ts).
// Neither takes a user id from the client — both are scoped entirely by the
// session-resolved actor, which is the whole point of them existing separately
// from the campaign image scanner.
//
// Both are gated by `orphanCleanupLimiter`, the tightest bucket on this
// surface: each call pages an R2 `ListObjectsV2` over the caller's prefix
// (up to 10,000 keys) and fires a `serverCaptureEvent`, so an ungated loop
// makes R2 spend AND Umami event volume attacker-controlled. See
// `~/lib/audio-rate-limits.ts` for the sizing.
//
// The refusal is an `AudioClientError` — the audio surface's client-error
// class — dynamically imported from `~/server/functions/audio` rather than
// from `audio-cleanup`, which has no client-error class of its own. Note that
// `audio-cleanup.ts`'s own `catch` calls `serverCaptureException`
// unconditionally, with no `report*Error`-style exclusion; that is fine here
// precisely BECAUSE the gate throws before the call, so a rejection never
// enters that try/catch and no event is filed either way. Anyone later moving
// this check inside `audio-cleanup.ts` must add the exclusion first.
// ---------------------------------------------------------------------------

export const scanOrphanAudioFn = createServerFn({ method: 'POST' })
  .inputValidator(scanOrphanAudioSchema)
  .handler(async ({ data }) => {
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const { AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = orphanCleanupLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('orphan cleanup', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return scanOrphanAudio({ data, ...actor });
  });

export const deleteOrphanAudioFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteOrphanAudioSchema)
  .handler(async ({ data }) => {
    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const { AudioClientError } = await import('~/server/functions/audio');
    const { requireActor } = await import('~/utils/require-actor');
    const actor = await requireActor();
    const gate = orphanCleanupLimiter.check(actor.userId);
    if (!gate.allowed) {
      throw new AudioClientError(rateLimitMessage('orphan cleanup', gate.retryAfterMs), {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    return deleteOrphanAudio({ data, ...actor });
  });
