import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { logger } from './logger.js';
import { probe, analyze, transcode, RENDITION_SAMPLE_RATE } from './ffmpeg.js';
import { extractPeaks } from './peaks.js';
import { MAX_ATTEMPTS, computeBackoffMs } from './claim.js';
import { renditionKeyBase } from './keys.js';
import { PermanentError, PermanentSizeError } from './errors.js';
import { maxSourceBytes, readS3Timeouts } from './config.js';
import { beat } from './heartbeat.js';
import { captureException } from './telemetry.js';

const PEAK_BUCKETS = 400;

/**
 * Hard cap on source length: 30 minutes (the human partner's number).
 *
 * This bounds a decode-amplification DoS. `AUDIO_MAX_BYTES` is 50 MB, and 50 MB
 * of minimum-bitrate audio decodes to ~13.9 hours — each attempt pins the
 * single worker's CPU while every other user's upload queues behind it.
 * Rejecting by *duration* rather than by bytes is what closes it, because bytes
 * say nothing about decode cost.
 *
 * Decided on the MEASURED decoded length and on nothing else. There is no
 * header pre-gate: `probe()`'s duration is an extrapolation for any MP3 without
 * a Xing header and over-reports by up to 8.2x on files measured here, so a
 * 30-minute gate on it rejects honest uploads (an honest 17-minute file
 * measured a 41.8-minute claim). What made a header gate look necessary was the
 * cost of the decode, and `analyze(src, limitSeconds)` removes that cost
 * instead: the pass is bounded to `MAX_SOURCE_DURATION_MS` + 1 s of audio, so a
 * 13.9-hour source is answered in 0.93 s rather than 24.16 s (measured) and the
 * answer is a fact rather than a claim. See `analyze` in ffmpeg.ts.
 */
export const MAX_SOURCE_DURATION_MS = 30 * 60 * 1000;

/**
 * What the bounded decode reads: one second past the cap, so a source exactly
 * at the cap measures exactly at the cap and anything longer measures over it.
 */
export const DECODE_LIMIT_SECONDS = MAX_SOURCE_DURATION_MS / 1000 + 1;

/**
 * How far a rendition may fall short of the source's DECODED length before we
 * call the transcode incomplete: a flat 500 ms.
 *
 * Flat, with no proportional term, because both sides are now measurements of
 * the same audio and the only difference between them is fixed encoder/container
 * padding — which does not scale with duration. Measured across WAV, MP3, FLAC,
 * Matroska/Opus, M4A and ADTS AAC sources, in both rendition codecs, the
 * rendition came out LONGER than the decoded source in every case but two, and
 * the largest shortfall anywhere was 0.6 ms (ADTS AAC -> aac). 500 ms is ~800x
 * that worst benign case.
 *
 * The predecessor of this function compared against `probe()`'s HEADER duration
 * with a 25% proportional tolerance, and that was a ship-stopper: the header is
 * an extrapolation for a VBR MP3 with no Xing header, a 1-second quiet intro
 * over-reports a 60 s file as 145 s (measured), and 25% does not cover a 143%
 * error — so ordinary music was permanently rejected as "truncated" with no way
 * back. A tolerance can only ever be as trustworthy as the number it is a
 * tolerance on.
 *
 * The check is still ONE-SIDED: padding can only make a rendition longer.
 */
export const MAX_RENDITION_SHORTFALL_MS = 500;

/** Duration in whole minutes for a `lastError` a human reads, e.g. "47 minutes". */
function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Everything that can only be known by decoding, and the derived durations.
 *
 * All three rejections are PERMANENT: no rerun of the same bytes produces a
 * different answer, so they must not consume the retry budget or be reachable
 * from the Retry button.
 */
export function assertDecodedUsable(decoded: { samples: number; peakDb: number }): {
  durationMs: number;
  durationSamples: number;
} {
  if (decoded.samples === 0) {
    // A 44-byte WAV with a valid `fmt ` chunk and an empty `data` chunk probes
    // as a legitimate 48 kHz stereo stream and transcodes without error into
    // two header-only renditions — a `ready` asset that plays nothing.
    throw new PermanentError('Audio file contains no audio samples');
  }
  if (decoded.peakDb === Number.NEGATIVE_INFINITY) {
    // Digital silence end to end. loudnorm divides by the measured level and
    // emits NaN/±Inf, which kills the aac encoder outright (exit 234) — so
    // without this the asset burns its whole retry budget and lands on
    // `Command failed: ffmpeg -v error -i /tmp/...`. Leading and trailing
    // silence are unaffected; only a wholly-silent file gets here.
    throw new PermanentError('Audio file is completely silent');
  }

  const durationSamples = decoded.samples;
  const durationMs = Math.round((durationSamples / RENDITION_SAMPLE_RATE) * 1000);
  // The duration cap, and the ONLY place it is applied. `decoded.samples` came
  // from a decode bounded at `DECODE_LIMIT_SECONDS`, so a source of any length
  // reports at most one second over the cap here — enough to fail it, and
  // cheap enough that no header pre-gate is needed to afford asking.
  if (durationMs > MAX_SOURCE_DURATION_MS) {
    throw new PermanentError(
      `Audio is ${formatMinutes(durationMs)} long, over the ${MAX_SOURCE_DURATION_MS / 60_000} minute limit`
    );
  }
  return { durationMs, durationSamples };
}

/**
 * Guards the TRANSCODE, by comparing each rendition against the length the
 * source really decoded to.
 *
 * Both numbers are measurements of the same audio, so a gap between them means
 * this worker's own ffmpeg leg dropped content while still exiting 0 — a
 * partially written output, a full disk, a muxer that gave up mid-file. That is
 * the failure a `ready` asset must never be published with, because the row
 * would then carry a `durationSamples` phase 2 loops on that the rendition
 * cannot honour.
 *
 * NOTE what this deliberately no longer does: it does not detect a truncated
 * SOURCE. It cannot. Detecting that means trusting the container header, and
 * for the format truncation is most common in — MP3 — the header duration is an
 * extrapolation that over-reports honest files by up to 8.2x (measured). The
 * harm A10 actually described was a `ready` row whose recorded duration came
 * from that header while its audio did not; that is closed at the source, by
 * `durationMs`/`durationSamples` both coming from `analyze()`. A half-
 * transferred MP3 now publishes as a shorter asset with an honest duration,
 * which the owner can see and re-upload, rather than as a permanent rejection
 * that ordinary music also trips.
 */
export function assertRenditionComplete(
  decodedMs: number,
  renditionMs: number,
  codec: string
): void {
  if (decodedMs - renditionMs > MAX_RENDITION_SHORTFALL_MS) {
    throw new PermanentError(
      `The ${codec} rendition is incomplete: the source decodes to ${decodedMs} ms but the rendition contains only ${renditionMs} ms`
    );
  }
}

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
      // The AWS SDK's Node handler has NO request timeout by default, which
      // made these R2 calls the only unbounded awaits left in the worker —
      // every child process is already capped by `childProcOptions`. A
      // half-open socket to R2 hangs `processAsset` forever, which hangs the
      // single sequential loop, and `reapStale` runs INSIDE that loop: the row
      // stays `processing` with nothing able to rescue it, every later upload
      // queues behind it, and (before the heartbeat probe) nothing restarted
      // the pod either. Passed as plain options rather than a constructed
      // NodeHttpHandler so no new dependency is needed — the SDK feeds this
      // object straight to `NodeHttpHandler.create`.
      requestHandler: readS3Timeouts(),
    }),
    bucket,
    cdnUrl: cdnUrl.replace(/\/+$/, ''),
  };
}

/**
 * Streams the source object to `dest`, refusing anything over `maxBytes`.
 *
 * This is the enforcement point for the size cap, and it has to exist here
 * even though `confirmAudioUpload` already HeadObjects the same object:
 *
 * - The presigned PUT is valid for 300 s and is REUSABLE, and nothing
 *   invalidates it once confirm succeeds. PUT 1 KB, let confirm pass and stamp
 *   `confirmedAt`, then re-PUT gigabytes to the same URL. Confirm measured a
 *   file that no longer exists.
 * - The consequence used to be an OOMKill, not a failed asset:
 *   `transformToByteArray()` materialised the whole object in a pod limited to
 *   768Mi. The row stuck in `processing`, the reaper requeued it, it OOMed
 *   again, and after three passes `failed` — from which the Retry button
 *   accepted it, because `confirmedAt` really was set. At `replicaCount: 1`
 *   every one of those OOMs stalls every other user's queue.
 *
 * Both halves matter. `ContentLength` is refused before a byte is read, so an
 * honest oversized object costs nothing. The streamed counter then re-checks
 * against what actually arrives, because `ContentLength` is a claim from the
 * same place the bytes come from and an absent or understated one must not be
 * a way through. And streaming to disk rather than into a Buffer means even an
 * accepted 50 MB source never sits in RSS at all.
 *
 * Oversize is PERMANENT: the object is not going to shrink, so retrying is
 * guaranteed waste and Retry must not buy another pass either.
 *
 * And the oversized object is DELETED, which is the other half of closing the
 * same hole. Refusing to read it stops the OOM but leaves gigabytes sitting in
 * R2 attached to a `failed` row — a row the owner-scoped cleanup correctly
 * reads as in-use, so nothing but the uploading account can ever reclaim it.
 * `AUDIO_MAX_BYTES` would then be enforced on what the worker *reads* and on
 * nothing at all that is *stored*. The delete is scoped to the size rejection
 * alone; see `PermanentSizeError` for why no other rejection deletes.
 */
async function downloadSource(
  client: S3Client,
  bucket: string,
  key: string,
  dest: string,
  maxBytes: number
): Promise<void> {
  const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) {
    throw new Error(`R2 object body missing for key ${key}`);
  }

  const body = obj.Body as unknown as Readable & { destroy?: () => void };

  /**
   * Best effort, and it must stay that way: an R2 outage during the delete must
   * still leave the caller with the size rejection it asked for, not a generic
   * transient error that spends the retry budget re-downloading a file already
   * known to be too big.
   */
  const dropObject = async (): Promise<void> => {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      logger.warn({ key, maxBytes }, 'deleted an oversized source object');
    } catch (err) {
      logger.warn({ err, key }, 'failed to delete an oversized source object');
      captureException(err, { sourceKey: key, scope: 'oversize-cleanup' });
    }
  };

  if (typeof obj.ContentLength === 'number' && obj.ContentLength > maxBytes) {
    // Release the socket rather than leaving the response half-read.
    body.destroy?.();
    await dropObject();
    throw new PermanentSizeError(
      `Audio file is ${obj.ContentLength} bytes, over the ${maxBytes} byte limit`
    );
  }

  let received = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > maxBytes) {
        done(new PermanentSizeError(`Audio file exceeds the ${maxBytes} byte limit`));
        return;
      }
      // A 50 MB source over a slow link can legitimately outlast
      // `HEARTBEAT_MAX_AGE_MS` while making steady progress — the S3 request
      // timeout is socket INACTIVITY, so a trickling transfer never trips it.
      // Beating per chunk is a ~13-byte tmpfs write against a 64 KiB chunk.
      beat();
      done(null, chunk);
    },
  });

  try {
    await pipeline(body, cap, createWriteStream(dest));
  } catch (err) {
    if (err instanceof PermanentSizeError) await dropObject();
    throw err;
  }
}

/**
 * Deletes a BATCH of R2 objects. Used by the reaper for sources abandoned
 * mid-upload (see `reapStale`) — the worker is the only process in the system
 * that both holds R2 credentials and knows a row was abandoned.
 *
 * `DeleteObjects` rather than N x `DeleteObject`: it takes up to 1000 keys per
 * request (the caller chunks to that), which is what turns a backlog of ten
 * thousand abandoned rows from ten thousand sequential round trips — long
 * enough to stale the heartbeat and get the pod killed mid-reap — into ten.
 *
 * `Quiet: true` because a key that is already gone is not a failure worth
 * hearing about; the response then carries only the keys that genuinely could
 * not be deleted, which are logged by the caller.
 *
 * The client is built lazily and reused: `r2()` throws when R2 env vars are
 * missing, and that must surface as one caught, logged reap failure rather
 * than as a crash at worker startup.
 */
export function makeSourceDeleter(): (keys: string[]) => Promise<void> {
  let cached: { client: S3Client; bucket: string } | null = null;
  return async (keys: string[]) => {
    if (keys.length === 0) return;
    if (!cached) {
      const { client, bucket } = r2();
      cached = { client, bucket };
    }
    const result = await cached.client.send(
      new DeleteObjectsCommand({
        Bucket: cached.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      })
    );
    if (result.Errors?.length) {
      logger.warn(
        { count: result.Errors.length, first: result.Errors[0]?.Key },
        'R2 refused to delete some abandoned upload objects'
      );
    }
  };
}

export type Model = {
  updateOne: (f: unknown, u: unknown) => Promise<{ matchedCount?: number }>;
};

/**
 * Every terminal write goes through here, and every one of them is FENCED on
 * the claim this worker holds.
 *
 * `claimNext` stamps `claimedBy` precisely so ownership can be proven, and
 * until now nothing ever read it back: all three writes filtered on `{ _id }`
 * alone. That makes the reaper's revocation cosmetic. Once `reapStale` decides
 * a claim is stale it hands the row to a second worker, and the FIRST worker —
 * still alive, still transcoding — then writes its own result over the second
 * worker's in-flight row: `status: 'ready'` with renditions the second worker
 * is concurrently overwriting, or `failed` on a row that is now legitimately
 * `processing` elsewhere. Fencing on `claimedBy` + `status: 'processing'` makes
 * a revoked worker's write a no-op instead.
 *
 * A no-op is LOGGED and reported rather than swallowed: it means the reaper
 * revoked a live claim, i.e. `CLAIM_TIMEOUT_MS` is set below real worst-case
 * processing time (see `DEFAULT_CLAIM_TIMEOUT_MS`). That is a config bug worth
 * seeing, and silence is how it stays unfixed.
 *
 * `matchedCount === 0` specifically, not falsy: the raw driver always returns
 * the field, and treating `undefined` as "lost" would make every mock and any
 * future driver that omits it log a false alarm.
 */
async function fencedWrite(
  model: Model,
  id: unknown,
  workerId: string,
  set: Record<string, unknown>,
  transition: string
): Promise<void> {
  const result = await model.updateOne(
    { _id: id, status: 'processing', claimedBy: workerId },
    { $set: set }
  );
  if (result?.matchedCount === 0) {
    logger.warn(
      { assetId: String(id), workerId, transition },
      'lost claim before writing result — the reaper revoked a live claim'
    );
    captureException(new Error(`Lost claim on audio asset before writing ${transition}`), {
      assetId: String(id),
      workerId,
      transition,
    });
  }
}

/**
 * Terminal failure: nothing about retrying *now* would help. Clears the claim
 * so the row stops showing as in-flight.
 *
 * `permanent` is the stronger statement, and it is persisted rather than
 * inferred: it means the SOURCE is unusable, so no future run — including one
 * a human starts by clicking Retry — can ever succeed. `retryAudioAsset`
 * refuses rows carrying it. A row that merely exhausted `MAX_ATTEMPTS` against
 * an R2 blip is NOT permanent and stays retryable, which is the whole point of
 * keeping the two apart.
 */
async function markFailed(
  model: Model,
  id: unknown,
  workerId: string,
  message: string,
  permanent = false
): Promise<void> {
  await fencedWrite(
    model,
    id,
    workerId,
    {
      status: 'failed',
      lastError: message,
      permanentFailure: permanent,
      claimedAt: null,
      claimedBy: null,
      updatedAt: new Date(),
    },
    'failed'
  );
}

/**
 * Return a claimed row to `pending` so a later `claimNext` picks it back up,
 * after `computeBackoffMs(attempts)` has elapsed. `lastError` is still recorded
 * so the reason for the retry stays visible. Only valid under the attempt cap —
 * callers must check `attempts < MAX_ATTEMPTS` first; this function doesn't
 * re-check.
 *
 * `nextAttemptAt` is non-negotiable here: the requeued row keeps its original
 * `createdAt` and claimNext sorts `{ createdAt: 1 }`, so without a future
 * timestamp it is still the oldest pending doc and gets re-claimed on the very
 * next loop iteration — the whole retry budget spent in milliseconds against a
 * fault that hasn't had time to clear.
 */
async function requeueForRetry(
  model: Model,
  id: unknown,
  workerId: string,
  message: string,
  attempts: number
): Promise<void> {
  const now = new Date();
  await fencedWrite(
    model,
    id,
    workerId,
    {
      status: 'pending',
      lastError: message,
      claimedAt: null,
      claimedBy: null,
      nextAttemptAt: new Date(now.getTime() + computeBackoffMs(attempts)),
      updatedAt: now,
    },
    'pending'
  );
}

export async function processAsset(
  model: Model,
  asset: { _id: unknown; sourceKey?: string; attempts?: number },
  workerId: string
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
    await markFailed(model, id, workerId, 'Asset has no sourceKey', true);
    return;
  }
  const sourceKey = asset.sourceKey;

  // Renditions go BESIDE their source, inside the owner's storage namespace
  // (`uploads/audio/<prefix>/renditions/<id>.<ext>`), which is derived from the
  // source key — see src/keys.ts. A source key that predates that layout gives
  // us nowhere safe to put them: writing to the old shared
  // `uploads/audio/renditions/` root would put objects outside every user's
  // listing prefix, where the app's cleanup cannot see them and no owner can
  // ever reclaim them. Permanent, not retryable — the source key is fixed, so
  // a second attempt lands in exactly the same place.
  const renditionBase = renditionKeyBase(sourceKey, String(id));
  if (!renditionBase) {
    logger.error({ assetId: String(id), sourceKey }, 'source key is not in the per-owner layout');
    await markFailed(
      model,
      id,
      workerId,
      'Source key predates the per-owner storage layout; re-upload this file',
      true
    );
    return;
  }

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
    await downloadSource(client, bucket, sourceKey, src, maxSourceBytes());
    // EVERY child process and every R2 call is followed by a beat, and
    // `downloadSource` beats as bytes arrive. The liveness probe reads loop
    // PROGRESS, and a single asset can legitimately occupy the loop for tens of
    // minutes, so a heartbeat written only between assets would need a
    // threshold too generous to catch anything. The placement is not
    // decorative: `HEARTBEAT_MAX_AGE_MS` is justified as 2x the longest
    // single stage, so a stage boundary without a beat silently makes that
    // arithmetic wrong and lets the probe kill a healthy worker. See
    // `DEFAULT_HEARTBEAT_MAX_AGE_MS` in config.ts.
    beat();

    // Provenance only — sample rate and channel count. `meta.durationMs` is a
    // header claim that nothing is allowed to reject on; see `probe`.
    const meta = await probe(src);
    beat();

    // The one decode pass, bounded at `DECODE_LIMIT_SECONDS`. Everything that
    // needs to know what the file really contains — as opposed to what its
    // header asserts — comes from here, so this runs once and only once.
    const { durationMs, durationSamples } = assertDecodedUsable(
      await analyze(src, DECODE_LIMIT_SECONDS)
    );
    beat();

    if (meta.durationMs > 0 && Math.abs(meta.durationMs - durationMs) > 1000) {
      // Not a failure, and deliberately not telemetry: for a VBR MP3 with no
      // Xing header a large gap here is the NORM, not a fault. Logged because
      // when someone is looking at an asset whose length surprises them, the
      // two numbers side by side are the whole answer.
      logger.info(
        { assetId: String(id), headerMs: meta.durationMs, decodedMs: durationMs },
        'container duration disagrees with the decoded length; using the decoded length'
      );
    }

    const opusPath = join(dir, 'out.opus');
    const aacPath = join(dir, 'out.m4a');
    await transcode(src, opusPath, 'opus');
    beat();
    await transcode(src, aacPath, 'aac');
    beat();

    for (const [codec, path] of [
      ['opus', opusPath],
      ['aac', aacPath],
    ] as const) {
      const renditionMs = (await probe(path)).durationMs;
      beat();
      // Against `durationMs` — the MEASURED decode — never against
      // `meta.durationMs`. See `assertRenditionComplete`.
      assertRenditionComplete(durationMs, renditionMs, codec);
    }

    // Peaks describe the OPUS RENDITION, not the source. The user hears the
    // loudnorm'd rendition, and the waveform is the only visual affordance for
    // picking a sound mid-session — a waveform of the pre-normalization source
    // describes a file nobody ever plays. Measured: a -69 dBFS source that
    // plays back at 0.79 full-scale after normalization rendered from the
    // source as a peak of 0.00006, i.e. a flat line, so the loudest asset in
    // the library looked like silence.
    //
    // Opus rather than AAC because it round-trips the length exactly (measured
    // 16 000 samples at the 8 kHz peak-decode rate, against 16 043 for the
    // M4A, whose encoder delay/padding shifts every bucket).
    const peaks = await extractPeaks(opusPath, PEAK_BUCKETS);
    beat();

    // This key format is a CONTRACT, not an implementation detail. Both
    // renditions must land under the OWNER'S storage prefix, because that
    // prefix is the entire basis of the app's owner-scoped cleanup
    // (app/server/functions/audio-cleanup.ts): it lists
    // `uploads/audio/<prefix>/` and treats anything no row references as
    // reclaimable. An object written outside the prefix appears in no user's
    // listing, so a rendition this worker PUT but never managed to record —
    // the window between these PutObjects and the fencedWrite below — would be
    // stranded forever. `renditionBase` is derived from the source key above
    // precisely so the two cannot end up in different namespaces.
    const base = renditionBase;
    const renditions: Record<string, { key: string; url: string; bytes: number }> = {};

    for (const [codec, path, ext, type] of [
      ['opus', opusPath, 'opus', 'audio/ogg'],
      ['aac', aacPath, 'm4a', 'audio/mp4'],
    ] as const) {
      // Renditions stay `readFile`d whole while the SOURCE is streamed, and the
      // asymmetry is deliberate. A source is attacker-controlled and unbounded
      // (that is the whole TOCTOU hole above); a rendition is something this
      // worker just produced at a fixed bitrate from an input already capped at
      // MAX_SOURCE_DURATION_MS — 1800 s x 128 kbit/s is ~28.8 MB, measured at
      // 27.8 MB for a real 30-minute AAC leg — read one at a time. Streaming
      // them would also make the PUT body non-replayable, turning the SDK's
      // internal retry of a transient R2 blip into a hard failure.
      const body = await readFile(path);
      const key = `${base}.${ext}`;
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type })
      );
      renditions[codec] = { key, url: `${cdnUrl}/${key}`, bytes: body.length };
      beat();
    }

    await fencedWrite(
      model,
      id,
      workerId,
      {
        status: 'ready',
        // Both durations describe the DECODED content, so they can never
        // disagree with each other. `durationSamples` is the one phase 2's
        // gapless looping reads: `durationMs` is rounded to whole
        // milliseconds, which at 48 kHz is 48 samples of slop on every
        // asset before any format-specific error, and the container's own
        // duration adds more (+312 samples for Ogg/Opus, +1440 for ADTS
        // AAC, measured). `durationMs` stays for display.
        durationMs,
        durationSamples,
        // The SOURCE's rate and channel count, kept as provenance. The
        // renditions are always 48 kHz stereo (see RENDITION_SAMPLE_RATE),
        // and `durationSamples` is expressed at that rate, not at this one.
        sampleRate: meta.sampleRate,
        channels: meta.channels,
        // The loudnorm TARGET (`I=-20` — see LOUDNORM in ffmpeg.ts), which
        // is exactly what the field name now says. Single-pass loudnorm
        // does not guarantee the output lands on exactly -20 LUFS; a real
        // measurement needs the two-pass workflow (analyze, then re-encode
        // with the measured input_i/input_tp/input_lra/target_offset), and
        // that is out of scope here. The value is still worth recording:
        // if the canonical target ever changes, phase 2's gain logic needs
        // to know which target each asset in a mixed-vintage library was
        // normalized against. A measured value, when it lands, belongs in a
        // separate `loudnessLufs` field alongside this one.
        loudnessTargetLufs: -20,
        peaks,
        renditions,
        lastError: null,
        permanentFailure: false,
        claimedAt: null,
        claimedBy: null,
        updatedAt: new Date(),
      },
      'ready'
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
    // Also to GlitchTip: a pino line on a pod nobody tails is not error
    // reporting, and this worker fails in exactly the ways (bad sources, R2
    // faults) that only show up in production. Never awaited — see telemetry.ts.
    captureException(err, {
      assetId: String(id),
      workerId,
      attempts,
      sourceKey,
      permanent: err instanceof PermanentError,
    });

    // The one exception to the paragraph above, and the reason it is an
    // exception: a PermanentError is thrown only by a validation step that
    // already *knows* the source is unusable — it is not a guess made by
    // pattern-matching an ffmpeg exit code. Retrying it is guaranteed waste,
    // so it skips the budget entirely and is stamped as un-retryable so a
    // human clicking Retry can't buy another pass either. See errors.ts.
    if (err instanceof PermanentError) {
      await markFailed(model, id, workerId, message, true);
      return;
    }

    if (attempts < MAX_ATTEMPTS) {
      await requeueForRetry(model, id, workerId, message, attempts);
    } else {
      await markFailed(model, id, workerId, message);
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
