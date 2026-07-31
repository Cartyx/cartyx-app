import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { AudioPackage } from '../db/models/AudioPackage';
import { escapeRegExp, normalizeTags } from '../utils/helpers';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { resolveAudioStoragePrefix } from './audio-storage';
import { createR2, getAudioUploadUrl } from './uploads';
import { pruneOrphanedMoodStates } from '~/lib/soundboard/prune';
import { AUDIO_MAX_BYTES, AUDIO_SOURCE_TYPES } from '~/types/audio';
import type { AudioAssetData } from '~/types/audio';
import type { MoodData, PackageItemData } from '~/types/soundboard';
import type {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
  attachOnceVariantUploadSchema,
  confirmOnceVariantUploadSchema,
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

/**
 * Compares a SERVER-derived ObjectId (a lean document's field, which
 * `String()` always renders as lowercase hex) against a CLIENT-supplied id,
 * case-insensitively.
 *
 * Mongo's own ObjectId cast is case-insensitive — `find({_id: 'AABB…'})`
 * matches the document whose id prints as `aabb…` — so a query can succeed
 * while a naive `String(field) !== id` comparison over the same value is
 * `true` for every row. `deleteAudioAsset`'s package prune did exactly that:
 * an upper-cased 24-hex id (which `objectId`'s `[0-9a-fA-F]` regex accepts)
 * deleted the asset and all six of its R2 objects while EVERY referencing
 * package item survived as a permanent tombstone against the 64-item cap, and
 * `pruneOrphanedMoodStates` then no-opped too, because the surviving-items
 * list it was handed was the unchanged original.
 *
 * The `objectId` schema now lower-cases at the boundary (see
 * `~/types/schemas/audio.ts`), so in practice `data.id` reaches here already
 * canonical. This is the second, independent defence: the ingest surface is
 * deliberately auth-agnostic and phase 3's bearer adapter may not route every
 * call through the same Zod object, and a comparison that is only correct
 * because something upstream normalised is a comparison that breaks silently
 * when the upstream moves.
 */
function sameObjectId(serverValue: unknown, clientId: string): boolean {
  return String(serverValue).toLowerCase() === clientId.toLowerCase();
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
    //
    // `variant !== 'once'` too — Task 18 nit fix, symmetric with the
    // worker's reaper split (`reapAbandonedUploads` vs
    // `reapAbandonedOnceUploads` in audio-worker/src/claim.ts). Without it
    // this precondition alone can't tell a genuine main upload apart from a
    // row that's `status: 'uploading'` because `createOnceVariantUpload`
    // put it there — this function only ever measures/confirms
    // `sourceKey`, never `onceSourceKey`, so confirming a once-attach here
    // would flip a row still carrying `variant: 'once'` to `pending`, and
    // the worker's `processAsset` would then run the ONCE pipeline against
    // whatever `onceSourceKey` happens to be at that moment — possibly
    // unset, if the browser's PUT to the once URL hasn't landed yet. Not a
    // data-loss path (an empty/wrong `onceSourceKey` fails through
    // `markOnceFailed` back to `ready`, same as any other once-variant
    // failure) and not reachable from the UI (nothing calls
    // `confirmAudioUpload` for an assetId mid-once-attach), but there is no
    // reason for this function to accept a row it was never meant to touch.
    if (asset.status !== 'uploading' || asset.variant === 'once') {
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
        // FENCED, with exactly the clauses the success write below carries,
        // and for exactly the same reason its comment gives: "only the filter
        // on the write makes exactly one of them win." This one is the more
        // dangerous of the two to leave open, because it writes
        // `permanentFailure: true` and `retryAudioAsset` refuses those rows —
        // an unfenced version has no path back.
        //
        // The interleave, one client, no special timing beyond a single
        // `DeleteObject` round trip: confirm a refused blob; while THIS
        // request is inside the `DeleteObjectCommand` await above, re-PUT
        // good audio to the same presigned URL (valid 300s, reusable) and
        // confirm again. Request #2's fenced success write wins — the row is
        // now a legitimately queued `pending` asset, or, if the worker got
        // there first, a `ready` one — and then this request resumes and
        // stamps `failed`/`permanentFailure` over it, having already deleted
        // the GOOD object. That is precisely the shape `markOnceFailed` exists
        // to prevent, reached from a path `markOnceFailed` does not cover. The
        // fence makes the stale write a no-op: the row this path means to fail
        // is by definition still `uploading` and still not the once pipeline's.
        { _id: data.assetId, ownerId: userId, status: 'uploading', variant: { $ne: 'once' } },
        {
          $set: {
            status: 'failed',
            lastError: reason,
            // PERMANENT, and it has to be stamped rather than inferred. Both
            // rejections above are decisions about the OBJECT — it was
            // HeadObject'd and measured, and it was refused for what it is.
            // Re-uploading the same file produces the same two numbers and the
            // same refusal, so this is exactly what `permanentFailure` means
            // (see errors.ts in the worker).
            //
            // Without it the row reads as "never confirmed" — `retryable` is
            // false either way because `confirmedAt` is null, but the UI's
            // advice comes from `permanentFailure`, and the un-stamped row got
            // "this upload never completed; upload the file again". That is
            // wrong twice: the upload DID complete, and uploading it again
            // fails identically.
            permanentFailure: true,
            updatedAt: new Date(),
          },
        }
      );
      throw new Error(reason);
    }

    // `status: 'uploading'` again, and atomically this time: the read above can
    // race a concurrent confirm for the same asset, and only the filter on the
    // write makes exactly one of them win. `variant: { $ne: 'once' }` closes
    // the same race the JS-level check above closes for the READ: a
    // concurrent `createOnceVariantUpload` could flip `variant` to `'once'`
    // in the window between this function's `findOne` and this write.
    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId, status: 'uploading', variant: { $ne: 'once' } },
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

/**
 * Task 18: presign a source upload for an EXISTING `music` asset's
 * once-variant (the composed-ending encode the board's `1×` position plays
 * — see the design doc's "Music variants"). Attaches to the SAME
 * `AudioAsset` row rather than creating a new one, because `onceRenditions`
 * has to land on the same document as `renditions` for `BoardPad`'s
 * `asset.onceRenditions` check (Task 16) to ever see it — a second document
 * could never be joined back to the first from the client's read model.
 *
 * Reuses the row's status/attempts/claim queue state for this second job
 * (see `variant` on the model). The `status: 'ready'` filter on the write
 * below does double duty: it refuses to attach onto audio that hasn't
 * finished its own transcode yet (nothing to pair a once-variant with), and
 * it is the replay guard — once this write flips status away from 'ready',
 * a second, concurrent attach request's identical filter matches nothing,
 * the same technique `confirmAudioUpload`'s `status: 'uploading'` filter
 * uses.
 *
 * `attempts: 0` is explicit, not incidental: `attempts` otherwise carries
 * over from whatever the MAIN pipeline last left it at, so a main asset that
 * needed 2 of its 3 attempts to transcode would hand its once job only 1
 * retry before `MAX_ATTEMPTS`. A once job is a fresh unit of work and gets
 * the full budget. `nextAttemptAt: null` for the same reason, from the other
 * side: a once job that previously failed and requeued (still within
 * budget, still `variant: 'once'`) can leave a FUTURE backoff timestamp
 * behind, and a fresh attach must not inherit an old job's delay —
 * `claimNext`'s filter would otherwise silently hold this brand-new attach
 * back for up to the backoff cap (5 minutes by default).
 *
 * Re-attaching (the row already has an `onceSourceKey` from a prior attach,
 * successful or not) mints a NEW key rather than reusing the old one — and
 * the old object is deleted, best-effort, once the row points at its
 * replacement. Without this a user who attaches, then attaches again with a
 * better file, strands the first once-variant's source object: nothing
 * references it (the row's `onceSourceKey` has moved on), and unlike the
 * main `sourceKey` — which is minted exactly once per asset — a once-attach
 * can happen any number of times, so this is not a one-off gap.
 */
export async function createOnceVariantUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof attachOnceVariantUploadSchema>;
} & Actor) {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new Error('Audio asset not found');
    if (asset.kind !== 'music') {
      throw new Error('Only music assets can have a once-variant attached');
    }
    if (asset.status !== 'ready') {
      throw new Error('This asset must finish processing before a once-variant can be attached');
    }
    const previousOnceSourceKey = asset.onceSourceKey;

    const storagePrefix = await resolveAudioStoragePrefix(userId);
    const { uploadUrl, key } = await getAudioUploadUrl({
      contentType: data.contentType,
      bytes: data.bytes,
      storagePrefix,
      telemetryUserId: telemetryId({ userId, sessionUserId }),
    });

    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId, status: 'ready' },
      {
        $set: {
          onceSourceKey: key,
          // CLEARED, not left standing. The once rendition keys are
          // DETERMINISTIC per asset (`${base}.once.${ext}` —
          // `renditionKeyBase`'s callers in audio-worker/src/process.ts), and
          // the worker PUTs both objects BEFORE it writes the row. So the
          // moment a second attach's job runs, it overwrites attach #1's live
          // objects in place — the bytes behind these keys are already gone,
          // whatever this field still says. If that job then fails partway
          // (one R2 blip on the second PUT, an evicted pod), `markOnceFailed`
          // reverts the row to `ready` still pointing here, and the asset
          // serves attach #2's audio to a browser that picks `.opus` and
          // attach #1's to one that picks `.aac`, with `bytes`/`durationMs`
          // describing neither. Nothing detects it and nothing reports it.
          //
          // `markOnceFailed`'s stated contract is "leave the row exactly as it
          // was before the attach". Clearing here does not break that promise
          // — it makes it TRUE. Before this line the promise was unkeepable:
          // "as it was before the attach" named two R2 objects the attach had
          // already destroyed. A cleared field means the GM sees "no
          // once-variant attached" and can re-attach, which is exactly the
          // recoverable state; the previous behaviour was an asset that
          // claimed a once-variant it could no longer play correctly.
          onceRenditions: {},
          variant: 'once',
          status: 'uploading',
          attempts: 0,
          // A previously-failed once run can leave a FUTURE nextAttemptAt
          // behind (requeueForRetry's backoff gate) even though this is a
          // brand-new attach, not a retry of that old job — without
          // clearing it, claimNext's `{ nextAttemptAt: null } | { $lte:
          // now }` filter would silently delay this attach's first claim
          // by up to the backoff cap (5 minutes by default).
          nextAttemptAt: null,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updated) {
      throw new Error('This asset is not ready to accept a once-variant right now');
    }

    // Best-effort, and only after the row is safely pointed at the NEW key —
    // an R2 outage here must not fail the attach, and deleting before the
    // write would risk destroying the only object a failed write still
    // references.
    if (previousOnceSourceKey) {
      try {
        const { client, bucket } = createR2();
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: previousOnceSourceKey }));
      } catch (e) {
        void reportAudioError(
          e,
          { userId, sessionUserId },
          {
            action: 'createOnceVariantUpload.replacedOnceSource',
            assetId: data.assetId,
            key: previousOnceSourceKey,
          }
        );
      }
    }

    return { assetId: data.assetId, uploadUrl, key };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'createOnceVariantUpload' });
    throw e;
  }
}

/**
 * Confirm step for the once-variant upload. Mirrors `confirmAudioUpload`
 * exactly — same HeadObject size/type enforcement, for the same reason (a
 * presigned PUT cannot constrain Content-Length). The only differences are
 * WHICH key is measured (`onceSourceKey`, not `sourceKey`) and which
 * transition it gates (`uploading` + `variant: 'once'` -> `pending`, so the
 * worker's claim query picks the row back up).
 */
export async function confirmOnceVariantUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof confirmOnceVariantUploadSchema>;
} & Actor) {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new Error('Audio asset not found');
    if (asset.status !== 'uploading' || asset.variant !== 'once' || !asset.onceSourceKey) {
      throw new Error('Once-variant asset is not awaiting confirmation');
    }

    const { client, bucket } = createR2();
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: asset.onceSourceKey })
    );

    const bytes = head.ContentLength ?? 0;
    const type = head.ContentType ?? '';
    const tooLarge = bytes > AUDIO_MAX_BYTES;
    const badType = !AUDIO_SOURCE_TYPES.has(type);

    if (tooLarge || badType) {
      // Same reasoning as confirmAudioUpload's own reject path: the object
      // must go, or storage is paid for a file that was refused. THAT part
      // is unchanged. What must NOT be unchanged is the row write below it:
      // confirmAudioUpload's version writes `status: 'failed',
      // permanentFailure: true` onto a row that only ever describes a
      // NEW asset with nothing else at stake. This function's row is the
      // MAIN asset's own document — writing the same shape here bricks a
      // fully-transcoded, previously-`ready` music asset over a bad SECOND
      // file: `retryAudioAsset` refuses `permanentFailure: true`, and
      // `createOnceVariantUpload` refuses a non-`ready` row, so there is no
      // path back. Exactly the failure `markOnceFailed` (audio-
      // worker/src/process.ts) exists to prevent — this is that same
      // guarantee, applied here because this rejection happens in
      // `app/server/functions/`, not in the worker, so `markOnceFailed`
      // itself can't reach it.
      //
      // Reachable only by a client that under-declares `bytes` at
      // `createOnceVariantUpload` time and then PUTs a larger body — the
      // presigned PUT can't enforce Content-Length, which is the same
      // abuse `retryAudioAsset`'s `confirmedAt` gate treats as live
      // (see that function's doc comment). An honest client can't hit
      // `tooLarge` (the schema caps declared `bytes`) or `badType` (the
      // presign signs `ContentType`), but "clients are honest" is not a
      // safety property this codebase relies on anywhere else, so it isn't
      // relied on here either.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.onceSourceKey }));
      const reason = tooLarge
        ? `File too large: ${bytes} bytes exceeds ${AUDIO_MAX_BYTES}`
        : `Unsupported audio type: ${type}`;
      // Fenced on `status: 'uploading', variant: 'once'` — final-review fix.
      // This was the one `findOneAndUpdate` in this file with only an
      // identity filter, and it CANCELS a once-attach: it writes `status:
      // 'ready', variant: 'main', onceSourceKey: null`. A stale reject
      // (this handler resumed after an await while the user, seeing the
      // first attach fail, already started a SECOND one) matched the fresh
      // attach's row and silently reverted it — the worker's claim query
      // never sees it, the browser's PUT lands on an object nothing
      // references, and the GM is told nothing. The fence makes it a no-op
      // instead: the row it means to revert is by definition still
      // `uploading`/`once`, so a narrower filter cannot cost this path
      // anything it should have done.
      await AudioAsset.findOneAndUpdate(
        { _id: data.assetId, ownerId: userId, status: 'uploading', variant: 'once' },
        {
          $set: {
            status: 'ready',
            variant: 'main',
            onceSourceKey: null,
            onceLastError: reason,
            updatedAt: new Date(),
          },
        }
      );
      throw new Error(reason);
    }

    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId, status: 'uploading', variant: 'once' },
      {
        $set: {
          status: 'pending',
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updated) throw new Error('Once-variant asset is not awaiting confirmation');

    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'audio_once_variant_confirmed', {
      assetId: data.assetId,
    });
    return { assetId: data.assetId, status: updated.status ?? 'pending' };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'confirmOnceVariantUpload' });
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
    onceRenditions?: AudioAssetData['onceRenditions'];
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
    // Task 18: the field genuinely starts as absent on every row (including
    // every row that predates this task) and stays absent until an owner
    // attaches a once-variant, so `{}` here — mirroring `renditions` above —
    // is the honest "nothing attached yet" value, not a placeholder.
    onceRenditions: d.onceRenditions ?? {},
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
    // Task 18 made onceRenditions/onceSourceKey real: an asset with a once-
    // variant attached has THREE extra R2 objects beyond the main
    // source+renditions (the once source, and its opus/aac renditions), and
    // all three live under this owner's storage prefix same as the rest —
    // deleting the row without deleting them would strand three objects the
    // orphan scanner (audio-cleanup.ts) would only catch on a later manual
    // sweep instead of immediately, same as every other key here.
    const keys = [
      asset.sourceKey,
      asset.renditions?.opus?.key,
      asset.renditions?.aac?.key,
      asset.onceSourceKey,
      asset.onceRenditions?.opus?.key,
      asset.onceRenditions?.aac?.key,
    ].filter((k): k is string => Boolean(k));

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

    // Best-effort prune of package references to this asset. Same reasoning
    // as the R2 delete loop just above: a failure here must not block the
    // row delete — the user asked for this asset to be gone — so it is
    // caught and reported rather than allowed to propagate. Without this,
    // every package that placed this asset would keep a permanently
    // dangling `items[].assetId`, and in a document capped at 64 items that
    // is a slow leak: a GM who churns their library eventually can't add
    // items to a package whose pads are mostly tombstones.
    //
    // Scoped to `{ ownerId: userId, ... }` — the caller's OWN packages
    // only, never a bare `{ 'items.assetId': id }`, which would reach into
    // other users' packages. This is a plain scalar equality, not
    // `packageVisibilityFilter`'s read-side `$or` (which also matches
    // `ownerId: null`): a system package is read-only and a user cannot
    // delete a system-owned asset anyway (the `findOne` above already
    // scoped `asset` to `ownerId: userId`), so system packages must never
    // be reachable here.
    try {
      const affected = (await AudioPackage.find({
        ownerId: userId,
        'items.assetId': data.id,
      }).lean()) as unknown as {
        _id: unknown;
        items: PackageItemData[];
        moods: MoodData[];
      }[];

      for (const pkg of affected) {
        // Two steps, not one `$pull`: moods reference `item.id`, never
        // `assetId` (see `~/lib/soundboard/prune`'s doc comment), so the
        // surviving item ids must be computed FIRST and used to prune
        // `moods[].states[]` too. A single `$pull` on `items` alone would
        // leave every mood state that named the removed item pointing at
        // an id that no longer exists — exactly the orphan Task 14 had to
        // go back and fix for the editor's own item-removal path.
        const survivingItems = pkg.items.filter((item) => !sameObjectId(item.assetId, data.id));
        const survivingMoods = pruneOrphanedMoodStates(pkg.moods, survivingItems);
        await AudioPackage.updateOne(
          { _id: pkg._id, ownerId: userId },
          { $set: { items: survivingItems, moods: survivingMoods, updatedAt: new Date() } }
        );
      }
    } catch (e) {
      void reportAudioError(
        e,
        { userId, sessionUserId },
        {
          action: 'deleteAudioAsset.prunePackages',
          assetId: data.id,
        }
      );
    }

    await AudioAsset.deleteOne({ _id: data.id, ownerId: userId });
    return { deleted: true };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'deleteAudioAsset' });
    throw e;
  }
}
