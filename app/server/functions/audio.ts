import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { createR2, getAudioUploadUrl } from './uploads';
import { AUDIO_MAX_BYTES, AUDIO_SOURCE_TYPES } from '~/types/audio';
import type { createAudioUploadSchema, confirmAudioUploadSchema } from '~/types/schemas/audio';

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled';
}

export async function createAudioUpload({
  data,
  userId,
}: {
  data: z.infer<typeof createAudioUploadSchema>;
  userId: string;
}) {
  try {
    await ensureDb();
    const { uploadUrl, key } = await getAudioUploadUrl({
      contentType: data.contentType,
      bytes: data.bytes,
    });

    const doc = await AudioAsset.create({
      ownerId: userId,
      title: data.title ?? titleFromFilename(data.filename),
      kind: data.kind,
      environment: data.environment ?? [],
      mood: data.mood ?? [],
      intensity: data.intensity ?? null,
      tags: data.tags ?? [],
      sourceKey: key,
      sourceBytes: data.bytes,
      status: 'uploading',
    });

    return { assetId: String(doc._id), uploadUrl, key };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'createAudioUpload' });
    throw e;
  }
}

export async function confirmAudioUpload({
  data,
  userId,
}: {
  data: z.infer<typeof confirmAudioUploadSchema>;
  userId: string;
}) {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new Error('Audio asset not found');

    const { client, bucket } = createR2();
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.sourceKey }));

    const bytes = head.ContentLength ?? 0;
    const type = head.ContentType ?? '';
    const tooLarge = bytes > AUDIO_MAX_BYTES;
    const badType = !AUDIO_SOURCE_TYPES.has(type);

    if (tooLarge || badType) {
      // The object must go, or we pay storage for a file we refused.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.sourceKey }));
      const reason = tooLarge
        ? `File too large: ${bytes} bytes exceeds ${AUDIO_MAX_BYTES}`
        : `Unsupported audio type: ${type}`;
      await AudioAsset.findOneAndUpdate(
        { _id: data.assetId, ownerId: userId },
        { $set: { status: 'failed', lastError: reason, updatedAt: new Date() } }
      );
      throw new Error(reason);
    }

    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId },
      { $set: { status: 'pending', sourceBytes: bytes, updatedAt: new Date() } },
      { new: true }
    );

    serverCaptureEvent(userId, 'audio_upload_confirmed', { assetId: data.assetId });
    return { assetId: data.assetId, status: updated?.status ?? 'pending' };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'confirmAudioUpload' });
    throw e;
  }
}
