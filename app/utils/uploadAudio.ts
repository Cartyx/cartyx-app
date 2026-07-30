import { createAudioUploadFn, confirmAudioUploadFn } from '~/utils/audio-server-fns';
import { captureException } from '~/utils/telemetry-client';
import { isBackendDown, reportBackendFailure } from '~/utils/backend-health';
import { BackendUnavailableError } from '~/utils/error-classification';
import type { AudioKind, AudioEnvironment, AudioMood } from '~/types/audio';

export type AudioUploadMeta = {
  kind: AudioKind;
  title?: string;
  environment?: AudioEnvironment[];
  mood?: AudioMood[];
  intensity?: number | null;
  tags?: string[];
};

/**
 * Presign -> PUT -> confirm. Mirrors ~/utils/uploadToR2.ts's shape (breaker
 * guard, report/capture on failure) with one addition: a failed PUT must
 * never be confirmed. confirmAudioUpload's HeadObject call is the only real
 * enforcement of the size cap in the system — a presigned PUT URL cannot
 * enforce Content-Length itself (R2/S3 only support that on POST policies,
 * which this flow doesn't use). Confirming an upload that never landed would
 * flip the asset to `pending` with no object behind it, and the phase-2
 * transcode worker would then claim and fail it.
 */
export async function uploadAudioFile(
  file: File,
  meta: AudioUploadMeta
): Promise<{ assetId: string }> {
  if (isBackendDown()) throw new BackendUnavailableError();
  try {
    const { assetId, uploadUrl } = await createAudioUploadFn({
      data: {
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
        title: meta.title,
        kind: meta.kind,
        environment: meta.environment ?? [],
        mood: meta.mood ?? [],
        intensity: meta.intensity ?? null,
        tags: meta.tags ?? [],
      },
    });

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    // Do not confirm a failed PUT — see the doc comment above.
    if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);

    await confirmAudioUploadFn({ data: { assetId } });
    return { assetId };
  } catch (e) {
    reportBackendFailure(e);
    captureException(e, { action: 'uploadAudioFile', fileName: file.name, fileSize: file.size });
    throw e;
  }
}
