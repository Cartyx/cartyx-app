import { z } from 'zod';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Location } from '../db/models/Location';
import { Character } from '../db/models/Character';
import { Player } from '../db/models/Player';
import { AudioAsset } from '../db/models/AudioAsset';
import { serverCaptureEvent, serverCaptureException } from '../utils/telemetry';
import {
  scanOrphanImagesSchema,
  deleteOrphanImagesSchema,
  type DeleteOrphanImagesResult,
  type OrphanImage,
  type ScanOrphanImagesResult,
} from '~/types/schemas/cleanup';

// Prefixes the app uses for R2 uploads. Anything outside these is ignored so
// the scan never proposes deleting keys we don't know how to attribute.
export const TRACKED_PREFIXES = [
  'uploads/locations/',
  'uploads/characters/',
  'uploads/players/',
  'uploads/campaigns/',
  'uploads/audio/',
];

function createR2Client(): { client: S3Client; bucket: string; cdnUrl: string | null } | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    cdnUrl: process.env.CDN_URL?.replace(/\/+$/, '') ?? null,
  };
}

/**
 * Strip the CDN_URL prefix off a stored public URL to recover the R2 key.
 * Returns null when the URL clearly isn't an R2 object (local dev-seed paths,
 * data: URLs, empty strings, etc.) so they don't get treated as orphans.
 */
function urlToKey(url: string | null | undefined, cdnUrl: string | null): string | null {
  if (!url || !cdnUrl) return null;
  if (!url.startsWith(cdnUrl + '/')) return null;
  const key = url.slice(cdnUrl.length + 1);
  return TRACKED_PREFIXES.some((p) => key.startsWith(p)) ? key : null;
}

/**
 * Walk every doc across all campaigns / collections that can hold an image
 * reference and collect the set of in-use R2 keys.
 *
 * This is intentionally global, not per-campaign — R2 keys aren't scoped to a
 * campaign at the storage layer, so the only safe definition of "orphan" is
 * "not referenced by any document anywhere in the system."
 */
async function collectInUseKeys(cdnUrl: string | null): Promise<Set<string>> {
  const inUse = new Set<string>();

  // Locations: imageKey is stored directly, no URL parsing needed.
  const locationCursor = Location.find({}, 'images.imageKey').lean().cursor();
  for await (const doc of locationCursor) {
    const images = (doc as { images?: Array<{ imageKey?: string }> }).images ?? [];
    for (const img of images) {
      if (img.imageKey) inUse.add(img.imageKey);
    }
  }

  // Characters / Players / Campaigns: only the public URL is stored.
  const sources = [
    [Character.find({}, 'picture').lean(), 'picture'],
    [Player.find({}, 'picture').lean(), 'picture'],
    [Campaign.find({}, 'imagePath').lean(), 'imagePath'],
  ] as const;
  for (const [query, field] of sources) {
    const cursor = query.cursor();
    for await (const doc of cursor) {
      const url = (doc as Record<string, unknown>)[field] as string | undefined;
      const key = urlToKey(url, cdnUrl);
      if (key) inUse.add(key);
    }
  }

  // AudioAsset: sourceKey and rendition keys are stored directly as keys, no
  // URL parsing needed — same as Location.images.imageKey above.
  const audioCursor = AudioAsset.find(
    {},
    'sourceKey renditions.opus.key renditions.aac.key onceRenditions.opus.key onceRenditions.aac.key'
  )
    .lean()
    .cursor();
  for await (const doc of audioCursor) {
    const asset = doc as {
      sourceKey?: string;
      renditions?: { opus?: { key?: string }; aac?: { key?: string } };
      // Reserved for phase 2's ∞/1× music variants — never written in phase 1,
      // but a scanner that forgets about them once phase 2 starts populating
      // them would silently offer to delete a user's music. Collect them now.
      onceRenditions?: { opus?: { key?: string }; aac?: { key?: string } };
    };
    if (asset.sourceKey) inUse.add(asset.sourceKey);
    if (asset.renditions?.opus?.key) inUse.add(asset.renditions.opus.key);
    if (asset.renditions?.aac?.key) inUse.add(asset.renditions.aac.key);
    if (asset.onceRenditions?.opus?.key) inUse.add(asset.onceRenditions.opus.key);
    if (asset.onceRenditions?.aac?.key) inUse.add(asset.onceRenditions.aac.key);
  }

  return inUse;
}

async function listAllR2Objects(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<_Object[]> {
  const out: _Object[] = [];
  let continuationToken: string | undefined;
  // Cap to a few thousand keys per prefix as a safety rail; an admin who blew
  // past that should reach for a script, not a UI button.
  const MAX_PAGES = 10;
  for (let i = 0; i < MAX_PAGES; i++) {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    if (resp.Contents) out.push(...resp.Contents);
    if (!resp.IsTruncated) break;
    continuationToken = resp.NextContinuationToken;
  }
  return out;
}

async function requireGmOfCampaign(campaignId: string): Promise<{ sessionUserId: string }> {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');
  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const userId = String(dbUser._id);
  const members = (campaign.members ?? []) as Array<{ userId: unknown; role?: string }>;
  const member = members.find((m) => String(m.userId) === userId);
  const isGM = String(campaign.gameMasterId) === userId || member?.role === 'gm';
  if (!isGM) throw new Error('Forbidden');

  return { sessionUserId: user.id };
}

// ---------------------------------------------------------------------------
// scanOrphanImages
// ---------------------------------------------------------------------------

export { scanOrphanImagesSchema };

export const scanOrphanImages = async ({
  data,
}: {
  data: z.infer<typeof scanOrphanImagesSchema>;
}): Promise<ScanOrphanImagesResult> => {
  let sessionUserId: string | undefined;
  try {
    const auth = await requireGmOfCampaign(data.campaignId);
    sessionUserId = auth.sessionUserId;

    const r2 = createR2Client();
    if (!r2) {
      return { orphans: [], scannedKeyCount: 0, inUseKeyCount: 0, r2Disabled: true };
    }

    const inUseKeys = await collectInUseKeys(r2.cdnUrl);

    const allKeys: _Object[] = [];
    for (const prefix of TRACKED_PREFIXES) {
      const page = await listAllR2Objects(r2.client, r2.bucket, prefix);
      allKeys.push(...page);
    }

    const orphans: OrphanImage[] = [];
    for (const obj of allKeys) {
      if (!obj.Key) continue;
      if (inUseKeys.has(obj.Key)) continue;
      orphans.push({
        imageKey: obj.Key,
        sizeBytes: obj.Size ?? 0,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
      });
    }

    // Stable order: oldest first so the UI shows the longest-lived orphans first.
    orphans.sort((a, b) => (a.lastModified ?? '').localeCompare(b.lastModified ?? ''));

    serverCaptureEvent(sessionUserId, 'orphan_image_scan', {
      campaign_id: data.campaignId,
      orphan_count: orphans.length,
      scanned_key_count: allKeys.length,
      in_use_key_count: inUseKeys.size,
    });

    return {
      orphans,
      scannedKeyCount: allKeys.length,
      inUseKeyCount: inUseKeys.size,
      r2Disabled: false,
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'scanOrphanImages',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteOrphanImages
// ---------------------------------------------------------------------------

export { deleteOrphanImagesSchema };

export const deleteOrphanImages = async ({
  data,
}: {
  data: z.infer<typeof deleteOrphanImagesSchema>;
}): Promise<DeleteOrphanImagesResult> => {
  let sessionUserId: string | undefined;
  try {
    const auth = await requireGmOfCampaign(data.campaignId);
    sessionUserId = auth.sessionUserId;

    const r2 = createR2Client();
    if (!r2) {
      return {
        deleted: [],
        failed: data.imageKeys.map((k) => ({ imageKey: k, error: 'R2 not configured' })),
      };
    }

    // Re-verify each key really is orphan right now — guards against a race
    // where another GM uploaded a file referencing the same key between the
    // GM's Scan and Delete clicks.
    const inUseKeys = await collectInUseKeys(r2.cdnUrl);

    // Also guard the prefix: refuse to delete anything outside the tracked
    // upload roots even if the client asks for it. Defence in depth — the
    // schema already accepts arbitrary strings.
    const allowed = data.imageKeys.filter(
      (k) => TRACKED_PREFIXES.some((p) => k.startsWith(p)) && !inUseKeys.has(k)
    );
    const rejected = data.imageKeys.filter((k) => !allowed.includes(k));

    const deleted: string[] = [];
    const failed: Array<{ imageKey: string; error: string }> = rejected.map((k) => ({
      imageKey: k,
      error: inUseKeys.has(k)
        ? 'Image is now referenced — re-scan'
        : 'Key outside tracked prefixes',
    }));

    // Sequential delete — R2 typically caps concurrent ops per connection;
    // sequential keeps the per-key error reporting clean.
    for (const key of allowed) {
      try {
        await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
        deleted.push(key);
      } catch (e) {
        failed.push({ imageKey: key, error: e instanceof Error ? e.message : String(e) });
      }
    }

    serverCaptureEvent(sessionUserId, 'orphan_image_delete', {
      campaign_id: data.campaignId,
      deleted_count: deleted.length,
      failed_count: failed.length,
    });

    return { deleted, failed };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'deleteOrphanImages',
      campaignId: data.campaignId,
    });
    throw e;
  }
};
