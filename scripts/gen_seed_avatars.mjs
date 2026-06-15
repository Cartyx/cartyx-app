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
 * `picture` at that path. Idempotent: existing PNGs are reused, and the path is
 * derived purely from the name so the Python seed (which sets the same path on
 * insert) and this generator always agree.
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

async function processCollection(db, collection, kind, nameOf) {
  let generated = 0;
  let reused = 0;
  let repointed = 0;
  let skipped = 0;
  const cursor = db
    .collection(collection)
    .find({}, { projection: { name: 1, firstName: 1, lastName: 1, picture: 1 } });
  for await (const doc of cursor) {
    const name = nameOf(doc) || kind;
    const rel = avatarRelPath(kind, name);
    const abs = join(REPO_ROOT, 'public', rel.replace(/^\//, ''));

    if (existsSync(abs)) {
      reused++;
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, renderPng(identiconSvg(name)));
      generated++;
    }

    if (doc.picture === rel) {
      // Already points at this seed avatar — nothing to do.
    } else if (isReplaceablePicture(doc.picture)) {
      await db.collection(collection).updateOne({ _id: doc._id }, { $set: { picture: rel } });
      repointed++;
    } else {
      // Custom/uploaded picture — never overwrite real data.
      skipped++;
    }
  }
  console.log(
    `${collection}: ${generated} PNGs generated, ${reused} reused, ${repointed} repointed, ${skipped} custom pictures preserved`
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

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    await processCollection(db, 'monsters', 'monster', (d) => d.name);
    await processCollection(db, 'characters', 'character', (d) =>
      `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim()
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
