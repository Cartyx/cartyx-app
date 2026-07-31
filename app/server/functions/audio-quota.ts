import mongoose from 'mongoose';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';

/**
 * Per-user R2 storage usage, aggregated on demand rather than kept as a
 * denormalised counter on `User`.
 *
 * WHY ON DEMAND, NOT A COUNTER
 * -----------------------------
 * A counter needs a writer at every place bytes are added or removed:
 * `confirmAudioUpload` (source lands), `processAsset`'s success path
 * (renditions land), `deleteAudioAsset` (asset removed), and both the
 * worker's and the upload-side reapers (abandoned rows removed). Phase 2a's
 * adversarial review found correctness bugs in three of those exact
 * functions. A drifted quota either blocks a user who is actually under it
 * or admits one who is actually over — both are worse than the cost of this
 * query. One `$group` over one user's own assets, served by the existing
 * `{ownerId, createdAt}` index (an `ownerId`-only `$match` uses it as a
 * prefix), runs in the tens of milliseconds. That trade is deliberate: see
 * the phase 1.5 design doc.
 */
export interface AudioStorageUsage {
  bytes: number;
  assetCount: number;
}

/**
 * The byte-bearing fields on one `AudioAsset` row.
 *
 * This mirrors `audio-cleanup.ts`'s `referencedKeys`, one level down
 * (`.bytes` instead of `.key`), over the same five rendition slots — but it
 * is NOT the same list, and is not imported from there:
 *
 * - `referencedKeys` enumerates SIX key fields because it also tracks
 *   `onceSourceKey` — the once-variant's own uploaded source object, needed
 *   so the orphan scanner doesn't report a live in-flight once-attach as
 *   unreferenced. That object's size is never persisted anywhere on the
 *   row (`onceSourceBytes` does not exist in `AudioAsset`'s schema — see
 *   `../db/models/AudioAsset.ts`); only its two RENDITIONS, once produced,
 *   record `bytes`. So the byte-bearing enumeration below has five entries,
 *   not six, and the discrepancy is a property of the schema, not an
 *   oversight here.
 * - Because the two lists name different leaf fields (`.key` vs `.bytes`)
 *   and differ in count for the reason above, a single shared array can't
 *   drive both without either fabricating an unused `onceSourceBytes`
 *   placeholder or adding structure whose only real consumer is a five-line
 *   list. Copied instead, deliberately, with this comment as the
 *   cross-reference: if `AudioAsset` ever grows a new rendition slot (or an
 *   `onceSourceBytes` field), add its `.key` path to `referencedKeys` in
 *   `audio-cleanup.ts` AND its `.bytes` path here.
 */
const BYTES_FIELD_PATHS = [
  'sourceBytes',
  'renditions.opus.bytes',
  'renditions.aac.bytes',
  'onceRenditions.opus.bytes',
  'onceRenditions.aac.bytes',
] as const;

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

/**
 * Sum of every byte-bearing field across every asset a user owns, plus how
 * many asset rows contributed.
 *
 * Counts EVERY status, not just `ready` — an asset sitting in `pending` or
 * `processing` already occupies real R2 bytes (its source object, confirmed
 * by `confirmAudioUpload`'s `HeadObject` before the row ever reaches
 * `pending`), and counting only `ready` would let a user park unbounded
 * bytes there indefinitely.
 *
 * `$ifNull` guards every addend: a field that is `null` (never confirmed, or
 * a rendition slot never produced) or entirely absent (a rendition
 * sub-document that was never set — the schema's `default: undefined`) would
 * otherwise make Mongo's `$add` evaluate the WHOLE sum to `null` for that
 * document, not just that one term. Falling back to `0` per-field is what
 * makes an unconfirmed asset contribute `0` rather than poisoning the total.
 *
 * `userId` — the Mongo `_id`, and the ONLY value that may scope this query —
 * is cast to a real `ObjectId` before the pipeline runs. Unlike `.find()`,
 * `.aggregate()` sends its pipeline straight to MongoDB without Mongoose's
 * query-time casting, so a bare string here would silently match nothing
 * (see `tabletop.ts`'s `$expr` comment for the same rule applied to a
 * different aggregation-context query).
 */
export async function getUserStorageUsage(userId: string): Promise<AudioStorageUsage> {
  await ensureDb();

  const [result] = (await AudioAsset.aggregate([
    { $match: { ownerId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        assetCount: { $sum: 1 },
        bytes: {
          $sum: {
            $add: BYTES_FIELD_PATHS.map((path) => ({ $ifNull: [`$${path}`, 0] })),
          },
        },
      },
    },
  ])) as Array<{ assetCount: number; bytes: number }>;

  // No matching group means the user owns no asset rows at all.
  return {
    bytes: result?.bytes ?? 0,
    assetCount: result?.assetCount ?? 0,
  };
}
