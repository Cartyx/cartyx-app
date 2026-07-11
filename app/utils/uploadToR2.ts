import { createServerFn } from '@tanstack/react-start';
import { captureException } from '~/providers/TelemetryProvider';
import { getUploadUrlSchema } from '~/types/schemas/uploads';
import { isBackendDown, reportBackendFailure } from '~/utils/backend-health';
import { BackendUnavailableError } from '~/utils/error-classification';

const getUploadUrlFn = createServerFn({ method: 'POST' })
  .inputValidator(getUploadUrlSchema)
  .handler(async ({ data }) => {
    const { getUploadUrl } = await import('~/server/functions/uploads');
    return getUploadUrl({ data });
  });

export async function uploadToR2(
  file: File,
  subdir = 'uploads/campaigns'
): Promise<{ imageKey: string; publicUrl: string }> {
  if (isBackendDown()) throw new BackendUnavailableError();
  try {
    const { uploadUrl, imageKey, publicUrl } = await getUploadUrlFn({
      data: { contentType: file.type, subdir },
    });

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });

    if (!response.ok) {
      throw new Error(`R2 upload failed: ${response.status}`);
    }

    return { imageKey, publicUrl };
  } catch (e) {
    reportBackendFailure(e);
    captureException(e, { action: 'uploadToR2', fileName: file.name, fileSize: file.size });
    throw e;
  }
}
