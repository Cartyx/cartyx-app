import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from './logger.js';
import { probe, transcode } from './ffmpeg.js';
import { extractPeaks } from './peaks.js';

const PEAK_BUCKETS = 400;

function r2() {
  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
    }),
    bucket: process.env.R2_BUCKET ?? '',
    cdnUrl: (process.env.CDN_URL ?? '').replace(/\/+$/, ''),
  };
}

type Model = {
  updateOne: (f: unknown, u: unknown) => Promise<unknown>;
};

/**
 * Mark a claimed asset failed. Used both for the "malformed row" fast path
 * (no sourceKey — see below) and the general catch-all in processAsset.
 */
async function markFailed(model: Model, id: unknown, message: string): Promise<void> {
  await model.updateOne(
    { _id: id },
    { $set: { status: 'failed', lastError: message, claimedAt: null, claimedBy: null } }
  );
}

export async function processAsset(
  model: Model,
  asset: { _id: unknown; sourceKey?: string }
): Promise<void> {
  const id = asset._id;

  // claimNext<T>() is generically typed and the worker talks to the raw
  // Mongo driver, not the mongoose model — so nothing at the type level
  // guarantees a claimed row actually has a sourceKey, only the (unenforced
  // here) schema does. A malformed row (e.g. hand-edited in the DB, or a
  // future bug upstream that inserts before the key is set) must not reach
  // GetObjectCommand with Key: undefined — the AWS SDK would throw its own
  // opaque validation error deep in the retry/middleware stack. Fail fast
  // with a message that says what's actually wrong instead.
  if (!asset.sourceKey) {
    logger.error({ assetId: String(id) }, 'asset has no sourceKey, cannot transcode');
    await markFailed(model, id, 'Asset has no sourceKey');
    return;
  }
  const sourceKey = asset.sourceKey;

  const dir = await mkdtemp(join(tmpdir(), 'cartyx-audio-'));
  const { client, bucket, cdnUrl } = r2();

  try {
    const src = join(dir, 'source');
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
    if (!obj.Body) {
      throw new Error(`R2 object body missing for key ${sourceKey}`);
    }
    await writeFile(src, Buffer.from(await obj.Body.transformToByteArray()));

    const meta = await probe(src);

    const opusPath = join(dir, 'out.opus');
    const aacPath = join(dir, 'out.m4a');
    await transcode(src, opusPath, 'opus');
    await transcode(src, aacPath, 'aac');
    const peaks = await extractPeaks(src, PEAK_BUCKETS);

    // Renditions MUST stay under uploads/audio/ — Task 8's orphan scanner
    // (app/server/functions/cleanup.ts) only walks TRACKED_PREFIXES, and a
    // key outside that prefix is invisible to it forever (never scanned,
    // never flagged as orphan, never cleaned up).
    const base = `uploads/audio/renditions/${String(id)}`;
    const renditions: Record<string, { key: string; url: string; bytes: number }> = {};

    for (const [codec, path, ext, type] of [
      ['opus', opusPath, 'opus', 'audio/ogg'],
      ['aac', aacPath, 'm4a', 'audio/mp4'],
    ] as const) {
      const body = await readFile(path);
      const key = `${base}.${ext}`;
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type })
      );
      renditions[codec] = { key, url: `${cdnUrl}/${key}`, bytes: body.length };
    }

    await model.updateOne(
      { _id: id },
      {
        $set: {
          status: 'ready',
          durationMs: meta.durationMs,
          sampleRate: meta.sampleRate,
          channels: meta.channels,
          // This is the loudnorm TARGET (`I=-20`), not a measured value.
          // Single-pass loudnorm doesn't guarantee it lands on exactly
          // -20 LUFS — a true measurement needs the two-pass loudnorm
          // workflow (analyze, then re-encode with the measured
          // input_i/input_tp/input_lra/target_offset). That's out of scope
          // here; phase 2 doesn't currently read this field for gain-riding
          // decisions, so recording the target is a defensible placeholder,
          // but it should not be read as "this asset measured -20 LUFS."
          loudnessLufs: -20,
          peaks,
          renditions,
          lastError: null,
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        },
      }
    );
    logger.info({ assetId: String(id) }, 'transcoded');
  } catch (err) {
    // NOTE: every failure here is recorded identically, regardless of
    // whether it's permanent (corrupt/unsupported source that will never
    // decode — retrying is pointless and just burns MAX_ATTEMPTS) or
    // transient (an R2 timeout, a momentary network blip — retrying would
    // likely succeed). reapStale() already returns attempts < MAX_ATTEMPTS
    // rows to `pending` for a retry, so a transient failure does get
    // another shot, but a permanent one burns through the same three
    // attempts before landing on `failed` instead of failing immediately.
    // Distinguishing ffmpeg's "Invalid data found when processing input" /
    // decode errors (permanent) from AWS SDK network/5xx errors (transient)
    // would let permanent failures skip straight to `failed` and free the
    // retry budget for genuinely transient ones. Not implemented here —
    // the brief specifies uniform `failed` handling and doing more would
    // expand this task's scope.
    const message = err instanceof Error ? err.message : 'Transcode failed';
    logger.error({ err, assetId: String(id) }, 'transcode failed');
    await markFailed(model, id, message);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
