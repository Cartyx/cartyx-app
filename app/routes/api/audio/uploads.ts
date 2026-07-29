import { createFileRoute } from '@tanstack/react-router';
import { resolveApiUser } from '~/server/functions/audio-auth';
import { createAudioUpload } from '~/server/functions/audio';
import { createAudioUploadSchema } from '~/types/schemas/audio';

export async function post({ request }: { request: Request }): Promise<Response> {
  const userId = await resolveApiUser(request);
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = createAudioUploadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    return Response.json(await createAudioUpload({ data: parsed.data, userId }));
  } catch {
    // createAudioUpload already reports the real cause via serverCaptureException;
    // its failure modes here are R2/DB-layer errors, not caller mistakes, so the
    // response stays generic rather than echoing an internal error message.
    return Response.json({ error: 'Upload could not be started' }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/audio/uploads')({
  server: { handlers: { POST: post } },
});
