import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from './logger.js';
import { probe, transcode } from './ffmpeg.js';
import { extractPeaks } from './peaks.js';
import { MAX_ATTEMPTS } from './claim.js';

const PEAK_BUCKETS = 400;

/** Thrown by `r2()` when required R2 env vars are absent, named so it reads
 * clearly in logs/lastError instead of surfacing as an opaque AWS SDK
 * validation error from a client built with empty-string credentials. */
class R2ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R2ConfigError';
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new R2ConfigError(`Missing required R2 environment variable: ${name}`);
  }
  return value;
}

function r2(): { client: S3Client; bucket: string; cdnUrl: string } {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const bucket = requireEnv('R2_BUCKET');
  const cdnUrl = requireEnv('CDN_URL');

  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    cdnUrl: cdnUrl.replace(/\/+$/, ''),
  };
}

export type Model = {
  updateOne: (f: unknown, u: unknown) => Promise<unknown>;
};

/** Permanent failure: nothing about retrying would help (bad row, exhausted
 * attempts). Clears the claim so the row stops showing as in-flight. */
async function markFailed(model: Model, id: unknown, message: string): Promise<void> {
  await model.updateOne(
    { _id: id },
    { $set: { status: 'failed', lastError: message, claimedAt: null, claimedBy: null } }
  );
}

/**
 * Return a claimed row to `pending` so the next `claimNext` picks it back up.
 * `lastError` is still recorded so the reason for the retry stays visible.
 * Only valid under the attempt cap — callers must check `attempts <
 * MAX_ATTEMPTS` first; this function doesn't re-check.
 */
async function requeueForRetry(model: Model, id: unknown, message: string): Promise<void> {
  await model.updateOne(
    { _id: id },
    {
      $set: {
        status: 'pending',
        lastError: message,
        claimedAt: null,
        claimedBy: null,
        updatedAt: new Date(),
      },
    }
  );
}

export async function processAsset(
  model: Model,
  asset: { _id: unknown; sourceKey?: string; attempts?: number }
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
  //
  // This is a permanent condition — no amount of retrying fixes a row with
  // no sourceKey — so it goes straight to `failed` rather than through the
  // retry path below, and it does so before any temp dir or R2 client is
  // created.
  if (!asset.sourceKey) {
    logger.error({ assetId: String(id) }, 'asset has no sourceKey, cannot transcode');
    await markFailed(model, id, 'Asset has no sourceKey');
    return;
  }
  const sourceKey = asset.sourceKey;

  let dir: string | undefined;

  try {
    dir = await mkdtemp(join(tmpdir(), 'cartyx-audio-'));
    // r2() throws R2ConfigError if any required env var is absent. It used
    // to be called outside this try block; moved inside so a misconfigured
    // environment goes through the same catch/retry/fail handling as any
    // other failure (and so `dir` still gets cleaned up in `finally`)
    // instead of propagating uncaught to index.ts's loop — which would
    // leave the row stuck in `processing` until reapStale's timeout, and
    // leak the temp dir.
    const { client, bucket, cdnUrl } = r2();

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
    // Every caught error here — a corrupt/unsupported source ffmpeg can
    // never decode, an R2 timeout, a momentary network blip, a missing R2
    // env var — is retried up to MAX_ATTEMPTS, then failed. No matching on
    // ffmpeg exit codes or AWS SDK error names to tell "permanent" from
    // "transient" apart: that surface is brittle and rots silently, and a
    // corrupt file burning a few cheap attempts before failing is
    // acceptable bounded waste.
    //
    // This can't lean on reapStale() for the retry: reapStale only rescues
    // rows still stuck in `status: 'processing'` past its stale timeout —
    // i.e. a worker that died before reaching this catch. A row that *was*
    // caught here has already been moved out of `processing` (to `pending`
    // or `failed` below), so reapStale never sees it. The retry budget for
    // caught errors has to be enforced explicitly, right here, using the
    // attempt count claimNext() already stamped on this row (`$inc:
    // {attempts: 1}`, returned via `returnDocument: 'after'`) — no extra
    // read needed.
    //
    // `attempts` is expected to always be present on a row that came
    // through claimNext (Mongo's $inc creates it starting from 0 if
    // missing). If it's ever absent anyway, treat that as "at the cap" —
    // fail immediately rather than risk retrying a malformed row forever.
    const attempts = asset.attempts ?? MAX_ATTEMPTS;
    const message = err instanceof Error ? err.message : 'Transcode failed';
    logger.error({ err, assetId: String(id), attempts }, 'transcode failed');

    if (attempts < MAX_ATTEMPTS) {
      await requeueForRetry(model, id, message);
    } else {
      await markFailed(model, id, message);
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
