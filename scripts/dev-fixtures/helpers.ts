/**
 * Shared helpers for dev fixture scripts.
 *
 * Provides:
 *   - Safe Mongo connection (refuses prod URIs)
 *   - GM lookup
 *   - Campaign destroyer that walks every collection a campaign touches
 *     (sessions, chars, players, locations, screens, notes, rules, etc.)
 *     plus best-effort R2 image cleanup
 *   - Fixture marker schema so we only ever destroy what we created
 */
import {
  S3Client,
  DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import mongoose, { type Connection } from 'mongoose';
import { ObjectId } from 'mongodb';

// Load .env into process.env so MONGODB_URI / R2 creds are picked up.
// Node 20.6+ has this built-in; ignored if .env doesn't exist.
try {
  process.loadEnvFile('.env');
} catch {
  // optional
}

export const FIXTURE_MARKER = {
  // Tag every campaign and child doc created by the fixture system so we
  // can identify ours and only destroy ours. Saved in `metadata` field on
  // the Campaign doc.
  managedBy: 'scripts/dev-fixtures',
} as const;

export interface FixtureMetadata {
  managedBy: typeof FIXTURE_MARKER.managedBy;
  fixtureName: string;
  createdAt: string;
}

/** Refuses to run if the URI looks like prod. Loads .env into process.env. */
export function requireSafeMongoUri(): { uri: string; dbName?: string } {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run dev fixtures in NODE_ENV=production.');
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set (load via .env or shell export).');
  }
  if (/prod/i.test(uri)) {
    throw new Error('MONGODB_URI looks like a production connection string. Aborting.');
  }
  return { uri, dbName: process.env.MONGODB_DB };
}

export async function connectMongo(): Promise<Connection> {
  const { uri, dbName } = requireSafeMongoUri();
  await mongoose.connect(uri, { dbName });
  const conn = mongoose.connection;
  if (!conn.db) throw new Error('Mongo connected but db handle missing.');
  return conn;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** Find the GM user — fixture campaigns will be owned by this account. */
export async function findGm(conn: Connection): Promise<{ _id: ObjectId; providerId?: string }> {
  const db = conn.db!;
  const gm = await db.collection('users').findOne({ role: 'gm' });
  if (!gm) {
    throw new Error(
      'No GM user found. Run `node scripts/seed-gm.cjs` then log in once to create the User doc.'
    );
  }
  return { _id: gm._id as ObjectId, providerId: gm.providerId };
}

// ---------------------------------------------------------------------------
// Destroyer
// ---------------------------------------------------------------------------

/**
 * Collections (and the field name they store campaignId in) that a fixture
 * campaign can populate. Stays in lockstep with the app models. If you add
 * a new campaign-scoped collection, add it here too.
 */
// Mongoose collection names verified against the model files in
// app/server/db/models/. Several use singular custom names — be careful when
// updating: `location`, `locationtype`, `tabletopscreen`, `gmscreen`,
// `tabletopplayerstate`, `sessionevent`. The rest follow Mongoose's default
// (lowercased + pluralised).
const CAMPAIGN_SCOPED_COLLECTIONS: Array<{ name: string; field: string }> = [
  { name: 'sessions', field: 'campaignId' },
  { name: 'characters', field: 'campaignId' },
  { name: 'players', field: 'campaignId' },
  { name: 'location', field: 'campaignId' },
  { name: 'locationtype', field: 'campaignId' },
  { name: 'tabletopscreen', field: 'campaignId' },
  { name: 'tabletopplayerstate', field: 'campaignId' },
  { name: 'gmscreen', field: 'campaignId' },
  { name: 'notes', field: 'campaignId' },
  { name: 'rules', field: 'campaignId' },
  { name: 'races', field: 'campaignId' },
  { name: 'tags', field: 'campaignId' },
];

/** Collections keyed by sessionId (per-session data, deleted via the campaign's session ids). */
const SESSION_SCOPED_COLLECTIONS: Array<{ name: string; field: string }> = [
  { name: 'sessionevent', field: 'sessionId' },
  { name: 'messages', field: 'sessionId' },
  { name: 'dicerolls', field: 'sessionId' },
];

function createR2Client(): { client: S3Client; bucket: string } | null {
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
  };
}

/** Strip the CDN_URL prefix off a stored URL to recover the R2 key. */
function urlToKey(url: string | null | undefined, cdnUrl: string | null): string | null {
  if (!url || !cdnUrl) return null;
  if (!url.startsWith(cdnUrl + '/')) return null;
  return url.slice(cdnUrl.length + 1);
}

export interface DestroyResult {
  campaignsDeleted: number;
  collectionsDeleted: Record<string, number>;
  r2KeysDeleted: number;
  r2KeysFailed: number;
}

/**
 * Destroy fixture-managed campaigns matching the filter. Safety:
 *   - Default behaviour requires `metadata.managedBy === FIXTURE_MARKER.managedBy`
 *     on the campaign. Pass `force: true` to bypass (use with care).
 *
 * Cleans up every campaign-scoped collection, every session-scoped collection
 * (resolved via session ids), and best-effort R2 image keys.
 */
export async function destroyCampaigns(
  conn: Connection,
  filter: { fixtureName?: string; campaignId?: string; allFixtures?: boolean; force?: boolean }
): Promise<DestroyResult> {
  const db = conn.db!;
  const cdnUrl = process.env.CDN_URL?.replace(/\/+$/, '') ?? null;

  const mongoFilter: Record<string, unknown> = {};
  if (filter.campaignId) {
    mongoFilter._id = new ObjectId(filter.campaignId);
  } else if (filter.fixtureName) {
    mongoFilter['metadata.managedBy'] = FIXTURE_MARKER.managedBy;
    mongoFilter['metadata.fixtureName'] = filter.fixtureName;
  } else if (filter.allFixtures) {
    mongoFilter['metadata.managedBy'] = FIXTURE_MARKER.managedBy;
  } else {
    throw new Error('destroyCampaigns: provide fixtureName, campaignId, or allFixtures.');
  }

  const campaigns = await db.collection('campaigns').find(mongoFilter).toArray();

  // Safety: if a single campaign was named by id but isn't fixture-managed,
  // refuse unless force is set.
  if (filter.campaignId && !filter.force) {
    const c = campaigns[0];
    const managed = (c?.metadata as { managedBy?: string } | undefined)?.managedBy;
    if (managed !== FIXTURE_MARKER.managedBy) {
      throw new Error(
        `Refusing to destroy campaign ${filter.campaignId}: not managed by fixtures. Pass force: true to override.`
      );
    }
  }

  const result: DestroyResult = {
    campaignsDeleted: 0,
    collectionsDeleted: {},
    r2KeysDeleted: 0,
    r2KeysFailed: 0,
  };

  if (campaigns.length === 0) return result;

  const r2 = createR2Client();
  const r2KeysToDelete = new Set<string>();
  const campaignIds = campaigns.map((c) => c._id);

  // ----- Collect R2 keys before destroying so we can resolve images by URL -----
  const collectKeys = async (collection: string, projection: Record<string, 1>) => {
    const docs = await db
      .collection(collection)
      .find({ campaignId: { $in: campaignIds } }, { projection })
      .toArray();
    for (const doc of docs) {
      // Locations: images[].imageKey is the direct R2 key
      const images = (doc.images ?? []) as Array<{ imageKey?: string }>;
      for (const img of images) {
        if (img.imageKey) r2KeysToDelete.add(img.imageKey);
      }
      // Characters/Players store URL in `picture`; Campaign uses `imagePath`
      for (const field of ['picture', 'imagePath']) {
        const url = doc[field] as string | undefined;
        const key = urlToKey(url, cdnUrl);
        if (key) r2KeysToDelete.add(key);
      }
    }
  };
  await collectKeys('location', { images: 1 });
  await collectKeys('characters', { picture: 1 });
  await collectKeys('players', { picture: 1 });
  for (const c of campaigns) {
    const key = urlToKey(c.imagePath as string | undefined, cdnUrl);
    if (key) r2KeysToDelete.add(key);
  }

  // ----- Resolve session ids for session-scoped cleanup -----
  const sessions = await db
    .collection('sessions')
    .find({ campaignId: { $in: campaignIds } }, { projection: { _id: 1 } })
    .toArray();
  const sessionIds = sessions.map((s) => s._id);

  // ----- Delete session-scoped data -----
  if (sessionIds.length > 0) {
    for (const { name, field } of SESSION_SCOPED_COLLECTIONS) {
      const r = await db.collection(name).deleteMany({ [field]: { $in: sessionIds } });
      if (r.deletedCount)
        result.collectionsDeleted[name] = (result.collectionsDeleted[name] ?? 0) + r.deletedCount;
    }
  }

  // ----- Delete campaign-scoped data -----
  for (const { name, field } of CAMPAIGN_SCOPED_COLLECTIONS) {
    const r = await db.collection(name).deleteMany({ [field]: { $in: campaignIds } });
    if (r.deletedCount)
      result.collectionsDeleted[name] = (result.collectionsDeleted[name] ?? 0) + r.deletedCount;
  }

  // ----- Delete campaigns -----
  const campRes = await db.collection('campaigns').deleteMany({ _id: { $in: campaignIds } });
  result.campaignsDeleted = campRes.deletedCount ?? 0;

  // ----- Pull campaign refs from user.campaigns arrays -----
  // Cast the update to `any` — MongoDB driver's PullOperator type is overly
  // strict about nested-array selectors which Mongo itself fully supports.
  await db.collection('users').updateMany(
    { 'campaigns.campaignId': { $in: campaignIds } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $pull: { campaigns: { campaignId: { $in: campaignIds } } } } as any
  );

  // ----- Best-effort R2 cleanup -----
  if (r2 && r2KeysToDelete.size > 0) {
    const settled = await Promise.allSettled(
      [...r2KeysToDelete].map(async (key) => {
        const out: DeleteObjectCommandOutput = await r2.client.send(
          new DeleteObjectCommand({ Bucket: r2.bucket, Key: key })
        );
        return out;
      })
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') result.r2KeysDeleted++;
      else result.r2KeysFailed++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// E2E artifact cleanup
// ---------------------------------------------------------------------------

/**
 * `e2e/globalSetup.ts` creates two artefacts in the dev DB that don't live
 * inside a fixture-managed campaign:
 *   - a tabletopscreen named "E2E Test Screen" (attached to whatever
 *     campaign globalSetup picked as the first GM campaign)
 *   - an "E2E Lightbox Fixture" image (imageKey starts with `e2e/`)
 *     attached to whatever location it picked
 *
 * These survive `fixture destroy --all` because they're attached to real
 * (non-fixture) campaigns/locations. This helper sweeps them up directly.
 */
export interface CleanE2eResult {
  screensDeleted: number;
  locationsTouched: number;
  imagesPulled: number;
  r2KeysDeleted: number;
}

export async function cleanE2eArtifacts(conn: Connection): Promise<CleanE2eResult> {
  const db = conn.db!;

  // 1. tabletopscreens named "E2E Test Screen"
  const screenRes = await db.collection('tabletopscreen').deleteMany({ name: 'E2E Test Screen' });

  // 2. Find every location with at least one e2e/* image, then $pull those images.
  const locsWithE2eImages = await db
    .collection('location')
    .find(
      { 'images.imageKey': { $regex: /^e2e\// } },
      { projection: { _id: 1, 'images.imageKey': 1 } }
    )
    .toArray();

  const r2KeysToDelete = new Set<string>();
  let imagesPulled = 0;
  for (const loc of locsWithE2eImages) {
    const images = (loc.images ?? []) as Array<{ imageKey?: string }>;
    for (const img of images) {
      if (img.imageKey && img.imageKey.startsWith('e2e/')) {
        r2KeysToDelete.add(img.imageKey);
        imagesPulled++;
      }
    }
  }
  if (locsWithE2eImages.length > 0) {
    await db.collection('location').updateMany(
      { 'images.imageKey': { $regex: /^e2e\// } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { $pull: { images: { imageKey: { $regex: /^e2e\// } } } } as any
    );
  }

  // 3. R2 cleanup for those e2e/* keys (best-effort)
  let r2KeysDeleted = 0;
  const r2 = createR2Client();
  if (r2 && r2KeysToDelete.size > 0) {
    const settled = await Promise.allSettled(
      [...r2KeysToDelete].map((key) =>
        r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }))
      )
    );
    for (const s of settled) if (s.status === 'fulfilled') r2KeysDeleted++;
  }

  return {
    screensDeleted: screenRes.deletedCount ?? 0,
    locationsTouched: locsWithE2eImages.length,
    imagesPulled,
    r2KeysDeleted,
  };
}

// ---------------------------------------------------------------------------
// Orphan R2 sweep
// ---------------------------------------------------------------------------

/**
 * After fixture destroy, sweep R2 under tracked prefixes and delete any
 * object that no document in the system references. Backstop for the case
 * where a fixture seed crashed mid-upload (R2 PUT done, DB insert never
 * happened) or where past leakage left bytes behind. Drives R2 cost down
 * to zero waste.
 */
export interface OrphanSweepResult {
  inspected: number;
  inUse: number;
  orphansDeleted: number;
  orphansFailed: number;
  skippedNoR2: boolean;
}

const TRACKED_R2_PREFIXES = [
  'uploads/locations/',
  'uploads/characters/',
  'uploads/players/',
  'uploads/campaigns/',
  'fixture/',
];

export async function sweepOrphanR2Keys(conn: Connection): Promise<OrphanSweepResult> {
  const r2 = createR2Client();
  if (!r2) {
    return { inspected: 0, inUse: 0, orphansDeleted: 0, orphansFailed: 0, skippedNoR2: true };
  }

  const cdnUrl = process.env.CDN_URL?.replace(/\/+$/, '') ?? null;
  const db = conn.db!;

  // Build the set of in-use R2 keys across every campaign-scoped doc.
  const inUse = new Set<string>();

  for await (const doc of db
    .collection('location')
    .find({}, { projection: { 'images.imageKey': 1 } })
    .stream()) {
    const images = (doc.images ?? []) as Array<{ imageKey?: string }>;
    for (const img of images) if (img.imageKey) inUse.add(img.imageKey);
  }

  const urlSources: Array<[string, string]> = [
    ['characters', 'picture'],
    ['players', 'picture'],
    ['campaigns', 'imagePath'],
  ];
  for (const [coll, field] of urlSources) {
    for await (const doc of db
      .collection(coll)
      .find({}, { projection: { [field]: 1 } })
      .stream()) {
      const url = (doc as Record<string, unknown>)[field] as string | undefined;
      if (!url || !cdnUrl) continue;
      if (!url.startsWith(cdnUrl + '/')) continue;
      inUse.add(url.slice(cdnUrl.length + 1));
    }
  }

  // List R2 objects under each tracked prefix.
  let inspected = 0;
  const orphanKeys: string[] = [];
  // Runaway guard only — at 1000 keys/page this is ~200k keys per prefix,
  // far beyond anything a dev bucket should hold. If we ever hit it, warn
  // loudly: keys past the cap were not inspected, so orphans may remain.
  const MAX_LIST_PAGES = 200;
  for (const prefix of TRACKED_R2_PREFIXES) {
    let continuationToken: string | undefined;
    let pages = 0;
    let truncated = false;
    while (pages++ < MAX_LIST_PAGES) {
      const resp = await r2.client.send(
        new ListObjectsV2Command({
          Bucket: r2.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of resp.Contents ?? []) {
        if (!obj.Key) continue;
        inspected++;
        if (!inUse.has(obj.Key)) orphanKeys.push(obj.Key);
      }
      truncated = resp.IsTruncated ?? false;
      if (!truncated) break;
      continuationToken = resp.NextContinuationToken;
    }
    if (truncated) {
      console.warn(
        `[sweep-r2] WARNING: prefix "${prefix}" still truncated after ${MAX_LIST_PAGES} pages — ` +
          'remaining keys were NOT inspected and orphans may have been missed.'
      );
    }
  }

  let orphansDeleted = 0;
  let orphansFailed = 0;
  if (orphanKeys.length > 0) {
    const settled = await Promise.allSettled<DeleteObjectCommandOutput>(
      orphanKeys.map((key) =>
        r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }))
      )
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') orphansDeleted++;
      else orphansFailed++;
    }
  }

  return {
    inspected,
    inUse: inUse.size,
    orphansDeleted,
    orphansFailed,
    skippedNoR2: false,
  };
}
