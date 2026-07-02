#!/usr/bin/env node
/**
 * Generate local PNG avatars for seeded monsters and characters, replacing the
 * old DiceBear CDN URLs. DiceBear rate-limits the burst of ~350 image requests
 * the wiki fires on load (many 429 → "half the images don't render"); local
 * files have no rate limit and work offline.
 *
 * For each monster/character we build a deterministic identicon SVG (seeded by
 * the entity name), rasterize it to PNG with @resvg/resvg-js, write it to
 * `public/uploads/seed-avatars/{kind}/{hash}.png`, and repoint the document's
 * `picture` at it. When the app's CDN is configured (CDN_URL + R2_* env vars)
 * the PNG is also uploaded to R2 and `picture` gets the full CDN URL — the
 * deployed dev environment can't serve local files. Idempotent: existing
 * PNGs/objects are reused, and the path is derived purely from the name so the
 * Python seed (which sets the same URL on insert) and this generator agree.
 *
 * Usage:
 *   npm run dev:gen-avatars
 *
 * Safety: refuses to run if NODE_ENV is "production" or MONGODB_URI looks prod.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { Resvg } from '@resvg/resvg-js';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Minimal .env loader (no dotenv dependency for this dev script) ---------
function loadEnv() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// --- CDN / R2 ----------------------------------------------------------------
// Mirrors scripts/dev_seed.py: when the app's CDN is configured (CDN_URL +
// R2_* env vars), avatars are uploaded to R2 and documents point at full CDN
// URLs — the deployed dev environment (Vercel) cannot serve local
// public/uploads/ writes. Without CDN config, local files are all we need.

function r2Env() {
  const keys = [
    'CDN_URL',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k] ?? '']));
  if (!keys.every((k) => env[k])) return null;
  if (/prod/i.test(env.R2_BUCKET)) {
    console.error('R2_BUCKET looks like a production bucket. Aborting.');
    process.exit(1);
  }
  return env;
}

function r2ClientFor(env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
}

/** Keys already present under a prefix — one LIST instead of ~350 HEADs. */
async function listExistingKeys(s3, bucket, prefix) {
  const keys = new Set();
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const obj of page.Contents ?? []) keys.add(obj.Key);
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

// --- Deterministic identicon ------------------------------------------------

/** Stable path (served + on disk) for an entity's avatar. */
function avatarRelPath(kind, name) {
  const hash = createHash('sha1').update(`${kind}:${name}`).digest('hex').slice(0, 16);
  return `/uploads/seed-avatars/${kind}/${hash}.png`;
}

/**
 * Whether it's safe to repoint a document's `picture` at the generated seed
 * avatar. Only repoint placeholders we own — an empty value, an existing
 * seed-avatar path, or the old DiceBear CDN URL the seed used to set. A custom
 * uploaded picture (anything else) is left untouched so re-running this dev
 * script never destroys real data.
 */
function isReplaceablePicture(picture) {
  if (picture == null || picture === '') return true;
  if (typeof picture !== 'string') return false;
  if (picture.startsWith('/uploads/seed-avatars/')) return true;
  // CDN-hosted seed avatar (any origin — the CDN URL may have changed).
  if (/^https:\/\/[^/]+\/uploads\/seed-avatars\//.test(picture)) return true;
  return /(?:api\.)?dicebear\.com/i.test(picture);
}

/**
 * GitHub-style identicon: a 5×5 grid whose left three columns are mirrored to
 * the right, filled from the name hash, on a dark-tinted background. The hue is
 * derived from the hash so every entity is visually distinct but stable.
 */
function identiconSvg(name) {
  const bytes = createHash('sha1').update(name).digest();
  const hue = bytes[0] % 360;
  const bg = `hsl(${hue} 32% 16%)`;
  const fg = `hsl(${hue} 62% 60%)`;

  const SIZE = 120;
  const PAD = 16;
  const cell = (SIZE - PAD * 2) / 5;

  let rects = '';
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      // One bit per (col,row) cell from the hash; ~50% fill.
      const bit = bytes[col * 5 + row + 1] ?? bytes[(col + row) % bytes.length];
      if (bit % 2 !== 0) continue;
      const x = PAD + col * cell;
      const y = PAD + row * cell;
      rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${fg}"/>`;
      if (col < 2) {
        const mx = PAD + (4 - col) * cell;
        rects += `<rect x="${mx.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${fg}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>${rects}</svg>`;
}

function renderPng(svg) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: 120 } }).render().asPng();
}

// --- Main -------------------------------------------------------------------

async function processCollection(db, collection, kind, nameOf, cdn) {
  let generated = 0;
  let reused = 0;
  let uploaded = 0;
  let repointed = 0;
  let skipped = 0;
  const cursor = db
    .collection(collection)
    .find({}, { projection: { name: 1, firstName: 1, lastName: 1, picture: 1 } });
  for await (const doc of cursor) {
    const name = nameOf(doc) || kind;
    const rel = avatarRelPath(kind, name);
    const abs = join(REPO_ROOT, 'public', rel.replace(/^\//, ''));

    // Local PNG doubles as the render cache for R2 uploads.
    if (existsSync(abs)) {
      reused++;
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, renderPng(identiconSvg(name)));
      generated++;
    }

    if (cdn) {
      const key = rel.replace(/^\//, '');
      if (!cdn.existingKeys.has(key)) {
        await cdn.s3.send(
          new PutObjectCommand({
            Bucket: cdn.bucket,
            Key: key,
            Body: readFileSync(abs),
            ContentType: 'image/png',
          })
        );
        cdn.existingKeys.add(key);
        uploaded++;
      }
    }

    const publicPath = cdn ? `${cdn.base}${rel}` : rel;
    if (doc.picture === publicPath) {
      // Already points at this seed avatar — nothing to do.
    } else if (!cdn && typeof doc.picture === 'string' && doc.picture.startsWith('https://')) {
      // Never downgrade a CDN-hosted picture to a local path just because
      // this run lacks CDN config — the deployed dev app can't serve local
      // files, so the repoint would break every avatar until re-run with R2.
      skipped++;
    } else if (isReplaceablePicture(doc.picture)) {
      await db
        .collection(collection)
        .updateOne({ _id: doc._id }, { $set: { picture: publicPath } });
      repointed++;
    } else {
      // Custom/uploaded picture — never overwrite real data.
      skipped++;
    }
  }
  console.log(
    `${collection}: ${generated} PNGs generated, ${reused} reused, ${uploaded} uploaded to R2, ${repointed} repointed, ${skipped} pictures preserved (custom or CDN-hosted)`
  );
}

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set (check .env)');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' || /prod/i.test(uri)) {
    console.error('Refusing to run against a production-looking database.');
    process.exit(1);
  }

  // When the CDN is configured, mirror every avatar into R2 and point the
  // documents at CDN URLs (the deployed dev app can't see local files).
  let cdn = null;
  const env = r2Env();
  if (env) {
    const s3 = r2ClientFor(env);
    cdn = {
      s3,
      bucket: env.R2_BUCKET,
      base: env.CDN_URL.replace(/\/+$/, ''),
      existingKeys: await listExistingKeys(s3, env.R2_BUCKET, 'uploads/seed-avatars/'),
    };
    console.log(`CDN configured — uploading avatars to R2 bucket '${env.R2_BUCKET}'`);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    await processCollection(db, 'monsters', 'monster', (d) => d.name, cdn);
    await processCollection(
      db,
      'characters',
      'character',
      (d) => `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
      cdn
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
