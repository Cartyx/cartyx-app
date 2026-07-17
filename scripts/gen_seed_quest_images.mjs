#!/usr/bin/env node
/**
 * Generate local PNG scene/detail images for seeded quests.
 *
 * Each quest gets TWO deterministic images (`<slug>-1.png`, `<slug>-2.png`)
 * so the wiki + tabletop image gallery has real content to render. The slugs
 * MUST match the `imgs(...)` slugs in `build_quest_docs` in scripts/dev_seed.py
 * (`/uploads/quests/<slug>-<n>.png`).
 *
 * Style mirrors gen_seed_org_images.mjs (deterministic hue from the slug), with
 * a parchment/scroll glyph instead of a heraldic shield, and a per-variant hue
 * shift so the two images for one quest look distinct.
 *
 * When the app's CDN is configured (CDN_URL + R2_* env vars) the PNGs are also
 * uploaded to R2 — exactly like gen_seed_org_images.mjs — so the deployed dev
 * app (which can't serve local public/uploads/ writes) resolves them via the
 * CDN. The Python seed sets each image URL via `public_url(...)`, so the
 * stored URL and the uploaded R2 key agree. Idempotent: local files are
 * overwritten and R2 objects already present are skipped.
 *
 * Usage:
 *   node scripts/gen_seed_quest_images.mjs
 *   npm run dev:seed   (called automatically as part of the chain)
 *
 * Safety: r2Env() refuses a production-looking R2 bucket.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Minimal .env loader (mirrors gen_seed_org_images.mjs) -------------------
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

// --- CDN / R2 (mirrors gen_seed_org_images.mjs) ------------------------------
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

// slug → display name. Slugs MUST match build_quest_docs in dev_seed.py.
const QUESTS = [
  { slug: 'goblin_arrows', name: 'Goblin Arrows' },
  { slug: 'old_owl_well', name: 'Old Owl Well' },
  { slug: 'an_old_debt', name: 'An Old Debt' },
  { slug: 'black_spiders_plot', name: "The Black Spider's Plot" },
  { slug: 'cragmaw_hideout', name: 'Clear the Cragmaw Hideout' },
];

// Two variants per quest — a subtitle + a hue nudge so the images differ.
const VARIANTS = [
  { suffix: '1', subtitle: 'Scene' },
  { suffix: '2', subtitle: 'Detail' },
];

function hashToHues(slug) {
  const bytes = createHash('sha1').update(slug).digest();
  const hue1 = bytes[0] % 360;
  const hue2 = (hue1 + 40 + (bytes[1] % 60)) % 360;
  return { hue1, hue2 };
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTitle(title) {
  if (title.length <= 22) return [title];
  const mid = Math.floor(title.length / 2);
  const before = title.lastIndexOf(' ', mid);
  const after = title.indexOf(' ', mid);
  let splitAt;
  if (before === -1 && after === -1) return [title];
  if (before === -1) splitAt = after;
  else if (after === -1) splitAt = before;
  else splitAt = mid - before <= after - mid ? before : after;
  return [title.slice(0, splitAt).trim(), title.slice(splitAt + 1).trim()];
}

/**
 * Build a deterministic 320×160 scroll banner for a quest variant.
 * `variantIndex` nudges the hue so the quest's two images look distinct.
 */
function questBannerSvg(slug, name, subtitle, variantIndex) {
  const { hue1, hue2 } = hashToHues(slug);
  const h1 = (hue1 + variantIndex * 25) % 360;
  const h2 = (hue2 + variantIndex * 25) % 360;
  const W = 320;
  const H = 160;

  const bg1 = `hsl(${h1} 35% 14%)`;
  const bg2 = `hsl(${h2} 28% 20%)`;
  const accent = `hsl(${h1} 60% 65%)`;
  const accentDim = `hsl(${h1} 35% 40%)`;
  const gradId = `g${slug.replace(/[^a-z0-9]/g, '')}${variantIndex}`;

  // Scroll glyph — left side (a rolled parchment rendered as two arcs + body).
  const cx = 60;
  const cy = H / 2;

  const lines = wrapTitle(name);
  const titleX = 116;
  const titleAreaWidth = W - titleX - 16;

  let titleSvg = '';
  if (lines.length === 1) {
    titleSvg = `<text x="${titleX}" y="${H / 2 - 2}" font-family="Georgia, 'Times New Roman', serif" font-size="20" font-weight="bold" fill="white">${escapeXml(lines[0])}</text>`;
  } else {
    titleSvg =
      `<text x="${titleX}" y="${H / 2 - 16}" font-family="Georgia, 'Times New Roman', serif" font-size="18" font-weight="bold" fill="white">${escapeXml(lines[0])}</text>` +
      `<text x="${titleX}" y="${H / 2 + 8}" font-family="Georgia, 'Times New Roman', serif" font-size="18" font-weight="bold" fill="white">${escapeXml(lines[1])}</text>`;
  }
  const subY = lines.length === 1 ? H / 2 + 22 : H / 2 + 34;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${gradId})"/>
  <line x1="8" y1="8" x2="28" y2="8" stroke="${accentDim}" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="8" y1="8" x2="8" y2="28" stroke="${accentDim}" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="${W - 8}" y1="${H - 8}" x2="${W - 28}" y2="${H - 8}" stroke="${accentDim}" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="${W - 8}" y1="${H - 8}" x2="${W - 8}" y2="${H - 28}" stroke="${accentDim}" stroke-width="1.5" stroke-linecap="round"/>
  <rect x="${cx - 24}" y="${cy - 32}" width="48" height="64" rx="6" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-width="2"/>
  <ellipse cx="${cx}" cy="${cy - 32}" rx="24" ry="6" fill="${accent}" fill-opacity="0.25" stroke="${accent}" stroke-width="1.5"/>
  <ellipse cx="${cx}" cy="${cy + 32}" rx="24" ry="6" fill="${accent}" fill-opacity="0.25" stroke="${accent}" stroke-width="1.5"/>
  <line x1="${cx - 14}" y1="${cy - 12}" x2="${cx + 14}" y2="${cy - 12}" stroke="${accent}" stroke-width="1.5" stroke-opacity="0.7"/>
  <line x1="${cx - 14}" y1="${cy}" x2="${cx + 14}" y2="${cy}" stroke="${accent}" stroke-width="1.5" stroke-opacity="0.7"/>
  <line x1="${cx - 14}" y1="${cy + 12}" x2="${cx + 14}" y2="${cy + 12}" stroke="${accent}" stroke-width="1.5" stroke-opacity="0.7"/>
  <line x1="108" y1="28" x2="108" y2="${H - 28}" stroke="${accentDim}" stroke-width="1" stroke-dasharray="3,3"/>
  ${titleSvg}
  <line x1="${titleX}" y1="${subY - 14}" x2="${titleX + titleAreaWidth}" y2="${subY - 14}" stroke="${accent}" stroke-width="1" stroke-opacity="0.5"/>
  <text x="${titleX}" y="${subY}" font-family="sans-serif" font-size="11" fill="${accent}" fill-opacity="0.85" letter-spacing="1.5">${escapeXml(subtitle.toUpperCase())}</text>
</svg>`;
}

function renderPng(svg) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: 320 } }).render().asPng();
}

async function main() {
  loadEnv();
  if (process.env.NODE_ENV === 'production' || /prod/i.test(process.env.MONGODB_URI ?? '')) {
    console.error('Refusing to run against a production-looking environment.');
    process.exit(1);
  }

  const outDir = join(REPO_ROOT, 'public', 'uploads', 'quests');
  mkdirSync(outDir, { recursive: true });

  // When the CDN is configured, mirror every image into R2 (the deployed dev
  // app can't serve local public/uploads/ writes).
  let cdn = null;
  const env = r2Env();
  if (env) {
    const s3 = r2ClientFor(env);
    cdn = {
      s3,
      bucket: env.R2_BUCKET,
      existingKeys: await listExistingKeys(s3, env.R2_BUCKET, 'uploads/quests/'),
    };
    console.log(`CDN configured — uploading quest images to R2 bucket '${env.R2_BUCKET}'`);
  }

  let count = 0;
  let uploaded = 0;
  const uploads = [];
  for (const { slug, name } of QUESTS) {
    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      const variantSlug = `${slug}-${v.suffix}`;
      const png = renderPng(questBannerSvg(slug, name, v.subtitle, i));
      writeFileSync(join(outDir, `${variantSlug}.png`), png);
      count += 1;
      if (cdn) {
        const objKey = `uploads/quests/${variantSlug}.png`;
        if (!cdn.existingKeys.has(objKey)) {
          uploads.push(
            cdn.s3
              .send(
                new PutObjectCommand({
                  Bucket: cdn.bucket,
                  Key: objKey,
                  Body: png,
                  ContentType: 'image/png',
                })
              )
              .then(() => {
                uploaded += 1;
              })
          );
        }
      }
    }
  }
  await Promise.all(uploads);

  console.log(
    `\ngen_seed_quest_images: ${count} PNGs generated in public/uploads/quests/` +
      (cdn ? `, ${uploaded} uploaded to R2` : '')
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
