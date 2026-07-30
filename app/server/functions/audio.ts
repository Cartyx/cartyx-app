import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { escapeRegExp, normalizeTags } from '../utils/helpers';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { resolveAudioStoragePrefix } from './audio-storage';
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
  retryAudioAssetSchema,
} from '~/types/schemas/audio';

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

/**
 * A mistake in the caller's own request — a malformed cursor, an id that isn't
 * an id. It is still an error (the caller must learn its request was rejected),
 * but it is NOT a server fault, so it must not file a GlitchTip event: a client
 * that sends one bad cursor per keystroke would otherwise author one error
 * report per keystroke, and the signal in GlitchTip is worth more than that.
 *
 * `~/types/schemas/audio.ts` rejects these shapes at the request boundary, so
 * this class covers the fail-closed paths behind it rather than the common case.
 */
export class AudioClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioClientError';
  }
}

/**
 * Every audio function takes the acting user twice, and the two values are
 * genuinely different things:
 *
 * - `userId` is the User document's Mongo `_id`. It is what `AudioAsset.ownerId`
 *   references, so it is the ONLY value that may be used to scope a query.
 * - `sessionUserId` is the OAuth provider's subject id — the identity the rest
 *   of this codebase tags telemetry with (`requireCampaignMember` returns it
 *   under exactly this name, and ~150 call sites across `app/server/functions/`
 *   pass it to `serverCaptureException`/`serverCaptureEvent`). Umami and
 *   GlitchTip already know each human by it.
 *
 * Before this split, the audio functions tagged telemetry with the Mongo `_id`
 * while every other server function tagged the provider id, so one human doing
 * an image upload and an audio upload showed up as two unrelated users.
 * `getAudioUploadUrl`'s doc comment used to assert that this could not happen;
 * it was describing the intent, not the behaviour.
 *
 * It is optional because the ingest surface is deliberately auth-agnostic (see
 * the module comment in `~/utils/audio-server-fns.ts`): the phase-3 bearer-token
 * adapter has no OAuth session to draw one from. When it's absent the Mongo id
 * is used, which is worse than a provider id but better than `undefined`.
 */
type Actor = { userId: string; sessionUserId?: string };

function telemetryId(actor: Actor): string {
  return actor.sessionUserId ?? actor.userId;
}

/** Report to GlitchTip unless the failure was the caller's own doing. */
function reportAudioError(e: unknown, actor: Actor, context: Record<string, unknown>) {
  if (e instanceof AudioClientError) return;
  serverCaptureException(e, telemetryId(actor), context);
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled';
}

export async function createAudioUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof createAudioUploadSchema>;
} & Actor) {
  try {
    await ensureDb();
    // Mints the user's R2 namespace if this is their first upload, and returns
    // the existing one otherwise — see `./audio-storage.ts`. It runs before the
    // presign because the key cannot be built without it, and before the row is
    // created so a user whose prefix cannot be resolved gets an error instead
    // of an asset pointing at a key nothing owns.
    const storagePrefix = await resolveAudioStoragePrefix(userId);
    const { uploadUrl, key } = await getAudioUploadUrl({
      contentType: data.contentType,
      bytes: data.bytes,
      storagePrefix,
      telemetryUserId: telemetryId({ userId, sessionUserId }),
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
      // Both explicitly null, and both must stay that way until confirm.
      // `sourceBytes` used to be seeded here from `data.bytes` — the client's
      // self-declared size, which nothing has verified and which the uploader
      // is free to lie about. Storing it made the field read as "this object is
      // N bytes" when it only ever meant "the uploader claimed N". The real
      // size arrives from confirm's HeadObject, and until then "unknown" is the
      // honest value. `confirmedAt` is the flag that says the check happened.
      sourceBytes: null,
      confirmedAt: null,
      status: 'uploading',
    });

    return { assetId: String(doc._id), uploadUrl, key };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'createAudioUpload' });
    throw e;
  }
}

export async function confirmAudioUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof confirmAudioUploadSchema>;
} & Actor) {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new Error('Audio asset not found');
    // Confirm is only meaningful for a row still awaiting its upload. Without
    // this precondition a logged-in user could replay confirm against an
    // already-`ready` asset to flip it back to `pending` and make the worker
    // re-transcode it — in a loop, on a single-node cluster. The check sits
    // ahead of the HeadObject/DeleteObject block on purpose: a replay must
    // never be able to delete the R2 object of a finished asset. The
    // `failed -> pending` transition belongs to `retryAudioAsset`, which owns
    // resetting the attempt budget with it.
    if (asset.status !== 'uploading') {
      throw new Error('Audio asset is not awaiting confirmation');
    }

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

    // `status: 'uploading'` again, and atomically this time: the read above can
    // race a concurrent confirm for the same asset, and only the filter on the
    // write makes exactly one of them win.
    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId, status: 'uploading' },
      {
        $set: {
          status: 'pending',
          // The HeadObject-measured size, and the stamp saying it was measured.
          // This is the ONLY place either is written; `retryAudioAsset` relies
          // on that.
          sourceBytes: bytes,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updated) throw new Error('Audio asset is not awaiting confirmation');

    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'audio_upload_confirmed', {
      assetId: data.assetId,
    });
    return { assetId: data.assetId, status: updated.status ?? 'pending' };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'confirmAudioUpload' });
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
    durationSamples?: number | null;
    loudnessTargetLufs?: number | null;
    peaks?: number[];
    renditions?: AudioAssetData['renditions'];
    lastError?: string | null;
    permanentFailure?: boolean | null;
    confirmedAt?: Date | null;
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
    durationSamples: d.durationSamples ?? null,
    loudnessTargetLufs: d.loudnessTargetLufs ?? null,
    peaks: d.peaks ?? [],
    renditions: d.renditions ?? {},
    lastError: d.lastError ?? null,
    // Serialized so the UI can EXPLAIN a non-retryable row, not so it can
    // decide about one — `retryable` below is what decides. Absent (a row
    // written before the field existed) means not-permanent.
    permanentFailure: d.permanentFailure === true,
    // `retryAudioAsset`'s filter, all three clauses, evaluated here.
    //
    // The comment this replaces claimed that serializing `permanentFailure`
    // meant the UI and the server "can never disagree". It was false the day it
    // was written: the filter also requires `status: 'failed'` (which the UI did
    // check) and `confirmedAt != null` (which it could not, because
    // `confirmedAt` was not serialized). Both of the rows that condition exists
    // to exclude are ROUTINE — `reapAbandonedUploads` writes `failed` with a
    // null `confirmedAt` for every upload that was abandoned, and
    // `confirmAudioUpload`'s reject path does the same for every file that was
    // too large or the wrong type — so the Retry button rendered on them and
    // threw. Mirroring a filter clause-by-clause across a network boundary is
    // the kind of thing that is right when written and wrong a commit later;
    // one derived boolean is the thing the UI can mirror EXACTLY.
    //
    // Kept literally parallel to the query below so the correspondence is
    // checkable by eye, and `tests/server/functions/audio-mutations.test.ts`
    // drives both against the same documents.
    retryable:
      (d.status ?? '') === 'failed' &&
      (d.confirmedAt ?? null) !== null &&
      d.permanentFailure !== true,
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

/** JS's maximum representable Date. Anything beyond it builds an `Invalid Date`. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Both halves of the cursor are validated, and both had to be.
 *
 * The old guard was `Number.isFinite(ms)`, which reads as "this is a safe
 * timestamp" and isn't: `Number.isFinite(1e20)` is `true`, but the largest Date
 * JS can represent is 8.64e15 ms, so `new Date(1e20)` is `Invalid Date`.
 * Handing that to Mongoose produces a `CastError` — an HTTP 500 and a GlitchTip
 * event, from a one-line request body. The id half was never checked at all, so
 * `1700000000000_notanoid` did the same thing by a different route.
 *
 * Returning null means "this cursor is not something this server ever minted".
 * `listAudioAssets` treats that as a hard error rather than silently restarting
 * from page 1: a silent fallback re-serves page 1 in the middle of an infinite
 * scroll, so the user sees duplicate rows and the client never learns its
 * cursor was rejected. `listAudioAssetsSchema.cursor` rejects the same shapes at
 * the request boundary, so in practice nothing reaches this fail-closed path —
 * it exists so the function is safe for any caller, not just validated ones.
 */
function decodeAudioCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.indexOf('_');
  if (idx <= 0 || idx === cursor.length - 1) return null;
  const msPart = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  if (!/^\d+$/.test(msPart)) return null;
  const ms = Number(msPart);
  if (!Number.isSafeInteger(ms) || ms > MAX_TIMESTAMP_MS) return null;
  if (!OBJECT_ID_RE.test(id)) return null;
  const createdAt = new Date(ms);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

export async function listAudioAssets({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof listAudioAssetsSchema>;
} & Actor): Promise<{ items: AudioAssetData[]; nextCursor: string | null }> {
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
      // Fail closed. Silently ignoring an undecodable cursor restarts the list
      // at page 1, which in the infinite-scroll UI appends page 1 underneath
      // page 1 — duplicate rows, and no signal to the client that its cursor
      // was thrown away.
      if (!decoded) throw new AudioClientError('Invalid pagination cursor');
      // Compound cursor: strictly older createdAt, OR same createdAt with a
      // strictly smaller _id — matches the `{ createdAt: -1, _id: -1 }` sort.
      query.$or = [
        { createdAt: { $lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, _id: { $lt: decoded.id } },
      ];
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
    reportAudioError(e, { userId, sessionUserId }, { action: 'listAudioAssets' });
    throw e;
  }
}

export async function updateAudioAsset({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof updateAudioAssetSchema>;
} & Actor): Promise<AudioAssetData> {
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

    // `.lean()` is required, not just a perf nicety: without it `doc` is a hydrated
    // Mongoose Document whose array/subdocument fields (`environment`, `tags`,
    // `renditions`, ...) are Mongoose-native (DocumentArray/EmbeddedDocument)
    // wrapper types, not plain arrays/objects — `serializeAudioAsset` copies them
    // by reference into the fields it returns, and TanStack Start's server-fn
    // response serializer can't serialize those wrapper types ("The value [object
    // Object] of type \"object\" cannot be parsed/serialized", a real HTTP 500 this
    // caught end-to-end). `listAudioAssets` already does this correctly below.
    const doc = await AudioAsset.findOneAndUpdate(
      { _id: data.id, ownerId: userId },
      { $set: set },
      { new: true }
    ).lean();
    if (!doc) throw new Error('Audio asset not found');
    return serializeAudioAsset(doc as unknown as AudioDoc);
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'updateAudioAsset' });
    throw e;
  }
}

export async function bulkTagAudioAssets({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof bulkTagAudioAssetsSchema>;
} & Actor): Promise<{ modified: number }> {
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
    reportAudioError(e, { userId, sessionUserId }, { action: 'bulkTagAudioAssets' });
    throw e;
  }
}

/**
 * Requeue a `failed` asset for another run through the transcode pipeline.
 *
 * The source object is still in R2 (delete is the only thing that removes it),
 * so a failure caused by a transient fault — an R2 blip, a brief Atlas
 * failover, a worker OOM — is entirely recoverable. Without this the only
 * recovery is delete-and-re-upload, which for a 50-file bulk import means
 * re-dropping the whole folder.
 *
 * Resets the full queue state, not just `status`: `attempts` is back to 0 (the
 * row exhausted its budget, and a retry that immediately re-failed at the cap
 * would be no retry at all), `nextAttemptAt` is cleared so the worker can claim
 * it on the next pass, and the claim fields are cleared so it can't look
 * in-flight.
 *
 * The filter carries THREE preconditions, and all are load-bearing. All three
 * are also mirrored to the client, as the single derived `retryable` flag
 * `serializeAudioAsset` computes — see there for why one flag rather than three
 * fields, and for what went wrong when only two of the three were reachable
 * from the UI.
 *
 * - `status: 'failed'` — this can never be used to yank a `ready` asset back
 *   through the worker; that is the same abuse `confirmAudioUpload`'s own
 *   precondition closes.
 * - `permanentFailure: { $ne: true }` — the failure must be one a retry could
 *   plausibly fix. The worker sets `permanentFailure` whenever it threw a
 *   `PermanentError` (audio-worker/src/errors.ts), which covers rather more
 *   than "the audio was bad": over the 30-minute cap as MEASURED by decoding,
 *   zero decoded samples, wholly silent, an incomplete rendition, an object
 *   over `AUDIO_MAX_BYTES` (whose R2 object the worker has also deleted, so
 *   there is nothing left to retry against), a row with no `sourceKey`, and a
 *   `sourceKey` predating the per-owner storage layout. What unites them is
 *   that the worker KNEW the run could not succeed, rather than guessing from
 *   an exit code — never a transient fault that merely exhausted the attempt
 *   budget. Those
 *   files are poison on every run: without this clause each Retry click buys
 *   another full decode of pinned CPU on a single-node cluster, in a loop the
 *   user can drive by hand, for a guaranteed identical outcome. `$ne: true`
 *   rather than `false` so rows written before the field existed stay
 *   retryable (Mongo equality treats an absent field as null).
 * - `confirmedAt: { $ne: null }` — the row must have **passed confirm**.
 *   `confirmAudioUpload`'s `HeadObject` is the only real enforcement of
 *   `AUDIO_MAX_BYTES` in the system (a presigned PUT cannot constrain
 *   Content-Length; the dropzone's check is a courtesy), and `confirmedAt` is
 *   written by that success path and by nothing else — so a null `confirmedAt`
 *   means nobody has ever measured this object. Two kinds of row are in that
 *   state: one the worker's `reapStale` aged out of `uploading`, and one
 *   confirm rejected (whose R2 object confirm already deleted, making a requeue
 *   pointless anyway). Without this clause, declaring `bytes: 1MB`, PUTting a
 *   1 GB body, never confirming, waiting out the upload reaper and clicking
 *   Retry hands the worker an unmeasured object to buffer whole into memory
 *   (`transformToByteArray`) in a pod capped at 768Mi — OOM, requeue, OOM,
 *   fail, Retry, repeat, on a single-node cluster.
 *
 *   It must be `confirmedAt` and not `sourceBytes`: `sourceBytes` was, until
 *   this commit, seeded at row creation from the client's self-declared
 *   `data.bytes`, so `{sourceBytes: {$ne: null}}` was true for every row that
 *   had ever existed and excluded exactly nothing. A guard whose premise is
 *   false is worse than no guard, because it reads as one. `confirmedAt` is
 *   true by construction — one writer, and its name states the invariant.
 */
export async function retryAudioAsset({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof retryAudioAssetSchema>;
} & Actor): Promise<AudioAssetData> {
  try {
    await ensureDb();
    const doc = await AudioAsset.findOneAndUpdate(
      {
        _id: data.id,
        ownerId: userId,
        status: 'failed',
        confirmedAt: { $ne: null },
        permanentFailure: { $ne: true },
      },
      {
        $set: {
          status: 'pending',
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        },
      },
      { new: true }
      // `.lean()` for the same reason as updateAudioAsset — see that comment.
    ).lean();
    if (!doc) {
      throw new Error(
        'Audio asset cannot be retried (not found, not failed, its upload never completed, or the file itself was rejected)'
      );
    }
    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'audio_asset_retried', {
      assetId: data.id,
    });
    return serializeAudioAsset(doc as unknown as AudioDoc);
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'retryAudioAsset' });
    throw e;
  }
}

export async function deleteAudioAsset({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof deleteAudioAssetSchema>;
} & Actor): Promise<{ deleted: boolean }> {
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

    // R2 deletion is BEST-EFFORT: a failing object delete must not block the row
    // delete. The user asked for this asset to be gone, and leaving the row
    // behind because a bucket was briefly unreachable produces a library entry
    // the UI still shows, still polls, and still offers Delete for — a worse
    // outcome than a stranded object.
    //
    // What this strands IS reclaimable, but only because of the storage
    // layout. Once the row below is gone its key exists nowhere else, so
    // nothing derived from the user's remaining rows can name it — the
    // reclaim path is `~/server/functions/audio-cleanup.ts` listing
    // `uploads/audio/<the caller's prefix>/` and subtracting what the rows
    // still reference (see `./audio-storage.ts` for why the prefix exists).
    // Each failure is still reported, so a systematically failing R2 delete
    // shows up in GlitchTip rather than quietly accruing storage cost that
    // somebody has to notice and sweep.
    for (const Key of keys) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
      } catch (e) {
        void reportAudioError(
          e,
          { userId, sessionUserId },
          {
            action: 'deleteAudioAsset.r2Object',
            assetId: data.id,
            key: Key,
          }
        );
      }
    }

    await AudioAsset.deleteOne({ _id: data.id, ownerId: userId });
    return { deleted: true };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'deleteAudioAsset' });
    throw e;
  }
}
