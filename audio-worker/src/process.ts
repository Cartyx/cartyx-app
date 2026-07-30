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
import {
  maxSourceBytes,
  readS3Timeouts,
  MAX_SOURCE_DURATION_MS,
  MEASURE_LIMIT_SECONDS,
  RENDER_LIMIT_SECONDS,
} from './config.js';
import { beat } from './heartbeat.js';
import { captureException } from './telemetry.js';

const PEAK_BUCKETS = 400;

/**
 * The cap and the two bounds derived from it live in config.ts, next to every
 * other tunable the worker reads; re-exported here because this module is where
 * they are applied and where the existing callers look for them. Read
 * `MAX_SOURCE_DURATION_MS`'s comment there before touching anything below — it
 * states the invariant and enumerates the six different "durations" this
 * feature has managed to confuse.
 *
 * THERE IS NO HEADER PRE-GATE, and that is a decision rather than an omission.
 * The tempting shape is "reject when `format=duration` claims something absurd,
 * several times the cap — over-reports only inflate, so it cannot false-
 * positive". The asymmetry does not survive measurement. ffmpeg extrapolates an
 * MP3's duration from the FIRST FRAME's bitrate, so the over-report factor is
 * `avg_bitrate / first_frame_bitrate` and does not depend on the file's length
 * at all. Measured here on files built entirely by stock ffmpeg:
 *
 *   honest 20.8-minute MP3, 32 kbit/s intro frame + 320 kbit/s body (48 MB,
 *   inside AUDIO_MAX_BYTES, inside the 30-minute cap)   claims 12 464 s = 6.9x cap
 *   the hostile gap-timeline Matroska this bound exists for     4 000 s = 2.2x cap
 *
 * Any threshold low enough to catch the hostile file permanently rejects the
 * honest one, which is round 5's defect exactly. And the gate buys nothing now:
 * the reason a header gate ever looked necessary was the COST of decoding an
 * unbounded source, and `boundedDecodeFilters` caps that at ~1 s (measured 0.99 s
 * on a 13.9-hour, 50 MB source). A gate that cannot be made safe and is not
 * needed is not worth having. `probe()`'s duration stays for provenance and for
 * the disagreement log below, and rejects nothing.
 */
export { MAX_SOURCE_DURATION_MS, MEASURE_LIMIT_SECONDS, RENDER_LIMIT_SECONDS };

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
 */
export const MAX_RENDITION_SHORTFALL_MS = 500;

/**
 * How far a rendition may run PAST the recorded duration: 250 ms.
 *
 * The check used to have no such side, and the comment above used to end "the
 * check is still ONE-SIDED: padding can only make a rendition longer" — which
 * is true about padding and false about the failure this guard exists for.
 * Round 6's actual defect was a `ready` row recording 5 025 ms against
 * 1 005 100 ms renditions. `decodedMs - renditionMs` is NEGATIVE there, roughly
 * minus a million, so the shortfall test could not fire and did not. The one
 * thing that caught it was `analyze` summing its segment reports — i.e. the
 * guard was, once again, an argument made per commit rather than a check made
 * per asset. This is the check.
 *
 * ASYMMETRIC, because the two directions have different benign causes.
 *
 * The overrun is NOT the handful of milliseconds of encoder padding it was
 * previously described as. Driving the real chain over a duration sweep
 * (4000 ms to 15 678 ms, 14 ms apart) shows the rendition's container duration
 * is exactly the decoded length ROUNDED UP TO A WHOLE 100 ms:
 *
 *   decoded 4000 ms -> m4a 4000 ms (+0)      decoded 4013 -> 4100 (+87)
 *   decoded 4027    -> 4100      (+73)       decoded 4097 -> 4100  (+3)
 *   decoded 9999    -> 10 000    (+1)        decoded 12 345 -> 12 400 (+55)
 *
 * That is `loudnorm`'s frame: it processes in `sample_rate / 10` blocks and
 * pads the final partial one. So the structural worst is
 *
 *   < 100 ms   loudnorm's final-frame padding
 *   +  6.5 ms  Ogg/Opus pre-skip and end padding (the opus leg runs exactly
 *              this much above the aac leg on every fixture measured)
 *   +  0.479 ms the cap-rounding below
 *   ------------------------------------------------------------------------
 *   < 107 ms
 *
 * and the worst OBSERVED across the whole fixture corpus is 101 ms
 * (`overCapTruncated`, opus). 250 ms is 2.3x the structural worst. Note this is
 * the number to fix if `loudnorm` is ever replaced or its two-pass form adopted
 * — it is a property of that filter, not of the encoders.
 *
 * The padding is TRAILING, not leading, which is what makes it safe to allow at
 * all: an impulse test (transients in the first and last millisecond of a
 * 4013 ms source) finds them at output samples 0 and 192 625 against input
 * positions 0 and 192 576 — no shift. Phase 2's `loopEnd = durationSamples`
 * therefore still lands on real content, with the padding beyond it.
 *
 * The 0.479 ms is real and covered deliberately rather than absorbed by a round
 * number. `assertDecodedUsable` compares `Math.round(samples / 48)` against the
 * cap, so the largest sample count it accepts is 86 400 023 — 23 samples past
 * the 86 400 000 the render bound then cuts at. The recorded `durationSamples`
 * can therefore sit up to 23 samples ahead of what the renditions hold.
 *
 * And 250 ms still catches the thing it is for by four orders of magnitude: the
 * round 6 divergence was a 1 000 075 ms overrun.
 */
export const MAX_RENDITION_OVERRUN_MS = 250;

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
export function assertDecodedUsable(decoded: {
  samples: number;
  peakDb: number;
  segments?: number;
}): {
  durationMs: number;
  durationSamples: number;
} {
  if ((decoded.segments ?? 1) > 1) {
    // A source that changes sample rate, sample format or channel layout part
    // way through makes ffmpeg tear down and rebuild the whole filter graph at
    // the change, which discards whatever `loudnorm` is holding in its
    // 3-second lookahead. The renditions come out SHORT, by more the more
    // often it happens: 7.12 s measured / 4.21 s rendered on a two-segment
    // file, 1800 s measured / 60.1 s rendered on a thirty-segment one. Both
    // are measured; neither is publishable.
    //
    // Refused HERE rather than left to `assertRenditionComplete`, which also
    // catches it, for two reasons. It costs two full transcodes to reach that
    // check — ~2 minutes of pinned CPU on a single-node cluster for a file
    // already known to be unusable. And the summed measurement is not even a
    // trustworthy duration for such a file: the trim resets with the graph, so
    // thirty 60 s segments sum to 86 453 457 samples, 0.11 s past a cap the
    // file is exactly at, and the rejection would name the wrong cause
    // ("over the 30 minute limit") for a file whose real problem is its format
    // changes.
    throw new PermanentError(
      `Audio changes audio format part way through (${decoded.segments} segments); ` +
        `re-encode it to a single sample rate and channel layout, then upload it again`
    );
  }
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
  // The duration cap, and the ONLY place a source is REJECTED for it.
  // `decoded.samples` came from a decode bounded at `MEASURE_LIMIT_SECONDS`, so
  // a source of any length reports at most one second over the cap here —
  // enough to fail it, and cheap enough that no header pre-gate is needed to
  // afford asking.
  //
  // REJECT, NOT TRUNCATE. The rendering stages are bounded too, so silently
  // publishing the first 30 minutes of a 40-minute mix would be trivial to
  // implement and is exactly what must not happen: the owner uploaded a file,
  // saw `ready`, and would find out that the last 10 minutes are gone when the
  // track cut out mid-session with a table watching. A permanent failure
  // carrying the measured length ("Audio is 40 minutes long, over the 30 minute
  // limit") tells them what is wrong and what to do about it while they are
  // still at the upload screen. The rendering bound exists to make the
  // invariant hold structurally, not as a product behaviour.
  if (durationMs > MAX_SOURCE_DURATION_MS) {
    // The length is only quotable when the measurement is the file's WHOLE
    // length. It usually is not: the measuring pass stops at
    // `MEASURE_LIMIT_SECONDS`, so a 45-minute upload and a 14-hour one both
    // measure 1 801 000 ms — which `formatMinutes` rounds to "30 minutes", and
    // "Audio is 30 minutes long, over the 30 minute limit" is a sentence that
    // makes the product look broken while telling the owner nothing. Say what
    // is known instead. (Found while making the two-sided check: this fires on
    // every over-cap source, because every over-cap source reads at the bound.)
    const measurementIsComplete = durationSamples < MEASURE_LIMIT_SECONDS * RENDITION_SAMPLE_RATE;
    const limit = `${MAX_SOURCE_DURATION_MS / 60_000} minute limit`;
    throw new PermanentError(
      measurementIsComplete
        ? `Audio is ${formatMinutes(durationMs)} long, over the ${limit}`
        : `Audio is longer than the ${limit}`
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
 * This is also the one runtime check standing behind the claim that a duration
 * measured by `analyze` cannot diverge from the renditions a LATER ffmpeg
 * invocation produced. The argument for why they agree is in `processAsset`;
 * this is what makes a violation of it a failed asset rather than a wrong row.
 *
 * TWO-SIDED, and that is the whole point of it. It was one-sided until now,
 * testing only `decodedMs - renditionMs`, while the divergence it was cited as
 * preventing — round 6's `ready` row recording 5 025 ms against 1 005 100 ms of
 * renditions — is the other sign. The comment in `processAsset` claimed this
 * function made such a row impossible; it did not, and nothing did. See
 * `MAX_RENDITION_OVERRUN_MS` for why the two allowances differ.
 *
 * `segments` is `analyze`'s count of filter-graph segments, used to EXPLAIN a
 * shortfall. More than one means the source changes sample rate, sample format
 * or channel layout partway through, which makes ffmpeg rebuild the filter
 * graph — discarding whatever `loudnorm` was holding in its 3-second lookahead.
 * `assertDecodedUsable` now refuses such a source before either encoder runs,
 * so this branch is a backstop rather than the primary rejection; it stays
 * because the explanation is worth having if the earlier check is ever relaxed,
 * and because "the rendition is incomplete" alone tells the owner nothing they
 * can act on.
 *
 * NOTE what this deliberately does NOT do: it does not detect a truncated
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
  codec: string,
  segments = 1
): void {
  if (decodedMs - renditionMs > MAX_RENDITION_SHORTFALL_MS) {
    const cause =
      segments > 1
        ? ` — the source changes audio format part way through (${segments} segments); re-encode it to a single sample rate and channel layout`
        : '';
    throw new PermanentError(
      `The ${codec} rendition is incomplete: the source decodes to ${decodedMs} ms but the rendition contains only ${renditionMs} ms${cause}`
    );
  }
  if (renditionMs - decodedMs > MAX_RENDITION_OVERRUN_MS) {
    // THE DIRECTION ROUND 6 ACTUALLY FAILED IN. A rendition holding more audio
    // than the row records is not a smaller problem than one holding less: the
    // row is what phase 2 loops on, so an asset recorded at 5 s with 1005 s of
    // audio behind it plays 5 seconds and then loops over a track that is still
    // going. It is also the shape that a bound applied to one pass and not
    // another produces, which has now happened twice.
    throw new PermanentError(
      `The ${codec} rendition is longer than the source: the source decodes to ${decodedMs} ms but the rendition contains ${renditionMs} ms`
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
  asset: {
    _id: unknown;
    sourceKey?: string;
    // Task 18: the once-variant's own uploaded source object, and which
    // pipeline pass this claim is for. `variant` defaults to 'main' on
    // every row that predates this field (Mongo equality-to-undefined
    // semantics), so `isOnceVariant` below is false for the overwhelming
    // majority of claimed rows without either side needing to know the
    // field exists.
    onceSourceKey?: string;
    variant?: 'main' | 'once';
    attempts?: number;
  },
  workerId: string
): Promise<void> {
  const id = asset._id;
  const isOnceVariant = asset.variant === 'once';

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

  // Task 18: a row claimed for the once-variant pipeline must actually carry
  // the once-variant's own source object. This should be unreachable through
  // the app's own flow — `createOnceVariantUpload` sets `onceSourceKey` and
  // `variant: 'once'` together, in the same write — but a malformed or
  // hand-edited row must not reach GetObjectCommand with an undefined Key.
  // Permanent: no amount of retrying invents a source key that was never
  // recorded.
  if (isOnceVariant && !asset.onceSourceKey) {
    logger.error(
      { assetId: String(id) },
      'once-variant row has no onceSourceKey, cannot transcode'
    );
    await markFailed(model, id, workerId, 'Once-variant asset has no onceSourceKey', true);
    return;
  }
  // What this run actually downloads and transcodes: the once-variant's own
  // source when this claim is for that pipeline, the ordinary source
  // otherwise. `renditionBase` below is deliberately NOT derived from this —
  // see its own comment.
  const effectiveSourceKey = isOnceVariant ? (asset.onceSourceKey as string) : sourceKey;

  // Renditions go BESIDE their source, inside the owner's storage namespace
  // (`uploads/audio/<prefix>/renditions/<id>.<ext>`), which is derived from the
  // source key — see src/keys.ts. A source key that predates that layout gives
  // us nowhere safe to put them: writing to the old shared
  // `uploads/audio/renditions/` root would put objects outside every user's
  // listing prefix, where the app's cleanup cannot see them and no owner can
  // ever reclaim them. Permanent, not retryable — the source key is fixed, so
  // a second attempt lands in exactly the same place.
  // Always from the MAIN sourceKey, even when this claim is for the
  // once-variant: both variants live under the same owner namespace (the
  // once-variant's own source key was minted from that same prefix — see
  // `createOnceVariantUpload`), and deriving from one fixed key means the
  // main and once rendition bases can never disagree about which prefix
  // they're under. The two are kept from colliding at the extension below
  // instead (`.once.<ext>` vs `.<ext>`), not by using a different base.
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
    await downloadSource(client, bucket, effectiveSourceKey, src, maxSourceBytes());
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

    // The MEASURING pass, bounded at `MEASURE_LIMIT_SECONDS`. Everything that
    // needs to know what the file really contains — as opposed to what its
    // header asserts — comes from here, so this runs once and only once.
    //
    // WHY THIS NUMBER CANNOT DIVERGE FROM THE RENDITIONS, given it comes from a
    // different ffmpeg invocation than the one that produced them:
    //
    // - Same bytes. `src` is a file on local disk written once by
    //   `downloadSource`; nothing rewrites it and nothing else reads from R2.
    // - Same decode. Both invocations use `-map 0:a:0` and the same decoder;
    //   audio decoding of a fixed byte stream is deterministic.
    // - Same bound, character for character. Both run the string
    //   `boundedDecodeFilters` returns, so neither can be bounded on a
    //   different QUANTITY from the other — which is the failure mode that
    //   produced the last two defects, not arithmetic drift.
    // - The remaining bound difference is one-way and safe: the rendering
    //   stages trim at `RENDER_LIMIT_SECONDS` (the cap) while this trims at
    //   the cap + 1 s, so if they could disagree at all the renditions would be
    //   SHORTER, never longer than the cap.
    // - And it is CHECKED per asset rather than argued per commit: every
    //   rendition is probed below and `assertRenditionComplete` refuses to
    //   publish one that diverges from this number IN EITHER DIRECTION. That
    //   last clause used to read "short of this number", and the check really
    //   was one-sided, so the sentence that followed it — "a divergence is a
    //   failed asset, never a `ready` row with a wrong duration" — was false
    //   for exactly the divergence round 6 shipped, which was a rendition
    //   LONGER than the row. It is true now because the check is two-sided,
    //   not because the argument above got better.
    const decoded = await analyze(src, MEASURE_LIMIT_SECONDS);
    const { durationMs, durationSamples } = assertDecodedUsable(decoded);
    beat();

    if (meta.durationMs > 0 && Math.abs(meta.durationMs - durationMs) > 1000) {
      // Not a failure, and deliberately not telemetry: for a VBR MP3 with no
      // Xing header a large gap here is the NORM, not a fault. Logged because
      // when someone is looking at an asset whose length surprises them, the
      // two numbers side by side are the whole answer.
      logger.info(
        {
          assetId: String(id),
          headerMs: meta.durationMs,
          decodedMs: durationMs,
          // >1 means the source changes format mid-stream, which is both a
          // common reason for a wild header claim and the thing that will make
          // the rendition check below refuse the file. Worth having in the same
          // line as the two durations when someone is working out why.
          segments: decoded.segments,
        },
        'container duration disagrees with the decoded length; using the decoded length'
      );
    }

    const opusPath = join(dir, 'out.opus');
    const aacPath = join(dir, 'out.m4a');
    // Both legs carry the SAME bound the measuring pass ran under. This is the
    // half that was missing: `analyze` was bounded and these two were not, so a
    // source whose decoded length the bound understated was measured short and
    // encoded long.
    await transcode(src, opusPath, 'opus', RENDER_LIMIT_SECONDS);
    beat();
    await transcode(src, aacPath, 'aac', RENDER_LIMIT_SECONDS);
    beat();

    for (const [codec, path] of [
      ['opus', opusPath],
      ['aac', aacPath],
    ] as const) {
      const renditionMs = (await probe(path)).durationMs;
      beat();
      // Against `durationMs` — the MEASURED decode — never against
      // `meta.durationMs`. See `assertRenditionComplete`.
      assertRenditionComplete(durationMs, renditionMs, codec, decoded.segments);
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
    const peaks = await extractPeaks(opusPath, PEAK_BUCKETS, RENDER_LIMIT_SECONDS);
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
      // worker just produced at a fixed bitrate.
      //
      // RE-DERIVED. That last clause used to end "…from an input already capped
      // at MAX_SOURCE_DURATION_MS", and the cap was applied to the MEASURING
      // pass only — `transcode` ran unbounded, so the premise was false and the
      // 28.8 MB figure was wishful: a 12.7 MB source produced a 46.5 MB
      // rendition here, 1.6x the stated worst case. `transcode` now carries the
      // same bound (see `RENDER_LIMIT_SECONDS` above), so the input to the
      // encoders is now genuinely 1800 s at most.
      //
      // HOW BIG IS A RENDITION. This has now been answered wrong three times,
      // each time by measuring ONE SIGNAL and generalising — 48 MB, then
      // 46.5 MB, then "~30 MB". The third was measured on a pure 440 Hz tone,
      // described as "the shape both encoders spend the most bits on". It is
      // not. Measured at 1800 s through this exact chain:
      //
      //   signal                     opus kbit/s    opus bytes    aac bytes
      //   440 Hz sine                    122.9      27 643 263   29 132 075
      //   white noise                     64.1      14 422 201   29 205 924
      //   five tones (440 Hz .. 21 kHz)  208.2      46 849 240   29 132 127
      //
      // So the worst measured is 46.8 MB, 1.6x the number this comment used to
      // give, and it is REACHABLE FROM AN ACCEPTED SOURCE: the same five-tone
      // signal pre-encoded as a 128 kbit/s MP3 is 28.8 MB — comfortably inside
      // `AUDIO_MAX_BYTES` — and still yields 208.3 kbit/s of opus, 46.9 MB.
      //
      // Rather than quote a fourth measurement as if it were a bound, here is
      // the STRUCTURAL one. AAC at `-b:a 128k` is near-CBR and lands within 2%
      // of 28.8 MB on every signal above. libopus's default VBR treats `-b:a`
      // as a target it may exceed on tonal content, and its hard stereo maximum
      // is 512 kbit/s = 115 MB at 1800 s. That is the real ceiling, and no
      // signal tested comes near it. Read one at a time, so the peak is one
      // rendition plus its PUT body — `readFile` plus the SDK's copy is ~2x the
      // file, so the structural worst case is ~230 MB transient against the
      // pod's 768Mi, and the worst MEASURED is ~94 MB.
      //
      // `-vbr constrained` on the opus leg pins every signal above to
      // 97.0 kbit/s / 21.8 MB (measured, all four), which would make the ceiling
      // 22 MB instead of 115 MB. NOT adopted: it costs quality on exactly the
      // tonal content that provokes the bitrate, the measured worst fits the pod
      // with room to spare, and 47 MB of R2 for a 30-minute asset is not a cost
      // worth trading fidelity for. It is the lever to pull if per-asset storage
      // ever becomes the binding constraint — which is the same open question as
      // the missing per-user quota.
      //
      // Streaming them would also make the PUT body non-replayable, turning the
      // SDK's internal retry of a transient R2 blip into a hard failure.
      const body = await readFile(path);
      // `.once.<ext>` for the once-variant, `.<ext>` for main — this is what
      // makes the two renditions land at DIFFERENT keys under the same
      // `base` (see `renditionBase` above) instead of the once-variant
      // silently overwriting the main rendition it shares an id with.
      const key = isOnceVariant ? `${base}.once.${ext}` : `${base}.${ext}`;
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type })
      );
      renditions[codec] = { key, url: `${cdnUrl}/${key}`, bytes: body.length };
      beat();
    }

    // Task 18: "same pipeline, different destination field" — everything
    // above this point (probe/analyze/transcode/peaks) ran identically
    // regardless of variant. Only the terminal write differs, and it
    // differs COMPLETELY between the two branches rather than sharing a
    // partial object: the once-variant write touches `onceRenditions` and
    // NOTHING that describes the main content (durationMs/durationSamples/
    // sampleRate/channels/loudnessTargetLufs/peaks/renditions all stay
    // exactly as the main pipeline last wrote them), and `variant` resets to
    // 'main' since this job is done. A failed once-variant run does NOT go
    // through here at all (see the catch block below) — `variant` stays
    // 'once' on failure, so Retry retries the SAME job rather than silently
    // re-running the (already-ready) main transcode.
    const resultSet = isOnceVariant
      ? {
          status: 'ready',
          variant: 'main',
          onceRenditions: renditions,
          lastError: null,
          permanentFailure: false,
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        }
      : {
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
        };

    await fencedWrite(model, id, workerId, resultSet, 'ready');
    logger.info({ assetId: String(id), variant: isOnceVariant ? 'once' : 'main' }, 'transcoded');
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
