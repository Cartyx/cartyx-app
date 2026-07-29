import { createFileRoute } from '@tanstack/react-router';
import { resolveApiUser } from '~/server/functions/audio-auth';
import { confirmAudioUpload } from '~/server/functions/audio';

// confirmAudioUpload's thrown messages that are safe to hand back verbatim to an
// external caller: each one describes something about *this caller's own request*
// (their asset, their file's real size/type) rather than internal state. Anything
// else (DB/S3 client errors, network failures, ...) falls back to a generic
// message — those can carry infrastructure detail (bucket names, driver errors)
// that shouldn't leave the server.
const SAFE_CONFIRM_ERROR = /^(Audio asset not found|File too large: |Unsupported audio type: )/;

export async function post({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}): Promise<Response> {
  const userId = await resolveApiUser(request);
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return Response.json(await confirmAudioUpload({ data: { assetId: params.id }, userId }));
  } catch (e) {
    const message =
      e instanceof Error && SAFE_CONFIRM_ERROR.test(e.message) ? e.message : 'Confirm failed';
    return Response.json({ error: message }, { status: 400 });
  }
}

export const Route = createFileRoute('/api/audio/uploads/$id/confirm')({
  server: { handlers: { POST: post } },
});
