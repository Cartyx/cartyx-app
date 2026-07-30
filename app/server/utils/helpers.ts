import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveEnvironment } from '../db/policy';

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () =>
    Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${part()}-${part()}`;
}

export function providerConfigured(provider: string): boolean {
  // All providers need BASE_URL for redirect_uri
  if (!process.env.BASE_URL) return false;

  switch (provider) {
    case 'google':
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    case 'github':
      return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    case 'apple': {
      if (!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID))
        return false;
      const keyPath = process.env.APPLE_PRIVATE_KEY_PATH;
      if (!keyPath) return false;
      try {
        fs.accessSync(keyPath, fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export function validateUrl(value: string | undefined | null): string | null | false {
  if (!value || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.toString();
  } catch {
    return false;
  }
}

export function parseMaxPlayers(value: string | number | undefined): number {
  const n = parseInt(String(value ?? '4'), 10);
  if (isNaN(n) || n < 1) return 1;
  if (n > 10) return 10;
  return n;
}

/**
 * Maximum base64-encoded image payload size.
 * Used for the server-side base64 upload path, which is primarily a local-dev and
 * fallback mechanism. In the normal production flow, images upload directly from
 * the browser to R2 via presigned URLs (see app/server/functions/uploads.ts).
 */
export { MAX_IMAGE_BASE64_LENGTH } from '~/types/schemas/campaigns';

/**
 * Normalize a single tag for persistence:
 * trim whitespace, lowercase, strip leading '#', trim again, reject empty results.
 * Returns `null` for tags that normalize to an empty string.
 */
export function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^#/, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Escape a string for safe interpolation into a RegExp / Mongo $regex.
 * Without this, caller-controlled search text could contain a
 * catastrophic-backtracking pattern (e.g. "(a+)+$") that gets evaluated
 * against every matching document.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize an array of tags, removing duplicates and invalid entries.
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

/**
 * Saves an uploaded image file to R2 (when CDN_URL/R2 are configured) or local disk
 * (when running without CDN_URL/R2, e.g. local dev).
 *
 * This is used by the server-side base64 upload path. In the typical production
 * configuration, images are uploaded directly from the browser to R2 via presigned
 * URLs, but this function may still be invoked as a fallback when the client sends
 * an image payload as base64.
 */
export async function saveUploadedFile(file: File, subdir: string): Promise<string> {
  const ALLOWED = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/gif', '.gif'],
    ['image/webp', '.webp'],
  ]);
  const ext = ALLOWED.get(file.type);
  if (!ext) throw new Error('Only PNG, JPEG, GIF, and WebP images are allowed');
  if (file.size > 3 * 1024 * 1024) throw new Error('Image must be under 3MB');

  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

  const cdnUrl = process.env.CDN_URL;
  if (!cdnUrl) {
    // Fail fast outside local dev: container/pod filesystems are ephemeral
    // (and read-only once the production chart hardens them) — uploads must go to R2.
    if (resolveEnvironment() !== 'development') {
      throw new Error('CDN_URL environment variable is required for image uploads in production');
    }
    // Dev/local and self-hosted fallback: write to disk
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = path.join(process.cwd(), 'public', subdir);
    await mkdir(dir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, filename), buffer);
    return `/${subdir}/${filename}`;
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'R2 configuration incomplete: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are all required when CDN_URL is set'
    );
  }

  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${subdir}/${filename}`,
      Body: buffer,
      ContentType: file.type,
    })
  );

  const normalizedCdnUrl = cdnUrl.replace(/\/+$/, '');
  return `${normalizedCdnUrl}/${subdir}/${filename}`;
}
