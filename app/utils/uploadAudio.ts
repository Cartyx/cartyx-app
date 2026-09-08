import {
  createAudioUploadFn,
  confirmAudioUploadFn,
  createOnceVariantUploadFn,
  confirmOnceVariantUploadFn,
} from '~/utils/audio-server-fns';
import { captureException } from '~/utils/telemetry-client';
import { isClientRefusal } from '~/lib/client-refusal';
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
    // A REFUSAL IS NOT A FAULT, and it must not be reported as one. The
    // server takes deliberate care to keep quota / pending-job-cap /
    // rate-limit / not-found refusals out of GlitchTip — that is the entire
    // reason `AudioClientError` exists, and `reportAudioError` excludes it —
    // on the reasoning that a refusal the caller can trigger at will makes
    // report volume the caller's own parameter. Capturing here undid that
    // from the other side of the wire: a GM at their storage quota filed one
    // GlitchTip event per upload attempt, and a folder drop that met the
    // pending-job cap filed one per refused file. Same control, sibling path.
    //
    // The refusal still reaches the user: it is rethrown below, and
    // `AudioUploadDropzone` renders its message against the file it belongs
    // to. Only the fault report is suppressed. Genuine failures — a broken
    // PUT, a 500, a decode error — are untouched.
    if (!isClientRefusal(e)) {
      captureException(e, { action: 'uploadAudioFile', fileName: file.name, fileSize: file.size });
    }
    throw e;
  }
}

/**
 * Task 18: attach a `∞`/`1×` once-variant to an existing `music` asset.
 * Same presign -> PUT -> confirm shape as `uploadAudioFile` above (same
 * reason: a failed PUT must never be confirmed), targeting an existing
 * `assetId` instead of minting a new one.
 */
export async function uploadOnceVariantFile(
  assetId: string,
  file: File
): Promise<{ assetId: string }> {
  if (isBackendDown()) throw new BackendUnavailableError();
  try {
    const { uploadUrl } = await createOnceVariantUploadFn({
      data: {
        assetId,
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
      },
    });

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);

    await confirmOnceVariantUploadFn({ data: { assetId } });
    return { assetId };
  } catch (e) {
    reportBackendFailure(e);
    // Same exclusion, same reasoning as `uploadAudioFile` above — this path
    // reaches the identical quota and pending-job-cap refusals through
    // `createOnceVariantUpload`/`confirmOnceVariantUpload`.
    if (!isClientRefusal(e)) {
      captureException(e, {
        action: 'uploadOnceVariantFile',
        assetId,
        fileName: file.name,
        fileSize: file.size,
      });
    }
    throw e;
  }
}
