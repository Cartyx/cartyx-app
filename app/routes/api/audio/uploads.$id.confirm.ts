import { createFileRoute } from '@tanstack/react-router';
import { resolveApiUser } from '~/server/functions/audio-auth';
import { confirmAudioUpload } from '~/server/functions/audio';
import { confirmAudioUploadSchema } from '~/types/schemas/audio';

// confirmAudioUpload's thrown messages that are safe to hand back verbatim to an
// external caller: each one describes something about *this caller's own request*
// (their asset, their file's real size/type) rather than internal state. Anything
// else (DB/S3 client errors, network failures, ...) falls back to a generic
// message — those can carry infrastructure detail (bucket names, driver errors)
// that shouldn't leave the server.
const SAFE_CONFIRM_ERROR =
  /^(Audio asset not found|Audio asset is not awaiting confirmation|File too large: |Unsupported audio type: )/;

export async function post({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}): Promise<Response> {
  const userId = await resolveApiUser(request);
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // The path segment goes through the same schema the browser adapter uses,
  // rather than straight into the function. `params.id` is arbitrary client
  // input: `/api/audio/uploads/x/confirm` used to hand `"x"` to
  // `AudioAsset.findOne` and get a Mongoose CastError back, which this route's
  // catch turned into a 500 with a GlitchTip event — for a URL a client simply
  // typed wrong. A syntactically invalid id is a 400 and files nothing.
  const parsed = confirmAudioUploadSchema.safeParse({ assetId: params.id });
  if (!parsed.success) return Response.json({ error: 'Invalid asset id' }, { status: 400 });

  try {
    return Response.json(await confirmAudioUpload({ data: parsed.data, userId }));
  } catch (e) {
    // The status code has to split the same way the message does. A
    // SAFE_CONFIRM_ERROR describes something about the caller's own request
    // (their asset, their file's real size/type) — permanently wrong, 400,
    // don't retry. Everything else is an R2/Mongo-layer failure: retryable
    // infrastructure, so 500. Returning 400 for both told an external client's
    // retry logic that a transient outage was a permanent rejection — and
    // `POST /api/audio/uploads` already returns 500 for that same failure
    // class, so the two ingest routes disagreed with each other.
    const safe = e instanceof Error && SAFE_CONFIRM_ERROR.test(e.message);
    return Response.json(
      { error: safe ? (e as Error).message : 'Confirm failed' },
      { status: safe ? 400 : 500 }
    );
  }
}

export const Route = createFileRoute('/api/audio/uploads/$id/confirm')({
  server: { handlers: { POST: post } },
});
