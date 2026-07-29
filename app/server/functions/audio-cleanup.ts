import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { serverCaptureEvent, serverCaptureException } from '../utils/telemetry';
import { createR2 } from './uploads';
import type {
  scanOrphanAudioSchema,
  deleteOrphanAudioSchema,
  OrphanAudioObject,
  ScanOrphanAudioResult,
  DeleteOrphanAudioResult,
} from '~/types/schemas/audio';

/**
 * Owner-scoped reclamation of stranded audio objects in R2.
 *
 * WHY THIS EXISTS SEPARATELY FROM `cleanup.ts`
 * --------------------------------------------
 * The campaign image scanner authorizes with `requireGmOfCampaign` — "you are
 * GM of this one campaign". Audio has no campaign dimension at all; it is a
 * per-user library. While `uploads/audio/` was in that scanner's
 * `TRACKED_PREFIXES`, being GM of your own campaign got you a bucket-wide
 * listing of every user's audio objects and a delete button for them.
 *
 * HOW THIS ONE IS SCOPED — and why the scoping is real, not nominal
 * -----------------------------------------------------------------
 * The R2 key for a SOURCE object is `uploads/audio/<timestamp>-<random>.<ext>`
 * (`getAudioUploadUrl`) — it carries no owner component, so `ListObjectsV2`
 * cannot be prefix-scoped to a user, and no amount of filtering an
 * `uploads/audio/` listing can prove who a given key belongs to. So this module
 * **never lists the bucket**. It goes the other way: it DERIVES the candidate
 * key set from the caller's own `AudioAsset` rows and then asks R2 about each
 * derived key by name (`HeadObject`).
 *
 * That inverts the trust relationship. In a listing you start with keys of
 * unknown provenance and try to attribute them; here every key that can ever
 * appear in a result — or be passed to `DeleteObject` — was computed from a
 * document that matched `{ ownerId: <caller> }`. A key belonging to another
 * user is not filtered out; it is never constructed. Confirming the scoping is
 * therefore a matter of reading two lines rather than trusting a filter.
 *
 * The derivation rests on one fact: RENDITION keys are deterministic in the
 * asset id. The worker writes them to `uploads/audio/renditions/<assetId>.opus`
 * and `.m4a` (`audio-worker/src/process.ts`, the `base` constant — keep
 * RENDITION_KEY_PREFIX below in step with it). So for any row the caller owns
 * we can name the two objects that row's processing could have produced, even
 * when the row does not record them.
 *
 * WHAT THIS FINDS
 * ---------------
 * Renditions that were PUT to R2 but never recorded on the row: the worker
 * uploads both renditions and only then issues the fenced DB write, so an Atlas
 * blip, a lost fence, or a pod eviction in that window leaves two objects that
 * nothing references. Those objects survive every subsequent attempt (the key
 * is stable, so a later successful run overwrites rather than duplicates), and
 * if the asset ultimately lands in `failed` they are stranded permanently.
 *
 * WHAT IT DOES NOT FIND — stated plainly rather than papered over
 * --------------------------------------------------------------
 * A SOURCE object whose row is already gone. `deleteAudioAsset` deletes R2
 * best-effort and removes the row regardless (deliberately — see its comment),
 * so if the object delete fails the only record of that key disappears with the
 * row. Nothing derivable from the caller's rows can name it again, and the only
 * thing that could is a bucket listing, which is exactly what cannot be
 * attributed to an owner. Closing that gap needs the key layout itself to carry
 * the owner (`uploads/audio/<ownerId>/…`), which is a storage-layout change,
 * not a cleanup change. Recorded in the fix report as the follow-up.
 */

/**
 * MUST match `audio-worker/src/process.ts`'s rendition `base`
 * (`uploads/audio/renditions/${id}`). The worker is a separate package with its
 * own tsconfig and cannot import this file, so the two are mirrored constants
 * with a test on each side pinning the string.
 */
const RENDITION_KEY_PREFIX = 'uploads/audio/renditions/';
const RENDITION_EXTENSIONS = ['opus', 'm4a'] as const;

/**
 * The most rows one scan pass inspects. Each row costs up to two `HeadObject`
 * round trips, so this is a real cost ceiling, not a formality. The candidate
 * query already narrows to rows that could plausibly have stranded renditions,
 * so a healthy library of any size contributes almost nothing to this count.
 */
export const AUDIO_ORPHAN_SCAN_MAX_ROWS = 500;

/**
 * An object younger than this is never reported or deleted.
 *
 * This closes the one genuine race in the design: the worker PUTs both
 * renditions and only afterwards writes the keys onto the row, so for a short
 * window an object legitimately exists with nothing referencing it. Without an
 * age floor a scan landing in that window would call a live, in-flight
 * rendition an orphan and offer to delete it. One hour is far longer than the
 * PUT→write gap (bounded by the worker's own R2 timeouts) and far shorter than
 * any useful reclamation horizon.
 */
export const AUDIO_ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

/** The two keys a given asset's processing could have written. */
export function renditionKeysFor(assetId: string): string[] {
  return RENDITION_EXTENSIONS.map((ext) => `${RENDITION_KEY_PREFIX}${assetId}.${ext}`);
}

type CandidateRow = {
  _id: unknown;
  sourceKey?: string;
  renditions?: { opus?: { key?: string }; aac?: { key?: string } };
  onceRenditions?: { opus?: { key?: string }; aac?: { key?: string } };
};

function referencedKeys(row: CandidateRow): string[] {
  return [
    row.sourceKey,
    row.renditions?.opus?.key,
    row.renditions?.aac?.key,
    // Reserved for phase 2's ∞/1× music variants and never written in phase 1,
    // but a cleanup path that forgets them once phase 2 starts populating them
    // would offer to delete a user's live music.
    row.onceRenditions?.opus?.key,
    row.onceRenditions?.aac?.key,
  ].filter((k): k is string => Boolean(k));
}

/**
 * The caller's rows that could have a stranded rendition: those missing at least
 * one recorded rendition key. A row with both keys recorded references
 * everything its deterministic key namespace can hold, so it can contribute no
 * orphan and is not worth a `HeadObject`.
 *
 * `$or` with `$exists: false` rather than `status != 'ready'`: it is the
 * *absence of the recorded key* that makes an object unreferenced, and that is
 * true regardless of what the status field happens to say.
 */
async function loadCandidateRows(
  userId: string
): Promise<{ rows: CandidateRow[]; truncated: boolean }> {
  const rows = (await AudioAsset.find(
    {
      ownerId: userId,
      $or: [
        { 'renditions.opus.key': { $exists: false } },
        { 'renditions.aac.key': { $exists: false } },
      ],
    },
    '_id sourceKey renditions onceRenditions'
  )
    .sort({ createdAt: 1 })
    // One extra row is fetched purely so truncation can be DETECTED. The
    // campaign image scanner's `MAX_PAGES` cap discarded `IsTruncated` and
    // returned a partial result that looked complete; a user past the cap got a
    // silently blinded scan. Here the overflow row is the signal, and it is
    // reported to the caller rather than dropped.
    .limit(AUDIO_ORPHAN_SCAN_MAX_ROWS + 1)
    .lean()) as unknown as CandidateRow[];

  const truncated = rows.length > AUDIO_ORPHAN_SCAN_MAX_ROWS;
  return { rows: truncated ? rows.slice(0, AUDIO_ORPHAN_SCAN_MAX_ROWS) : rows, truncated };
}

/**
 * The orphan set for one user, shared by scan and delete so the delete path
 * re-derives ownership from the database instead of trusting the keys the
 * client hands back. A key the client did not receive from its own scan can
 * never reach `DeleteObject`.
 */
async function findOrphans(
  userId: string,
  now: number
): Promise<{ orphans: OrphanAudioObject[]; scannedAssetCount: number; truncated: boolean }> {
  const { rows, truncated } = await loadCandidateRows(userId);

  const inUse = new Set<string>();
  for (const row of rows) {
    for (const key of referencedKeys(row)) inUse.add(key);
  }

  const candidates: string[] = [];
  for (const row of rows) {
    for (const key of renditionKeysFor(String(row._id))) {
      if (!inUse.has(key)) candidates.push(key);
    }
  }

  const { client, bucket } = createR2();
  const orphans: OrphanAudioObject[] = [];
  for (const Key of candidates) {
    let head;
    try {
      head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key }));
    } catch {
      // Overwhelmingly "this object does not exist", which is the normal and
      // expected answer for most candidates — the derivation names every key a
      // row *could* have produced, not every key that was. A genuine R2 fault
      // is indistinguishable here and equally safe to treat as "nothing to
      // reclaim": the scan simply reports less.
      continue;
    }
    const lastModified = head.LastModified ?? null;
    if (lastModified && now - lastModified.getTime() < AUDIO_ORPHAN_MIN_AGE_MS) continue;
    orphans.push({
      key: Key,
      sizeBytes: head.ContentLength ?? 0,
      lastModified: lastModified ? lastModified.toISOString() : null,
    });
  }

  orphans.sort((a, b) => (a.lastModified ?? '').localeCompare(b.lastModified ?? ''));
  return { orphans, scannedAssetCount: rows.length, truncated };
}

function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.CDN_URL
  );
}

export async function scanOrphanAudio({
  userId,
  sessionUserId,
}: {
  data?: z.infer<typeof scanOrphanAudioSchema>;
  userId: string;
  sessionUserId?: string;
}): Promise<ScanOrphanAudioResult> {
  const telemetryUserId = sessionUserId ?? userId;
  try {
    await ensureDb();
    if (!r2Configured()) {
      return { orphans: [], scannedAssetCount: 0, truncated: false, r2Disabled: true };
    }

    const { orphans, scannedAssetCount, truncated } = await findOrphans(userId, Date.now());

    serverCaptureEvent(telemetryUserId, 'audio_orphan_scan', {
      orphan_count: orphans.length,
      scanned_asset_count: scannedAssetCount,
      truncated,
    });

    return { orphans, scannedAssetCount, truncated, r2Disabled: false };
  } catch (e) {
    serverCaptureException(e, telemetryUserId, { action: 'scanOrphanAudio' });
    throw e;
  }
}

export async function deleteOrphanAudio({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof deleteOrphanAudioSchema>;
  userId: string;
  sessionUserId?: string;
}): Promise<DeleteOrphanAudioResult> {
  const telemetryUserId = sessionUserId ?? userId;
  try {
    await ensureDb();
    if (!r2Configured()) {
      return {
        deleted: [],
        failed: data.keys.map((key) => ({ key, error: 'R2 not configured' })),
      };
    }

    // Re-derived from the database on THIS request, not carried over from the
    // scan. The client's key list is treated purely as a selection within the
    // set the server independently computes; anything outside it is refused.
    // That is what makes a forged or stale key — including one belonging to
    // another user — unable to reach DeleteObject.
    const { orphans } = await findOrphans(userId, Date.now());
    const deletable = new Set(orphans.map((o) => o.key));

    const { client, bucket } = createR2();
    const deleted: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];

    for (const key of data.keys) {
      if (!deletable.has(key)) {
        failed.push({ key, error: 'Not a reclaimable object for this account — re-scan' });
        continue;
      }
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        deleted.push(key);
      } catch (e) {
        failed.push({ key, error: e instanceof Error ? e.message : String(e) });
      }
    }

    serverCaptureEvent(telemetryUserId, 'audio_orphan_delete', {
      deleted_count: deleted.length,
      failed_count: failed.length,
    });

    return { deleted, failed };
  } catch (e) {
    serverCaptureException(e, telemetryUserId, { action: 'deleteOrphanAudio' });
    throw e;
  }
}
