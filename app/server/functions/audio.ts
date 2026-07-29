import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { createR2, getAudioUploadUrl } from './uploads';
import { AUDIO_MAX_BYTES, AUDIO_SOURCE_TYPES } from '~/types/audio';
import type { AudioAssetData } from '~/types/audio';
import type {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
  listAudioAssetsSchema,
} from '~/types/schemas/audio';

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

type AudioDoc = Record<string, unknown>;

export function serializeAudioAsset(a: AudioDoc): AudioAssetData {
  const d = a as {
    _id: unknown;
    ownerId: unknown;
    title?: string;
    kind?: string;
    environment?: string[];
    mood?: string[];
    intensity?: number | null;
    tags?: string[];
    status?: string;
    durationMs?: number | null;
    loudnessLufs?: number | null;
    peaks?: number[];
    renditions?: AudioAssetData['renditions'];
    lastError?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: String(d._id),
    ownerId: String(d.ownerId),
    title: d.title ?? '',
    kind: (d.kind ?? 'ambience') as AudioAssetData['kind'],
    environment: d.environment ?? [],
    mood: d.mood ?? [],
    intensity: d.intensity ?? null,
    tags: d.tags ?? [],
    status: (d.status ?? 'pending') as AudioAssetData['status'],
    durationMs: d.durationMs ?? null,
    loudnessLufs: d.loudnessLufs ?? null,
    peaks: d.peaks ?? [],
    renditions: d.renditions ?? {},
    lastError: d.lastError ?? null,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
  };
}

export async function listAudioAssets({
  data,
  userId,
}: {
  data: z.infer<typeof listAudioAssetsSchema>;
  userId: string;
}): Promise<{ items: AudioAssetData[]; nextCursor: string | null }> {
  try {
    await ensureDb();

    const query: Record<string, unknown> = { ownerId: userId };
    if (data.kind) query.kind = data.kind;
    if (data.environment?.length) query.environment = { $in: data.environment };
    if (data.mood?.length) query.mood = { $in: data.mood };
    if (data.tags?.length) query.tags = { $all: data.tags };
    if (data.search) query.title = { $regex: data.search, $options: 'i' };
    if (data.intensityMin != null || data.intensityMax != null) {
      const range: Record<string, number> = {};
      if (data.intensityMin != null) range.$gte = data.intensityMin;
      if (data.intensityMax != null) range.$lte = data.intensityMax;
      query.intensity = range;
    }
    if (data.needsTagging) {
      query.status = 'ready';
      query.tags = { $size: 0 };
      query.environment = { $size: 0 };
    }
    // Cursor is the last seen _id under a stable createdAt DESC, _id DESC sort.
    if (data.cursor) query._id = { $lt: data.cursor };

    const rows = (await AudioAsset.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(data.limit)
      .lean()) as AudioDoc[];

    const items = rows.map(serializeAudioAsset);
    const nextCursor = items.length === data.limit ? items[items.length - 1].id : null;
    return { items, nextCursor };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'listAudioAssets' });
    throw e;
  }
}
