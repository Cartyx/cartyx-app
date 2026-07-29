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
} from '@aws-sdk/client-s3';
import { logger } from './logger.js';
import { probe, analyze, transcode, RENDITION_SAMPLE_RATE } from './ffmpeg.js';
import { extractPeaks } from './peaks.js';
import { MAX_ATTEMPTS, computeBackoffMs } from './claim.js';
import { renditionKeyBase } from './keys.js';
import { PermanentError } from './errors.js';
import { maxSourceBytes, readS3Timeouts } from './config.js';
import { beat } from './heartbeat.js';
import { captureException } from './telemetry.js';

const PEAK_BUCKETS = 400;

/**
 * Hard cap on source length: 30 minutes (the human partner's number).
 *
 * This bounds a decode-amplification DoS. `AUDIO_MAX_BYTES` is 50 MB, and 50 MB
 * of minimum-bitrate audio decodes to roughly 18 hours — each attempt pins the
 * single worker's CPU for as long as `FFMPEG_TIMEOUT_MS` allows while every
 * other user's upload queues behind it. Rejecting by *duration* rather than by
 * bytes is what closes it, because bytes say nothing about decode cost.
 *
 * Checked against the cheap header probe first, so an hours-long source never
 * reaches a decoder, and again against the decoded length so a header that
 * under-reports can't smuggle one past.
 */
export const MAX_SOURCE_DURATION_MS = 30 * 60 * 1000;

/**
 * How far a rendition may fall short of the source's header duration before we
 * call the source truncated: 25% of the claimed duration, floored at 500 ms.
 *
 * Both halves are measured, not guessed:
 *
 * - The floor is sized against real encoder/container padding. Across WAV, MP3,
 *   FLAC, Ogg/Opus, M4A and ADTS AAC fixtures the largest header-vs-decoded gap
 *   was 6.5 ms (Ogg/Opus), so 500 ms is ~75x the worst benign case — no
 *   well-formed short file can trip it.
 * - The proportional term exists because a container header can be an
 *   *estimate*, not a fact: a VBR MP3 with no Xing header is extrapolated from
 *   the first frame's bitrate, measured at 28 733 ms for a genuine 30 041 ms
 *   file (4.4% low). 25% leaves ~6x headroom over that class of false positive,
 *   which matters because a false positive permanently rejects a good upload.
 *
 * The check is ONE-SIDED. Truncation can only ever make a rendition shorter
 * than the header claims; a rendition that runs *longer* is the VBR-estimate
 * case above and is benign. Measured truncations sit far outside the band: a
 * 40%-payload MP3 renders 799 ms against a claimed 2000 ms, and a 10%-payload
 * FLAC 199 ms — both marked `ready` with no error before this check existed.
 */
export function maxDurationShortfallMs(probedMs: number): number {
  return Math.max(500, probedMs * 0.25);
}

/** Duration in whole minutes for a `lastError` a human reads, e.g. "47 minutes". */
function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function assertWithinCap(ms: number): void {
  if (ms > MAX_SOURCE_DURATION_MS) {
    throw new PermanentError(
      `Audio is ${formatMinutes(ms)} long, over the ${MAX_SOURCE_DURATION_MS / 60_000} minute limit`
    );
  }
}

/**
 * The duration cap, applied to the HEADER CLAIM — cheap, and the only check
 * that runs before anything decodes. Split out from `assertDecodedUsable` on
 * purpose: an hours-long source has to be rejected without a decode pass, which
 * is the entire point of the cap.
 */
export function assertHeaderUsable(meta: { durationMs: number }): void {
  assertWithinCap(meta.durationMs);
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
  // The cap again, this time against what the file really decodes to: the
  // header is an unverified claim, and one that under-reports would otherwise
  // walk an arbitrarily long source straight past `assertHeaderUsable`.
  assertWithinCap(durationMs);
  return { durationMs, durationSamples };
}

/**
 * A truncated upload keeps a perfectly valid header, so `probe` believes it;
 * only the renditions reveal how much audio there actually was. Measured: a
 * half-transferred MP3 probes 2000 ms and renders 799 ms, and was published
 * `ready` with no error at all.
 *
 * Skipped entirely when the header carries no duration (`probedMs <= 0`) —
 * there is nothing to compare against, and inventing a comparison would reject
 * good files.
 */
export function assertRenditionComplete(
  probedMs: number,
  renditionMs: number,
  codec: string
): void {
  if (probedMs <= 0) return;
  if (probedMs - renditionMs > maxDurationShortfallMs(probedMs)) {
    throw new PermanentError(
      `Audio file appears truncated: it declares ${probedMs} ms but the ${codec} rendition contains only ${renditionMs} ms`
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

  if (typeof obj.ContentLength === 'number' && obj.ContentLength > maxBytes) {
    // Release the socket rather than leaving the response half-read.
    body.destroy?.();
    throw new PermanentError(
      `Audio file is ${obj.ContentLength} bytes, over the ${maxBytes} byte limit`
    );
  }

  let received = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > maxBytes) {
        done(new PermanentError(`Audio file exceeds the ${maxBytes} byte limit`));
        return;
      }
      done(null, chunk);
    },
  });

  await pipeline(body, cap, createWriteStream(dest));
}

/**
 * Deletes an R2 object. Used by the reaper for sources abandoned mid-upload
 * (see `reapStale`) — the worker is the only process in the system that both
 * holds R2 credentials and knows a row was abandoned.
 *
 * The client is built lazily and reused: `r2()` throws when R2 env vars are
 * missing, and that must surface as one caught, logged reap failure rather
 * than as a crash at worker startup.
 */
export function makeSourceDeleter(): (key: string) => Promise<void> {
  let cached: { client: S3Client; bucket: string } | null = null;
  return async (key: string) => {
    if (!cached) {
      const { client, bucket } = r2();
      cached = { client, bucket };
    }
    await cached.client.send(new DeleteObjectCommand({ Bucket: cached.bucket, Key: key }));
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
    // Every stage ends with a beat: the liveness probe reads loop PROGRESS, and
    // a single asset can legitimately occupy the loop for tens of minutes, so a
    // heartbeat written only between assets would have to be given a threshold
    // too generous to catch anything. See heartbeat.ts.
    beat();

    const meta = await probe(src);

    // Cheapest gate first: the header claim, read without decoding a single
    // frame. An 18-hour source must never reach a decoder at all.
    assertHeaderUsable(meta);

    // One full decode pass. Everything that needs to know what the file really
    // contains — as opposed to what its header asserts — comes from here, so
    // this runs once and only once.
    const { durationMs, durationSamples } = assertDecodedUsable(await analyze(src));
    beat();

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
      assertRenditionComplete(meta.durationMs, (await probe(path)).durationMs, codec);
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
