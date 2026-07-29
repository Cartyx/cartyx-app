/**
 * Every millisecond duration the worker reads from the environment, in one
 * testable place. `index.ts` is the process entry point — it calls `main()` at
 * import time — so anything parsed inline there can never be asserted on.
 */

/**
 * Read a positive finite number from the environment, falling back on anything
 * else.
 *
 * The `Number.isFinite` and `> 0` guards are both load-bearing, and neither is
 * covered by the obvious `Number(process.env.X ?? fallback)`: `??` does not
 * fire for an empty string, and `Number('') === 0`. An empty value is a
 * realistic input — Helm renders an empty string for a missing `values.yaml`
 * key — and a zero is catastrophic rather than merely wrong: a 0ms upload
 * cutoff makes `reapStale` fail every in-flight upload the instant it starts,
 * a 0ms poll interval spins the worker loop hot, and a 0-byte size cap rejects
 * every upload ever made.
 */
export function envPositive(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Millisecond-flavoured alias for `envPositive`; every duration below uses it. */
export const envMs = envPositive;

export const DEFAULT_POLL_MS = 5_000;

/**
 * How long a row may sit in `processing` before the reaper reclaims it.
 *
 * TIED TO `FFMPEG_TIMEOUT_MS` (ffmpeg.ts) — do not raise one without redoing
 * this arithmetic. One asset spawns SEVEN capped child processes: probe(source),
 * analyze(source), transcode(opus), transcode(aac), probe(opus), probe(aac) and
 * extractPeaks(opus). At the 300 000 ms default that is 2 100 s of bounded
 * worst case before a byte of R2 traffic, and the R2 GET plus two rendition
 * PUTs (each bounded by `S3_REQUEST_TIMEOUT_MS` x the SDK's retries) add up to
 * ~600 s more. So a HEALTHY worker can legitimately hold a claim for ~45
 * minutes, and the previous 600 000 ms value instructed the reaper to revoke
 * live claims — handing the same asset to a second worker while the first was
 * still transcoding it.
 *
 * One hour is that worst case with ~33% headroom. The cost of being generous
 * here is only how long a genuinely dead worker's row waits for rescue; the
 * cost of being tight is duplicated work and a burned retry budget on every
 * slow-but-healthy asset, which is strictly worse.
 *
 * Lowering `FFMPEG_TIMEOUT_MS` instead was considered and rejected: measured on
 * this repo's own pipeline, a 30-minute source (the `MAX_SOURCE_DURATION_MS`
 * cap) costs 45 s of CPU for the Opus leg and 51 s for the AAC leg on a fast
 * 2026 laptop core. The cluster node is several times slower per core and the
 * pod is capped at 1 CPU, so a legitimate leg can plausibly run 2-3 minutes
 * there — 300 s is already only a small multiple of real work, not slack.
 */
export const DEFAULT_CLAIM_TIMEOUT_MS = 3_600_000;

/**
 * Presigned PUT URLs expire after 300s (`app/server/functions/uploads.ts`), so
 * a row still `uploading` 15 minutes after creation can never be confirmed —
 * nothing will ever move it again. See `reapStale`'s doc comment.
 */
export const DEFAULT_UPLOAD_TIMEOUT_MS = 900_000;

/**
 * The source-object size cap, enforced AT POINT OF USE in `processAsset`.
 *
 * MUST match `AUDIO_MAX_BYTES` in `app/types/audio.ts` (50 MB), and cannot
 * drift silently: `tests/server/functions/audio-cross-service-contract.test.ts`
 * in the app package reads THIS line and fails when the two disagree. That is
 * deliberately cheaper than a shared module — see that file for why the
 * packages stay independent. The app-side
 * check in `confirmAudioUpload` is a check-time HeadObject, and the presigned
 * PUT it validates is valid for 300 s and REUSABLE: a client can PUT 1 KB, let
 * confirm pass, then re-PUT gigabytes to the same URL. Nothing invalidates the
 * URL, so the worker cannot trust that what it downloads is what confirm
 * measured — it has to measure again itself.
 *
 * `downloadSource` is therefore the only enforcement point that sees the bytes
 * as STORED rather than as declared, and it both refuses to read an oversized
 * object and deletes it — refusing alone would leave the object in R2 attached
 * to a `failed` row, which is exactly the state the owner-scoped cleanup reads
 * as in-use. What is still NOT bounded is total storage per user: nothing caps
 * how many separate under-50 MB objects one account may accumulate. A per-user
 * quota is an open product question in the design doc, not something to invent
 * here.
 */
export const DEFAULT_MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/** Socket-inactivity cap on a single R2 request. */
export const DEFAULT_S3_REQUEST_TIMEOUT_MS = 60_000;
/** Cap on establishing the TCP/TLS connection to R2. */
export const DEFAULT_S3_CONNECT_TIMEOUT_MS = 10_000;

/**
 * How stale the heartbeat file may get before the liveness probe kills the pod.
 *
 * Sized against the longest legitimate gap BETWEEN TWO `beat()` CALLS, so the
 * number is only correct as long as the beats really are where this says they
 * are. They are enumerated here on purpose — this comment previously claimed a
 * 300 s worst case while `processAsset` ran two `probe()` calls and
 * `extractPeaks()` between consecutive beats, three capped child processes back
 * to back for a real worst case of 900 s: 1.5x the threshold, i.e. the probe
 * could kill a healthy worker mid-asset. The fix was more beats, not a bigger
 * number — a threshold raised to cover 900 s detects a genuine wedge three
 * times slower, and this probe exists precisely because a wedge is otherwise
 * invisible.
 *
 * Every gap in the worker, exhaustively:
 *
 * - `index.ts`'s loop beats each iteration, and `POLL_INTERVAL_MS` (5 s) is the
 *   idle gap.
 * - `reapStale` beats after every row it writes and after every delete batch.
 * - `processAsset` beats after each of: the source download (which also beats
 *   per chunk as bytes arrive, so a slow transfer cannot age it out), the
 *   source `probe`, `analyze`, each `transcode`, each rendition `probe`,
 *   `extractPeaks`, and each rendition `PutObject`.
 *
 * So the longest gap is one bounded stage: `FFMPEG_TIMEOUT_MS` (300 s) for a
 * child process, or an R2 call bounded by `S3_REQUEST_TIMEOUT_MS` and the SDK's
 * retries. Ten minutes is 2x the longest of those. Sized against the longest
 * STAGE, not the longest asset: a per-asset threshold (~45 min, see
 * `DEFAULT_CLAIM_TIMEOUT_MS`) would make the probe nearly useless.
 *
 * ADDING A STAGE MEANS ADDING A BEAT. That is the invariant this number rests
 * on, and nothing but review enforces it.
 */
export const DEFAULT_HEARTBEAT_MAX_AGE_MS = 600_000;

/** Where the heartbeat file lives. `/tmp` is writable for the non-root user. */
export const DEFAULT_HEARTBEAT_FILE = '/tmp/audio-worker-heartbeat';

export type WorkerTimings = {
  /** How long to sleep when the queue is empty. */
  pollMs: number;
  /** How long a row may sit in `processing` before the reaper reclaims it. */
  staleMs: number;
  /** How long a row may sit in `uploading` before the reaper fails it. */
  uploadStaleMs: number;
};

/** Read at startup by `index.ts`. Every value goes through `envMs` — see why above. */
export function readWorkerTimings(): WorkerTimings {
  return {
    pollMs: envMs('POLL_INTERVAL_MS', DEFAULT_POLL_MS),
    staleMs: envMs('CLAIM_TIMEOUT_MS', DEFAULT_CLAIM_TIMEOUT_MS),
    uploadStaleMs: envMs('UPLOAD_TIMEOUT_MS', DEFAULT_UPLOAD_TIMEOUT_MS),
  };
}

/** The point-of-use size cap, overridable only to make it stricter in an emergency. */
export function maxSourceBytes(): number {
  return envPositive('AUDIO_MAX_BYTES', DEFAULT_MAX_SOURCE_BYTES);
}

/**
 * Timeouts for every R2 call.
 *
 * Without these the AWS SDK's Node handler has NO request timeout at all, and
 * the R2 calls are then the only unbounded awaits left in the worker (every
 * child process is capped by `childProcOptions`). A half-open socket to R2
 * would hang `processAsset` forever, which hangs the single sequential loop —
 * and `reapStale` runs INSIDE that loop, so nothing would ever rescue the row
 * either. Every other user's upload queues behind it until someone notices and
 * restarts the pod by hand.
 */
export function readS3Timeouts(): { requestTimeout: number; connectionTimeout: number } {
  return {
    requestTimeout: envMs('S3_REQUEST_TIMEOUT_MS', DEFAULT_S3_REQUEST_TIMEOUT_MS),
    connectionTimeout: envMs('S3_CONNECT_TIMEOUT_MS', DEFAULT_S3_CONNECT_TIMEOUT_MS),
  };
}

export function heartbeatFile(): string {
  return process.env.HEARTBEAT_FILE || DEFAULT_HEARTBEAT_FILE;
}

export function heartbeatMaxAgeMs(): number {
  return envMs('HEARTBEAT_MAX_AGE_MS', DEFAULT_HEARTBEAT_MAX_AGE_MS);
}

/** The pino levels, plus `silent`. Anything else is not a level pino accepts. */
const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

/**
 * The log level, validated.
 *
 * `pino({ level })` THROWS on a value it does not recognise — measured:
 * `pino({ level: '' })` fails with "default level: must be included in custom
 * levels". `logger.ts` runs at import time, so that throw is not a bad log
 * line, it is a pod that cannot start: CrashLoopBackOff on every replica, and
 * the reason never reaches the log because the logger is what failed.
 *
 * Both hostile values are realistic now that this is a chart key. Helm renders
 * an EMPTY STRING for a missing `values.yaml` entry (the same hazard `envMs`
 * exists for, and `??` does not fire for `''`), and the whole point of wiring
 * it is that an operator sets it by hand at 2am — `LOG_LEVEL=verbose` or
 * `LOG_LEVEL=DEBUG` are the obvious wrong guesses. Falling back to `info`
 * gives them a running worker and the default logs rather than no worker.
 */
export function logLevel(): string {
  // Lower-cased rather than matched exactly: `LOG_LEVEL=DEBUG` is what an
  // operator types, and honouring it beats silently ignoring it. (pino happens
  // to accept `DEBUG` today, so an exact-match guard would have changed
  // working behaviour into a fallback.)
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  return raw && LOG_LEVELS.has(raw) ? raw : 'info';
}
