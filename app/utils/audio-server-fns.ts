import { createServerFn } from '@tanstack/react-start';
import {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
  listAudioAssetsSchema,
  updateAudioAssetSchema,
  bulkTagAudioAssetsSchema,
  deleteAudioAssetSchema,
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
async function requireUserId(): Promise<string> {
  const { getSession } = await import('~/server/session');
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export const createAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(createAudioUploadSchema)
  .handler(async ({ data }) => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    return createAudioUpload({ data, userId: await requireUserId() });
  });

export const confirmAudioUploadFn = createServerFn({ method: 'POST' })
  .inputValidator(confirmAudioUploadSchema)
  .handler(async ({ data }) => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    return confirmAudioUpload({ data, userId: await requireUserId() });
  });

export const listAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(listAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    return listAudioAssets({ data, userId: await requireUserId() });
  });

export const updateAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(updateAudioAssetSchema)
  .handler(async ({ data }) => {
    const { updateAudioAsset } = await import('~/server/functions/audio');
    return updateAudioAsset({ data, userId: await requireUserId() });
  });

export const bulkTagAudioAssetsFn = createServerFn({ method: 'POST' })
  .inputValidator(bulkTagAudioAssetsSchema)
  .handler(async ({ data }) => {
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');
    return bulkTagAudioAssets({ data, userId: await requireUserId() });
  });

export const deleteAudioAssetFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteAudioAssetSchema)
  .handler(async ({ data }) => {
    const { deleteAudioAsset } = await import('~/server/functions/audio');
    return deleteAudioAsset({ data, userId: await requireUserId() });
  });
