import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { serverCaptureEvent, serverCaptureException } from '../utils/telemetry';
import { audioUserRoot, lookupAudioStoragePrefix } from './audio-storage';
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
 * HOW THIS ONE IS SCOPED — and why the scoping is structural
 * ----------------------------------------------------------
 * Every audio object a user owns lives under `uploads/audio/<prefix>/`, where
 * `<prefix>` is 128 random bits stored on their User document (see
 * `./audio-storage.ts` for why it is random rather than the owner id, and why
 * it lives there). This module lists exactly that prefix and nothing else.
 *
 * That makes the scoping a property of the S3 API rather than of any filter
 * written here: `ListObjectsV2` with `Prefix: uploads/audio/<prefix>/` cannot
 * return an object belonging to anyone else, because the server will not send
 * one. There is no attribution step to get wrong. (The `startsWith` re-check
 * below is belt-and-braces against a mocked/misbehaving client, not the
 * mechanism.)
 *
 * WHAT THIS FINDS
 * ---------------
 * Everything in the namespace that no row of the caller's references:
 *
 * - Renditions the worker PUT but never recorded: it uploads both renditions
 *   and only then issues the fenced DB write, so an Atlas blip, a lost fence,
 *   or a pod eviction in that window leaves objects nothing references. If the
 *   asset ultimately lands in `failed` they are stranded permanently.
 * - **Source objects whose row is already gone** — the case the previous,
 *   derivation-based version of this module could not reach. `deleteAudioAsset`
 *   deletes from R2 best-effort and drops the row regardless (deliberately), so
 *   a failed object delete used to destroy the only record of that key. Under a
 *   flat `uploads/audio/` root nothing could name it again and no listing could
 *   attribute it to an owner. Under the per-user prefix the listing IS the
 *   record.
 *
 * WHAT IT DOES NOT FIND — stated plainly rather than papered over
 * --------------------------------------------------------------
 * Objects written under the OLD flat layout (`uploads/audio/<ts>-<rand>.<ext>`
 * and `uploads/audio/renditions/<id>.<ext>`). They sit outside every user's
 * prefix, so no owner-scoped listing reaches them and nothing here will ever
 * report or delete them. Reclaiming those needs a bucket-wide sweep run by
 * whoever administers the bucket, out of band. Nothing on this branch has
 * shipped, so in practice that is dev/e2e data only — but the rule is
 * structural, not transitional: an object outside a namespace has no owner.
 */

/**
 * The most objects one scan pass looks at.
 *
 * Each page is one `ListObjectsV2` round trip of up to 1000 keys, so this is
 * ~10 requests at the ceiling. A library of any realistic size is one page.
 */
export const AUDIO_ORPHAN_SCAN_MAX_KEYS = 10_000;

/**
 * An object younger than this is never reported or deleted.
 *
 * This closes the one genuine race in the design: the worker PUTs both
 * renditions and only afterwards writes the keys onto the row, so for a short
 * window an object legitimately exists with nothing referencing it. It also
 * covers the equivalent window on the upload side — a presigned PUT that has
 * landed while the row still records only the key. Without an age floor a scan
 * landing in either window would call a live object an orphan and offer to
 * delete it. One hour is far longer than both gaps (bounded by the worker's R2
 * timeouts and the 300 s presign lifetime) and far shorter than any useful
 * reclamation horizon.
 */
export const AUDIO_ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

type ListedObject = { key: string; sizeBytes: number; lastModified: Date | null };

/**
 * Every object under one user's namespace, paginated properly.
 *
 * `truncated` is a first-class result, not a swallowed detail. The campaign
 * image scanner's `listAllR2Objects` capped itself at `MAX_PAGES = 10` and
 * discarded `IsTruncated`, so an account past the cap got a partial scan
 * presented as a complete one — with "no orphans found" as the visible answer.
 * Here the cap is reported, and the UI says the scan was partial.
 */
async function listUserObjects(
  client: ReturnType<typeof createR2>['client'],
  bucket: string,
  root: string
): Promise<{ objects: ListedObject[]; truncated: boolean }> {
  const objects: ListedObject[] = [];
  let token: string | undefined;
  let truncated = false;

  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: root, ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) {
      // The listing is already owner-scoped by the API — this re-check exists
      // so that NOTHING outside the caller's namespace can reach a result or a
      // DeleteObject even if the client returned something unexpected. It is
      // the last line of defence for the property the module's whole design
      // rests on, and it is cheap.
      if (!o.Key || !o.Key.startsWith(root)) continue;
      objects.push({
        key: o.Key,
        sizeBytes: o.Size ?? 0,
        lastModified: o.LastModified ?? null,
      });
      if (objects.length >= AUDIO_ORPHAN_SCAN_MAX_KEYS) {
        return { objects, truncated: true };
      }
    }
    truncated = Boolean(res.IsTruncated);
    token = res.NextContinuationToken;
  } while (token);

  return { objects, truncated };
}

/**
 * Which of `keys` are referenced by one of the caller's asset rows.
 *
 * Keyed on the listed objects rather than loading every row, so the query is
 * bounded by the page cap above and no row limit is needed — a row cap here
 * would be dangerous rather than merely partial: an unloaded row's keys would
 * look unreferenced, i.e. the scan would offer to delete live audio.
 *
 * `onceRenditions` and `onceSourceKey` are Task 18's ∞/1× music-variant
 * fields, and a cleanup that forgot any of them would offer to delete a
 * user's live music or an attach that's still mid-upload. `onceSourceKey`
 * specifically was missed in Task 18's initial cut — this module's own
 * doc comment above anticipated exactly this class of bug for
 * `onceRenditions` and the new sibling field walked past it: the review
 * that caught it reproduced a live once-attach source getting reported (and
 * deletable) as an orphan once it crossed `AUDIO_ORPHAN_MIN_AGE_MS`.
 */
async function referencedKeys(userId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();

  const rows = (await AudioAsset.find(
    {
      // Redundant with the prefix — every key under `uploads/audio/<prefix>/`
      // was minted for this user — and kept anyway because it lets the query
      // use the `{ownerId, createdAt}` index instead of scanning the
      // collection on unindexed key fields.
      ownerId: userId,
      $or: [
        { sourceKey: { $in: keys } },
        { onceSourceKey: { $in: keys } },
        { 'renditions.opus.key': { $in: keys } },
        { 'renditions.aac.key': { $in: keys } },
        { 'onceRenditions.opus.key': { $in: keys } },
        { 'onceRenditions.aac.key': { $in: keys } },
      ],
    },
    'sourceKey onceSourceKey renditions onceRenditions'
  ).lean()) as unknown as Array<{
    sourceKey?: string;
    onceSourceKey?: string;
    renditions?: { opus?: { key?: string }; aac?: { key?: string } };
    onceRenditions?: { opus?: { key?: string }; aac?: { key?: string } };
  }>;

  const referenced = new Set<string>();
  for (const row of rows) {
    for (const key of [
      row.sourceKey,
      row.onceSourceKey,
      row.renditions?.opus?.key,
      row.renditions?.aac?.key,
      row.onceRenditions?.opus?.key,
      row.onceRenditions?.aac?.key,
    ]) {
      if (key) referenced.add(key);
    }
  }
  return referenced;
}

/**
 * The orphan set for one user, shared by scan and delete so the delete path
 * re-derives ownership from R2 + the database on the delete request instead of
 * trusting the keys the client hands back.
 */
async function findOrphans(
  userId: string,
  now: number
): Promise<{ orphans: OrphanAudioObject[]; scannedObjectCount: number; truncated: boolean }> {
  const storagePrefix = await lookupAudioStoragePrefix(userId);
  // No prefix means the user has never uploaded audio, so they own no
  // namespace and no objects. Deliberately does NOT mint one: a scan must not
  // be the thing that writes to a user document.
  if (!storagePrefix) return { orphans: [], scannedObjectCount: 0, truncated: false };

  const root = audioUserRoot(storagePrefix);
  const { client, bucket } = createR2();
  const { objects, truncated } = await listUserObjects(client, bucket, root);

  const referenced = await referencedKeys(
    userId,
    objects.map((o) => o.key)
  );

  const orphans: OrphanAudioObject[] = [];
  for (const o of objects) {
    if (referenced.has(o.key)) continue;
    if (o.lastModified && now - o.lastModified.getTime() < AUDIO_ORPHAN_MIN_AGE_MS) continue;
    orphans.push({
      key: o.key,
      sizeBytes: o.sizeBytes,
      lastModified: o.lastModified ? o.lastModified.toISOString() : null,
    });
  }

  orphans.sort((a, b) => (a.lastModified ?? '').localeCompare(b.lastModified ?? ''));
  return { orphans, scannedObjectCount: objects.length, truncated };
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
      return { orphans: [], scannedObjectCount: 0, truncated: false, r2Disabled: true };
    }

    const { orphans, scannedObjectCount, truncated } = await findOrphans(userId, Date.now());

    serverCaptureEvent(telemetryUserId, 'audio_orphan_scan', {
      orphan_count: orphans.length,
      scanned_object_count: scannedObjectCount,
      truncated,
    });

    return { orphans, scannedObjectCount, truncated, r2Disabled: false };
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

    // Re-derived on THIS request, not carried over from the scan. The client's
    // key list is treated purely as a selection within the set the server
    // independently computes; anything outside it is refused. That is what
    // makes a forged or stale key — including a well-formed one belonging to
    // another user's namespace — unable to reach DeleteObject.
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
