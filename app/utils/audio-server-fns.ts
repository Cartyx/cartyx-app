import { createServerFn } from '@tanstack/react-start';
import {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
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
// `~/server/session` is imported dynamically, inside each handler, rather
// than at module scope: a static `import ... from '~/server/session'` would
// (a) trip the `no-restricted-imports` lint rule that keeps ~/server/* out
// of app/utils/**, and (b) pull server-only code (jose, cookie helpers) into
// the client bundle. `createServerFn`'s `.handler()` body only ever executes
// on the server — the client bundle gets a stub that calls the network
// endpoint instead — so a dynamic import inside it never reaches the
// browser. This mirrors the existing pattern in ~/utils/uploadToR2.ts and
// ~/server/functions/rpc.ts, which dynamically import their server-only
// implementation modules the same way.
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
// It returns BOTH ids, because the two are used for different things and
// conflating them is what produced the split telemetry identity this branch
// shipped with. `userId` (Mongo `_id`) is the only value that may scope a
// query; `sessionUserId` (the OAuth provider id) is the identity every other
// server function in this codebase tags telemetry with, so the same human
// stays one person in GlitchTip and Umami whether they are uploading an image
// or an audio file. See the `Actor` type in `~/server/functions/audio.ts`.
//
// Exported (not module-private) so `~/utils/soundboard-server-fns.ts` can
// import and reuse it rather than defining a second copy — every wrapper in
// this codebase that resolves the browser session to a Mongo `userId` needs
// the exact same provider-id-to-`_id` resolution, and two copies is how they
// drift (see this branch's phase-1 postmortem, above).
export async function requireActor(): Promise<{ userId: string; sessionUserId: string }> {
  const { getSession } = await import('~/server/session');
  const { connectDB } = await import('~/server/db/connection');
  const { User } = await import('~/server/db/models/User');
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  await connectDB();
  const dbUser = await User.findOne({ providerId: session.id }).select('_id').lean();
  if (!dbUser) throw new Error('User not found');
  return { userId: String(dbUser._id), sessionUserId: session.id };
}

export const createAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(createAudioUploadSchema)
  .handler(async ({ data }) => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    return createAudioUpload({ data, ...(await requireActor()) });
  });

export const confirmAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(confirmAudioUploadSchema)
  .handler(async ({ data }) => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    return confirmAudioUpload({ data, ...(await requireActor()) });
  });

export const listAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(listAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    return listAudioAssets({ data, ...(await requireActor()) });
  });

export const updateAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(updateAudioAssetSchema)
  .handler(async ({ data }) => {
    const { updateAudioAsset } = await import('~/server/functions/audio');
    return updateAudioAsset({ data, ...(await requireActor()) });
  });

export const bulkTagAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(bulkTagAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');
    return bulkTagAudioAssets({ data, ...(await requireActor()) });
  });

export const retryAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(retryAudioAssetSchema)
  .handler(async ({ data }) => {
    const { retryAudioAsset } = await import('~/server/functions/audio');
    return retryAudioAsset({ data, ...(await requireActor()) });
  });

export const deleteAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteAudioAssetSchema)
  .handler(async ({ data }) => {
    const { deleteAudioAsset } = await import('~/server/functions/audio');
    return deleteAudioAsset({ data, ...(await requireActor()) });
  });

// ---------------------------------------------------------------------------
// Owner-scoped orphan cleanup (see ~/server/functions/audio-cleanup.ts).
// Neither takes a user id from the client — both are scoped entirely by the
// session-resolved actor, which is the whole point of them existing separately
// from the campaign image scanner.
// ---------------------------------------------------------------------------

export const scanOrphanAudioFn = createServerFn({ method: 'POST' })
  .inputValidator(scanOrphanAudioSchema)
  .handler(async ({ data }) => {
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    return scanOrphanAudio({ data, ...(await requireActor()) });
  });

export const deleteOrphanAudioFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteOrphanAudioSchema)
  .handler(async ({ data }) => {
    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    return deleteOrphanAudio({ data, ...(await requireActor()) });
  });
