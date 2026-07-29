import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { escapeRegExp, normalizeTags } from '../utils/helpers';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { createR2, getAudioUploadUrl } from './uploads';
import { AUDIO_MAX_BYTES, AUDIO_SOURCE_TYPES } from '~/types/audio';
import type { AudioAssetData } from '~/types/audio';
import type {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
  listAudioAssetsSchema,
  updateAudioAssetSchema,
  bulkTagAudioAssetsSchema,
  deleteAudioAssetSchema,
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
    status: (d.status ?? 'uploading') as AudioAssetData['status'],
    durationMs: d.durationMs ?? null,
    loudnessLufs: d.loudnessLufs ?? null,
    peaks: d.peaks ?? [],
    renditions: d.renditions ?? {},
    lastError: d.lastError ?? null,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
  };
}

/**
 * The list is sorted `{ createdAt: -1, _id: -1 }`, so the pagination cursor must
 * constrain on both fields together (not `_id` alone) or a page boundary that falls
 * between two documents with different `createdAt` values can skip or duplicate rows.
 * Encoded as `<createdAt epoch ms>_<id>` — compact, and the delimiter can't collide
 * with either part (epoch ms is digits-only, Mongo ids don't contain `_`).
 */
function encodeAudioCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}_${id}`;
}

function decodeAudioCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.indexOf('_');
  if (idx <= 0 || idx === cursor.length - 1) return null;
  const ms = Number(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (!Number.isFinite(ms)) return null;
  return { createdAt: new Date(ms), id };
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
    if (data.search) query.title = { $regex: escapeRegExp(data.search), $options: 'i' };
    if (data.intensityMin != null || data.intensityMax != null) {
      const range: Record<string, number> = {};
      if (data.intensityMin != null) range.$gte = data.intensityMin;
      if (data.intensityMax != null) range.$lte = data.intensityMax;
      query.intensity = range;
    }
    if (data.needsTagging) {
      query.status = 'ready';
      // needsTagging means "ready but unclassified": tags and environment must both
      // be empty. If the caller *also* passed an explicit tags/environment filter
      // (query.tags / query.environment already set above), don't clobber it — merge
      // both requirements with $and instead. Note that requiring a facet array to be
      // both non-empty (from the caller's filter) and $size:0 (from needsTagging) is
      // never satisfiable; that's the caller asking for a contradiction, and an empty
      // result set is the honest answer, not an implementation bug.
      const explicitTags = query.tags;
      const explicitEnvironment = query.environment;
      if (explicitTags !== undefined || explicitEnvironment !== undefined) {
        delete query.tags;
        delete query.environment;
        const and: Record<string, unknown>[] = [
          { tags: { $size: 0 } },
          { environment: { $size: 0 } },
        ];
        if (explicitTags !== undefined) and.push({ tags: explicitTags });
        if (explicitEnvironment !== undefined) and.push({ environment: explicitEnvironment });
        query.$and = and;
      } else {
        query.tags = { $size: 0 };
        query.environment = { $size: 0 };
      }
    }
    if (data.cursor) {
      const decoded = decodeAudioCursor(data.cursor);
      if (decoded) {
        // Compound cursor: strictly older createdAt, OR same createdAt with a
        // strictly smaller _id — matches the `{ createdAt: -1, _id: -1 }` sort.
        query.$or = [
          { createdAt: { $lt: decoded.createdAt } },
          { createdAt: decoded.createdAt, _id: { $lt: decoded.id } },
        ];
      }
    }

    const rows = (await AudioAsset.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(data.limit)
      .lean()) as AudioDoc[];

    const items = rows.map(serializeAudioAsset);
    const lastRow = rows[rows.length - 1];
    const nextCursor =
      items.length === data.limit && lastRow
        ? encodeAudioCursor(lastRow.createdAt as Date, items[items.length - 1].id)
        : null;
    return { items, nextCursor };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'listAudioAssets' });
    throw e;
  }
}

export async function updateAudioAsset({
  data,
  userId,
}: {
  data: z.infer<typeof updateAudioAssetSchema>;
  userId: string;
}): Promise<AudioAssetData> {
  try {
    await ensureDb();
    // Only include fields the caller actually provided — the pre('save') hook that
    // normalizes tags does not fire on findOneAndUpdate, and an omitted field must
    // not be clobbered with undefined/null via $set.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) set.title = data.title;
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.environment !== undefined) set.environment = data.environment;
    if (data.mood !== undefined) set.mood = data.mood;
    if (data.intensity !== undefined) set.intensity = data.intensity;
    if (data.tags !== undefined) set.tags = normalizeTags(data.tags);

    const doc = await AudioAsset.findOneAndUpdate(
      { _id: data.id, ownerId: userId },
      { $set: set },
      { new: true }
    );
    if (!doc) throw new Error('Audio asset not found');
    return serializeAudioAsset(doc as unknown as AudioDoc);
  } catch (e) {
    serverCaptureException(e, userId, { action: 'updateAudioAsset' });
    throw e;
  }
}

export async function bulkTagAudioAssets({
  data,
  userId,
}: {
  data: z.infer<typeof bulkTagAudioAssetsSchema>;
  userId: string;
}): Promise<{ modified: number }> {
  try {
    await ensureDb();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.environment !== undefined) set.environment = data.environment;
    if (data.mood !== undefined) set.mood = data.mood;
    if (data.intensity !== undefined) set.intensity = data.intensity;

    const update: Record<string, unknown> = { $set: set };
    // Distinguish "tags absent" (leave alone) from "tags: []" (explicit, meaningful
    // input): in replace mode an empty array means "clear the tags," so it must
    // still reach $set. In add mode an empty array has nothing to add, so it's a
    // genuine no-op and must not emit $addToSet with an empty $each.
    if (data.tags !== undefined) {
      const tags = normalizeTags(data.tags);
      if (data.tagMode === 'replace') {
        // Whole-array overwrite — existing tags are discarded, including down to [].
        set.tags = tags;
      } else if (tags.length) {
        // $addToSet + $each preserves existing tags; findOneAndUpdate's own
        // pre('save') normalization doesn't run here, so tags are normalized above.
        update.$addToSet = { tags: { $each: tags } };
      }
    }

    const res = await AudioAsset.updateMany({ _id: { $in: data.ids }, ownerId: userId }, update);
    return { modified: res.modifiedCount ?? 0 };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'bulkTagAudioAssets' });
    throw e;
  }
}

export async function deleteAudioAsset({
  data,
  userId,
}: {
  data: z.infer<typeof deleteAudioAssetSchema>;
  userId: string;
}): Promise<{ deleted: boolean }> {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.id, ownerId: userId });
    if (!asset) throw new Error('Audio asset not found');

    const { client, bucket } = createR2();
    // onceRenditions is reserved for phase 2's infinite/one-shot music variants and
    // is never written in phase 1 (see AudioAsset model comment), so there is
    // nothing there to clean up yet.
    const keys = [asset.sourceKey, asset.renditions?.opus?.key, asset.renditions?.aac?.key].filter(
      (k): k is string => Boolean(k)
    );

    // Delete every R2 object before the row: if the row went first and this loop
    // then failed partway, the remaining objects would be orphaned with nothing
    // in the DB pointing at them.
    for (const Key of keys) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    }

    await AudioAsset.deleteOne({ _id: data.id, ownerId: userId });
    return { deleted: true };
  } catch (e) {
    serverCaptureException(e, userId, { action: 'deleteAudioAsset' });
    throw e;
  }
}
