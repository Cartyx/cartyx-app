import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { AudioPackage } from '../db/models/AudioPackage';
import { escapeRegExp, normalizeTags } from '../utils/helpers';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { resolveAudioStoragePrefix } from './audio-storage';
import { getUserStorageUsage, type AudioStorageUsage } from './audio-quota';
import { createR2, getAudioUploadUrl } from './uploads';
import { pruneOrphanedMoodStates } from '~/lib/soundboard/prune';
import { AUDIO_CLIENT_ERROR_NAME } from '~/lib/client-refusal';
import { AUDIO_MAX_BYTES, AUDIO_SOURCE_TYPES } from '~/types/audio';
import type { AudioAssetData } from '~/types/audio';
import type { MoodData, PackageItemData } from '~/types/soundboard';
import type {
  createAudioUploadSchema,
  confirmAudioUploadSchema,
  attachOnceVariantUploadSchema,
  confirmOnceVariantUploadSchema,
  listAudioAssetsSchema,
  updateAudioAssetSchema,
  bulkTagAudioAssetsSchema,
  deleteAudioAssetSchema,
  retryAudioAssetSchema,
} from '~/types/schemas/audio';

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

/**
 * A mistake in the caller's own request — a malformed cursor, an id that isn't
 * an id. It is still an error (the caller must learn its request was rejected),
 * but it is NOT a server fault, so it must not file a GlitchTip event: a client
 * that sends one bad cursor per keystroke would otherwise author one error
 * report per keystroke, and the signal in GlitchTip is worth more than that.
 *
 * `~/types/schemas/audio.ts` rejects these shapes at the request boundary, so
 * this class covers the fail-closed paths behind it rather than the common case.
 *
 * IT ALSO COVERS EVERY `'Audio asset not found'` THROW IN THIS FILE, and that
 * is deliberate. Each one fires when `findOne({ _id: <caller-supplied id>,
 * ownerId: userId })` misses — which for a schema of `z.object({ id: objectId
 * })` any authenticated user can trigger at will by generating well-formed
 * ObjectIds. As a plain `Error` those reached `reportAudioError` and filed one
 * GlitchTip event per request, making the report volume the caller's
 * parameter — the same shape `packages.ts` documents on `getPackage` and the
 * reason `PackageClientError` exists. The message is unchanged, so nothing the
 * user or the phase-3 bearer adapter sees changes: `~/routes/api/audio/
 * uploads.$id.confirm.ts` classifies these by `e instanceof Error` plus a
 * message regex, and `AudioClientError` satisfies both.
 *
 * `retryAudioAsset`'s "cannot be retried" throw is the sixth site of the same
 * class, worded differently because its miss is a single compound
 * `findOneAndUpdate({ _id, ownerId, status: 'failed', confirmedAt: { $ne:
 * null }, permanentFailure: { $ne: true } })` rather than a bare `{ _id,
 * ownerId }` lookup — but nothing gates it on ownership FIRST the way
 * `confirmAudioUpload`'s precondition throw does, so a caller who does not
 * own the guessed id gets this exact throw regardless of the row's state.
 * It is reachable purely by guessing ids, same as the other five, just with
 * extra clauses folded into the one query. `retryAudioAsset` has no phase-3
 * bearer route, so there is no message-regex classifier to keep in sync.
 *
 * NOT converted: the sibling precondition throws on the same functions
 * ('Audio asset is not awaiting confirmation', 'Only music assets can have a
 * once-variant attached', ...). Those require the caller to already OWN a real
 * asset in a specific state — reached only AFTER a separate ownership check
 * has already passed — so they are not reachable by guessing ids and their
 * volume is bounded by the caller's own library. Leaving them as plain
 * `Error`s keeps a genuine state-machine surprise visible in GlitchTip.
 */
export class AudioClientError extends Error {
  /**
   * Set only when the refusal is a rate-limit rejection thrown by
   * `~/utils/audio-server-fns.ts`'s wrapper gate: how long until the caller's
   * bucket has a token again, so the UI can say WHEN to retry rather than
   * just "no". Absent on every other client error, which is not time-based.
   */
  readonly retryAfterMs?: number;

  /**
   * Set only by a storage-quota refusal — all four of them
   * (`createAudioUpload`, `createOnceVariantUpload`, `confirmAudioUpload`,
   * `confirmOnceVariantUpload`; see `checkStorageQuota`): the caller's
   * measured usage and the limit it was checked against, at the moment of
   * refusal. The message already embeds both as text, but a structured pair
   * is what lets the UI (Task 5) render "X of Y used" without re-parsing
   * prose or making a second round trip. Absent on every other client error,
   * which is not quota-based.
   */
  readonly usageBytes?: number;
  readonly limitBytes?: number;

  constructor(
    message: string,
    options?: { retryAfterMs?: number; usageBytes?: number; limitBytes?: number }
  ) {
    super(message);
    // From the shared constant, not a literal: the browser recognises this
    // refusal by `.name` (see `~/lib/client-refusal.ts`) in order to keep
    // its own telemetry as quiet as `reportAudioError` keeps the server's, and
    // a literal on each side is a contract only a grep can check.
    this.name = AUDIO_CLIENT_ERROR_NAME;
    this.retryAfterMs = options?.retryAfterMs;
    this.usageBytes = options?.usageBytes;
    this.limitBytes = options?.limitBytes;
  }
}

/**
 * Every audio function takes the acting user twice, and the two values are
 * genuinely different things:
 *
 * - `userId` is the User document's Mongo `_id`. It is what `AudioAsset.ownerId`
 *   references, so it is the ONLY value that may be used to scope a query.
 * - `sessionUserId` is the OAuth provider's subject id — the identity the rest
 *   of this codebase tags telemetry with (`requireCampaignMember` returns it
 *   under exactly this name, and ~150 call sites across `app/server/functions/`
 *   pass it to `serverCaptureException`/`serverCaptureEvent`). Umami and
 *   GlitchTip already know each human by it.
 *
 * Before this split, the audio functions tagged telemetry with the Mongo `_id`
 * while every other server function tagged the provider id, so one human doing
 * an image upload and an audio upload showed up as two unrelated users.
 * `getAudioUploadUrl`'s doc comment used to assert that this could not happen;
 * it was describing the intent, not the behaviour.
 *
 * It is optional because the ingest surface is deliberately auth-agnostic (see
 * the module comment in `~/utils/audio-server-fns.ts`): the phase-3 bearer-token
 * adapter has no OAuth session to draw one from. When it's absent the Mongo id
 * is used, which is worse than a provider id but better than `undefined`.
 */
type Actor = { userId: string; sessionUserId?: string };

function telemetryId(actor: Actor): string {
  return actor.sessionUserId ?? actor.userId;
}

/** Report to GlitchTip unless the failure was the caller's own doing. */
function reportAudioError(e: unknown, actor: Actor, context: Record<string, unknown>) {
  if (e instanceof AudioClientError) return;
  // `void`: deliberately not awaited (CLAUDE.md — capture calls must never
  // block a request-critical path), and explicit now that this file lints
  // `no-floating-promises` (see the config's B3 comment for why).
  void serverCaptureException(e, telemetryId(actor), context);
}

/**
 * Compares a SERVER-derived ObjectId (a lean document's field, which
 * `String()` always renders as lowercase hex) against a CLIENT-supplied id,
 * case-insensitively.
 *
 * Mongo's own ObjectId cast is case-insensitive — `find({_id: 'AABB…'})`
 * matches the document whose id prints as `aabb…` — so a query can succeed
 * while a naive `String(field) !== id` comparison over the same value is
 * `true` for every row. `deleteAudioAsset`'s package prune did exactly that:
 * an upper-cased 24-hex id (which `objectId`'s `[0-9a-fA-F]` regex accepts)
 * deleted the asset and all six of its R2 objects while EVERY referencing
 * package item survived as a permanent tombstone against the 64-item cap, and
 * `pruneOrphanedMoodStates` then no-opped too, because the surviving-items
 * list it was handed was the unchanged original.
 *
 * The `objectId` schema now lower-cases at the boundary (see
 * `~/types/schemas/audio.ts`), so in practice `data.id` reaches here already
 * canonical. This is the second, independent defence: the ingest surface is
 * deliberately auth-agnostic and phase 3's bearer adapter may not route every
 * call through the same Zod object, and a comparison that is only correct
 * because something upstream normalised is a comparison that breaks silently
 * when the upstream moves.
 */
function sameObjectId(serverValue: unknown, clientId: string): boolean {
  return String(serverValue).toLowerCase() === clientId.toLowerCase();
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled';
}

/**
 * 2 GiB. The design doc measures ~126 MB per asset at the ingest caps (50
 * MiB source + ~47 MB opus + ~29 MB aac renditions) — this admits 16 assets
 * at that worst case, and considerably more at realistic file sizes, since
 * most uploads are well under the 50 MiB source cap. This is a conservative
 * starting point for a self-hosted, single-node app with OPEN REGISTRATION —
 * bounding what an unknown stranger can cost in R2 storage is this task's
 * whole point — not a measured figure; the design doc's own open-questions
 * table defers tuning to real usage, and Task 11 wires this env var name
 * into the Helm chart so raising it needs no image rebuild.
 *
 * WHAT THIS NUMBER DOES NOT BOUND, for whoever tunes it: bytes that have
 * been presigned and PUT but not yet CONFIRMED are invisible to it.
 * `sourceBytes`/`onceSourceBytes` are written by the confirm success writes
 * and nowhere else, so an in-flight upload is real R2 storage the
 * aggregation cannot count until it lands — for at most the worker's
 * `UPLOAD_TIMEOUT_MS` (15 min by default), after which the reaper deletes
 * the abandoned object.
 *
 * THE SIZE OF THAT RESIDUAL, stated honestly, because an earlier version of
 * this note named a control that does not bound it at all. It said the
 * in-flight bytes were bounded by "the ingest rate limiter and the
 * pending-job cap". The PENDING-JOB CAP CONTRIBUTES NOTHING here:
 * `checkPendingJobCap` counts `status: {$in: ['pending','processing']}`, and
 * a presigned-but-unconfirmed row is `status: 'uploading'` — a state that
 * count never sees. (`createAudioUpload` does now check the cap, but as an
 * ingest-fairness gate; a caller who simply never calls confirm is still
 * invisible to it, because nothing they own ever enters the queue.)
 *
 * So the only real bound is `audioIngestLimiter` — 60 burst, 1/s sustained —
 * crossed with `UPLOAD_TIMEOUT_MS`: roughly 900 unconfirmed rows alive at
 * once, each holding up to `AUDIO_MAX_BYTES` (50 MiB). That is on the order
 * of 45 GB of real, billed R2 storage per account that this quota cannot
 * see, sustained indefinitely, and with open registration it multiplies per
 * account. In practice a caller is limited by their own upload bandwidth
 * long before the rate limiter binds, so the working figure is
 * `upload_bandwidth x UPLOAD_TIMEOUT_MS` — still multiples of this quota on
 * any ordinary connection.
 *
 * Transient per object and steady-state in aggregate. Closing it needs a
 * control this phase does not have (counting the client-declared `bytes`
 * against a separate in-flight budget at presign, or a much shorter upload
 * timeout); what an operator tuning `AUDIO_USER_QUOTA_BYTES` needs to know
 * is that this number is not the ceiling. Same note lives in
 * `deploy/charts/cartyx/values.yaml`, where an operator meets the knob.
 */
const DEFAULT_AUDIO_USER_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * `AUDIO_USER_QUOTA_BYTES`, read fresh on every call rather than baked into a
 * module-level constant at import time — same idiom `~/server/session.ts`'s
 * `setSession` uses for `APP_ENV`/`NODE_ENV`, and it means a value change
 * takes effect on the next request with no need to re-import this module.
 *
 * Server env only, never `VITE_PUBLIC_*` — a `VITE_PUBLIC_*` name gets
 * INLINED by Vite into the client bundle wherever it is referenced, module
 * boundary or not, and changing a limit must not require an image rebuild
 * (see the `deploying` skill's client-baked env rules).
 *
 * Guarded the same way the audio worker's `envPositive` is
 * (`audio-worker/src/config.ts` — a separate npm package, so its helper
 * cannot be imported here): `Number(process.env.X)` on an unset OR EMPTY
 * string is `NaN`, and Helm renders an empty string for a `values.yaml` key
 * nobody set, so a bare `?? DEFAULT` would not catch that case. A configured
 * `0` or negative value is caught too — it would refuse every upload for
 * every user, which is a misconfiguration, not a deliberate zero-byte quota.
 */
export function getAudioUserQuotaBytes(): number {
  const raw = Number(process.env.AUDIO_USER_QUOTA_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AUDIO_USER_QUOTA_BYTES;
}

/**
 * How many transcode jobs (`status: 'pending' | 'processing'`) one user may
 * occupy at once. This is the fairness control the design doc calls for:
 * "cap pending jobs per user, not round-robin claim" — `claimNext`
 * (audio-worker/src/claim.ts) is a single atomic `findOneAndUpdate` sorted
 * `createdAt` ascending across ALL users with no per-owner term, and nothing
 * across three phases has broken it, so bounding what one user can put INTO
 * that queue is the cheaper correct move over adding a fairness term to it.
 *
 * 20. The design's dropzone is per-file (each file is its own
 * `createAudioUpload` -> PUT -> `confirmAudioUpload` round trip), but
 * `AudioUploadDropzone`'s own doc comment states the realistic legitimate
 * burst this has to admit: uploads within one drop run SEQUENTIALLY, only
 * one batch runs at a time, and "GM upload sessions are 'drop a folder, wait,
 * drop the next,' not a firehose." A folder of ambience/SFX for a session is
 * the shape of burst this cap exists to let through — tens of files, not
 * hundreds. 20 admits that folder-sized drop with room to spare while still
 * meaningfully bounding the other side of the trade: with one worker
 * replica and a global FIFO claim, every job a flood occupies is a job every
 * OTHER user's asset waits behind, so the cap has to be small enough that a
 * single account's worst-case backlog is minutes, not hours, of head-of-line
 * blocking for everyone else.
 */
const DEFAULT_MAX_PENDING_JOBS_PER_USER = 20;

/**
 * `MAX_PENDING_JOBS_PER_USER`, read fresh on every call — same idiom as
 * `getAudioUserQuotaBytes` immediately above, for the identical reasons: a
 * value change takes effect on the next request with no re-import, and it is
 * guarded against the empty-string case Helm renders for an unset
 * `values.yaml` key (`Number('')` is `0`, not `NaN`, so `raw > 0` still has
 * to be the gate — a bare `Number.isFinite` check alone would admit it and
 * refuse every confirm for every user). Server env only, never
 * `VITE_PUBLIC_*` — see that function's comment for why.
 */
export function getMaxPendingJobsPerUser(): number {
  const raw = Number(process.env.MAX_PENDING_JOBS_PER_USER);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_PENDING_JOBS_PER_USER;
}

/**
 * The per-user queue-depth check, shared by every path that can move a row
 * into `pending`/`processing`: `confirmAudioUpload` (a new source),
 * `confirmOnceVariantUpload` (a once-variant source, Task 18), and
 * `retryAudioAsset` (requeueing a `failed` row). All three are doors into
 * the SAME bounded resource `getMaxPendingJobsPerUser` describes, so the
 * counting/threshold logic has exactly one definition. The cap originally
 * shipped on `confirmAudioUpload` alone — the entry point new uploads
 * enqueue through — but `confirmOnceVariantUpload` enqueues a fresh
 * transcode job the identical way, and `retryAudioAsset` pushes an
 * already-existing row back into `pending` one click at a time with no
 * depth check of its own (it IS rate-limited, by Task 2's
 * `audioIngestLimiter`, but a rate limit bounds how FAST a caller can act,
 * not how DEEP the queue they build gets — a caller patient enough to stay
 * under the rate limit could otherwise requeue every failed row they own,
 * unbounded). Left open, either door defeats the whole point of this cap:
 * one stranger putting unbounded work in front of everyone else on a
 * single-replica FIFO worker.
 *
 * Returns `null` when the caller has room to enqueue one more job.
 * Otherwise returns the numbers each call site needs to build ITS OWN
 * refusal — deliberately just numbers, not a thrown error and not a
 * side-effecting action: what happens next differs across the three
 * callers (an R2 object to delete or not, a row to revert to `failed` vs.
 * back to `ready` vs. left untouched entirely), so this function does
 * exactly one thing and each call site owns its own cleanup. See each call
 * site's comment for why its cleanup is shaped the way it is.
 *
 * Scoped `{ ownerId: userId, ... }` — never a bare status filter — for the
 * same reason every cap in this codebase is: an unscoped count would refuse
 * EVERY user once the GLOBAL queue reached the limit, a different (and
 * wrong) control than "one account cannot occupy more than N slots of it".
 *
 * `>=`, matching `assertUnderStorageQuota`/`assertPackageBudget`'s
 * deliberate boundary below: the count is read before the row that would
 * consume a slot actually lands, so a caller already AT the cap is refused
 * rather than landing exactly on it. Like those checks, this is a resource
 * bound, not an exact invariant, and the same slack `assertUnderStorageQuota`
 * documents applies here unmodified: two concurrent requests from the same
 * user can both read `count == max - 1` and both proceed, landing the user
 * one job over the cap — closing that with a transaction would cost more
 * than the one extra queued job it prevents.
 */
async function checkPendingJobCap(
  userId: string
): Promise<{ pendingCount: number; maxPendingJobs: number } | null> {
  const maxPendingJobs = getMaxPendingJobsPerUser();
  const pendingCount = await AudioAsset.countDocuments({
    ownerId: userId,
    status: { $in: ['pending', 'processing'] },
  });
  return pendingCount >= maxPendingJobs ? { pendingCount, maxPendingJobs } : null;
}

/**
 * The one wording every pending-job-cap refusal uses. `nextStep` differs
 * because the caller's remedy does: an ingest path tells them to stop
 * uploading, `retryAudioAsset` tells them to stop retrying.
 */
function pendingJobCapMessage(
  pendingCount: number,
  maxPendingJobs: number,
  nextStep: string
): string {
  return `Too many pending transcode jobs (${pendingCount} of ${maxPendingJobs} already queued). Wait for one to finish before ${nextStep}.`;
}

/**
 * The PRESIGN-side wrapper for the queue-depth cap — `checkPendingJobCap`
 * plus the throw, mirroring `assertUnderStorageQuota` below in both shape and
 * placement, because the cap has exactly the same reason to be checked twice
 * that the quota does.
 *
 * WHY THE PRESIGNS TOO, when the confirms already check it. The confirm-side
 * check is the one that is load-bearing for correctness — it is the last
 * gate before a row becomes claimable, and it sees a count that cannot have
 * gone stale. But by the time it runs the caller has ALREADY uploaded the
 * whole file, so its refusal has to destroy bytes that are already in R2.
 * That is the same argument `checkStorageQuota`'s doc comment makes for
 * keeping the quota's presign check ("a user already over quota never spends
 * bandwidth on an upload that is going to be deleted anyway"), and it applies
 * to this control unchanged. It was previously made for one of the two
 * limits and not the other.
 *
 * Concretely, with the shipped defaults: a GM dropping a folder of 30 files
 * gets past `audioIngestLimiter` (capacity 60 — sized, in that module's own
 * comment, for exactly a 30-file drop), and the single-replica worker drains
 * only a handful in that window. Without this check, files 21 onward each
 * uploaded in full and were then deleted at confirm, one destroyed file per
 * refusal. With it, file 21's PRESIGN is refused before a byte moves, and
 * the message tells the GM to wait rather than handing them nine failed rows
 * and a folder to re-drop.
 *
 * The two limits still measure different things (calls per second vs. jobs in
 * flight) and cannot be made to agree by tuning either number — which is why
 * this is a placement fix rather than a new default.
 */
async function assertUnderPendingJobCap(userId: string, nextStep: string): Promise<void> {
  const cap = await checkPendingJobCap(userId);
  if (cap) {
    // AudioClientError: the caller's own doing, reachable at will, so it must
    // file no GlitchTip event — same shape as every other cap/quota refusal.
    throw new AudioClientError(
      pendingJobCapMessage(cap.pendingCount, cap.maxPendingJobs, nextStep)
    );
  }
}

/** The one wording every quota refusal on this surface uses, presign or confirm. */
function storageQuotaMessage(usageBytes: number, limitBytes: number): string {
  return `Storage quota exceeded: ${usageBytes} of ${limitBytes} bytes used. Delete an asset to make room.`;
}

/**
 * The storage-quota measurement, shared by all FOUR entry points that can
 * add bytes to a user's footprint: the two that presign an upload via
 * `getAudioUploadUrl` (`createAudioUpload`, `createOnceVariantUpload`) and
 * the two that make those bytes countable (`confirmAudioUpload`,
 * `confirmOnceVariantUpload`).
 *
 * Returns `null` when the caller is under quota. Otherwise returns the two
 * numbers each call site needs to build ITS OWN refusal — deliberately just
 * numbers, exactly like `checkPendingJobCap` above and for the identical
 * reason: what a refusal has to clean up differs per caller (nothing at all
 * at presign time, since no object exists yet; an R2 object plus a fenced
 * row write at confirm time — and the two confirms revert to DIFFERENT
 * states). So this function measures, and each call site owns its cleanup.
 *
 * WHY THE CONFIRMS TOO, when a presign-time check reads as sufficient.
 * Bytes only become COUNTABLE at confirm: `sourceBytes` and
 * `onceSourceBytes` are written by the success writes below and nowhere
 * else, so a presign-time check reads a number that cannot include anything
 * the caller has already presigned and PUT. The check and the byte-landing
 * are in DIFFERENT requests separated by a client-controlled delay, so with
 * a presign-only gate the overshoot is bounded by how many presigns a caller
 * can hold open, not by concurrency. Concretely, with the shipped defaults
 * and no concurrency at all: spend 30 `audioIngestLimiter` tokens on
 * `createAudioUpload`, PUT 50 MiB to each (every check sees usage unchanged,
 * because nothing has confirmed), then spend the other 30 on
 * `confirmAudioUpload` — usage goes from 0 to ~30 x 126 MB, roughly 3.8 GB
 * against a 2 GiB quota, before the next presign is refused. Checking again
 * at confirm reduces that to one accepted request's footprint (see the
 * boundary comment below).
 *
 * The presign check still earns its place: it is the only one that can
 * refuse BEFORE an object exists in R2, so a user already over quota never
 * spends bandwidth on an upload that is going to be deleted anyway, and the
 * E2E suite (deliberately fake R2 credentials) can only tell a quota refusal
 * apart from a credentials failure because that refusal never reaches the
 * presign step.
 *
 * WHERE EACH CALLER MUST PUT IT. The presign pair: before
 * `getAudioUploadUrl`, the only R2-touching step either takes, so a refusal
 * leaves nothing to reclaim. The confirm pair: before `HeadObject`, for the
 * mirror-image reason `checkPendingJobCap` is checked there — a refusal then
 * costs no outbound R2 call beyond the delete it has to perform anyway.
 *
 * BOTH once-variant halves are on this check, not just the main pair,
 * because Task 3b deliberately made `onceSourceBytes` the sixth term in
 * `getUserStorageUsage`'s aggregation specifically so once-variant bytes
 * COUNT toward this quota (`app/server/functions/audio-quota.ts`). Gating
 * only the paths that create the FIRST five terms' bytes would mean the
 * quota counts bytes it never enforced against — the exact hole Task 3b
 * closed on the read side, reopened on the write side: a user sitting
 * exactly at the limit could still attach a once-variant (its own source
 * plus opus/aac renditions, ~126 MB at the design doc's figure) to every
 * `music` asset they own, roughly doubling the effective ceiling for a
 * music-heavy library.
 *
 * THROWS on exactly one path — when the aggregation itself fails (fail
 * closed, see below). Every other outcome is a return value. At the two
 * confirms that throw deliberately performs NO cleanup: the row stays
 * `uploading` and the object stays in R2, because a Mongo/index fault is
 * transient and a retried confirm succeeds once it clears, whereas deleting
 * a good object over a blip would destroy an upload the user could still
 * have completed. If they never retry, the worker's reaper reclaims both,
 * which is the same path an abandoned upload already takes.
 *
 * `action` distinguishes which caller is asking, purely for the telemetry
 * tag on a fail-closed capture — each caller passes its own name, producing
 * the `'<name>.quotaCheck'` action string this check has always used.
 *
 * Not exported: this module's four ingest functions are its only callers,
 * and this module is reached only via `await import(...)` from server-fn
 * handlers and two server-only API routes (see the module comment in
 * `~/utils/audio-server-fns.ts`), so there is no reason to widen this
 * file's public surface for it.
 */
async function checkStorageQuota(
  actor: Actor,
  action: string
): Promise<{ usageBytes: number; limitBytes: number } | null> {
  const limitBytes = getAudioUserQuotaBytes();
  let usage: AudioStorageUsage;
  try {
    usage = await getUserStorageUsage(actor.userId);
  } catch (e) {
    // FAIL CLOSED. An aggregation that cannot be measured is refused, not
    // admitted — the easy bug here is a `catch` that logs and continues,
    // which quietly turns the quota into a suggestion.
    //
    // This failure IS reported to GlitchTip, unlike the `AudioClientError`
    // thrown right below — deliberately, and for a different reason than
    // every other capture this file skips. Every other `AudioClientError`
    // here refuses something the CALLER did (a guessable not-found, a rate
    // limit, a resource cap) and is reachable by that caller at will, so
    // reporting it would make report volume an attacker's parameter. An
    // aggregation failure is the opposite: no request shape triggers it on
    // demand, it is a genuine Mongo/index/connection fault, and it
    // silently blocks every upload for this user — for every user, if
    // systemic — until someone notices. Swallowing it here would make
    // quota enforcement's own failure mode invisible. So the UNDERLYING
    // fault is captured once, right here, while the REFUSAL that reaches
    // the caller stays an `AudioClientError` — whether the fault deserves a
    // report and whether the outward rejection may amplify are separate
    // questions, and this answers them differently on purpose.
    void serverCaptureException(e, telemetryId(actor), { action: `${action}.quotaCheck` });
    throw new AudioClientError(
      'Unable to verify your storage usage right now. Please try again shortly.'
    );
  }

  // `>=`, matching `assertPackageBudget`'s deliberate choice for
  // `MAX_PACKAGES_PER_USER` (`~/server/functions/packages.ts`): usage is
  // measured BEFORE this request's bytes land, so a caller already AT the
  // limit is refused rather than allowed to land exactly on it.
  //
  // THE RESIDUAL, stated honestly. With the confirm-side check in place the
  // worst-case overshoot is ONE accepted request's eventual total footprint:
  // the confirm that passes this check is measuring a source that is ALREADY
  // in R2 (up to `AUDIO_MAX_BYTES`, 50 MiB), and the worker will then produce
  // the opus/aac renditions from it — ~126 MB per the design doc's own
  // measurement. It cannot be made airtight with a transaction either: at
  // presign time the incoming file's declared `data.bytes` is
  // client-controlled and unverified until confirm's own `HeadObject`
  // measures it (see the comment on `sourceBytes` in `createAudioUpload`
  // below), so it is not part of this boundary check.
  //
  // The earlier version of this comment likened that slack to "the same shape
  // two concurrent package creates can produce" in `assertPackageBudget`.
  // That analogy was wrong and is gone: `assertPackageBudget` counts and
  // inserts inside ONE request, so concurrency there buys `+1`, whereas here
  // the check and the byte-landing sat in DIFFERENT requests separated by a
  // client-controlled delay — a residual bounded by open presigns rather than
  // by concurrency, and orders of magnitude larger. Gating the confirms is
  // what makes the "one request's footprint" claim true; see this function's
  // doc comment for the arithmetic it used to admit.
  //
  // What remains INVISIBLE to this number, deliberately: bytes a caller has
  // presigned and PUT but not yet confirmed. Nothing writes `sourceBytes`/
  // `onceSourceBytes` until confirm, so those objects are real R2 storage the
  // quota cannot see for up to the worker's `UPLOAD_TIMEOUT_MS` (15 min by
  // default), after which `reapAbandonedUploads`/`reapAbandonedOnceUploads`
  // delete them. Transient per object, steady-state in aggregate — and the
  // ONLY thing bounding it is `audioIngestLimiter`. The pending-job cap does
  // not: it counts `pending`/`processing`, and an unconfirmed row is
  // `uploading`. See `DEFAULT_AUDIO_USER_QUOTA_BYTES` above for the
  // arithmetic and for what an operator tuning the knob has to know.
  if (usage.bytes >= limitBytes) {
    return { usageBytes: usage.bytes, limitBytes };
  }
  return null;
}

/**
 * The presign-side wrapper: `checkStorageQuota` plus the throw, because
 * neither presigning caller has anything to clean up before refusing — no
 * R2 object exists yet, and no row has been created or claimed. The two
 * CONFIRM callers deliberately do not use this: each has an object to delete
 * and a fenced row write to perform first, and those differ per path.
 */
async function assertUnderStorageQuota(actor: Actor, action: string): Promise<void> {
  const over = await checkStorageQuota(actor, action);
  if (over) {
    throw new AudioClientError(storageQuotaMessage(over.usageBytes, over.limitBytes), {
      usageBytes: over.usageBytes,
      limitBytes: over.limitBytes,
    });
  }
}

/**
 * Every reject path in BOTH confirms: take the row with a fenced write, and
 * delete the uploaded object ONLY if that write actually matched.
 *
 * ORDER IS THE WHOLE POINT, and it used to be the other way round. Each of
 * these six branches deleted the R2 object first and then issued a fenced
 * `findOneAndUpdate` whose result was discarded. The fence stopped a stale
 * refusal from STAMPING a row a concurrent request had legitimately moved
 * on — but the delete had already run unconditionally, so the losing racer
 * destroyed the winner's live source object anyway. The row's status was
 * protected; the bytes it pointed at were not.
 *
 * That is reachable without unusual timing, because the state these branches
 * key on is one a concurrent request CREATES. Two confirms for the same asset
 * (a double-click, or a client retry after a slow response) both read the row
 * as `uploading`. Request A passes the cap check, passes quota, and its
 * success write lands — which is exactly what takes the caller to the cap, or
 * what writes the `sourceBytes` that takes them over quota. Request B's check
 * then runs against A's own effect, refuses, and deletes the object A just
 * confirmed. The row stays a perfectly healthy-looking `pending` pointing at a
 * key that no longer exists in R2; the worker claims it, the download 404s,
 * three attempts burn, and it lands in `failed` with `retryable: true` — so
 * every Retry click buys three more worker passes against an object that can
 * never exist. The user is never told, at the moment it happens, that their
 * upload was destroyed.
 *
 * A matched write is the authorization to delete. This is not a new idea
 * here: `reapAbandonedUploads` (audio-worker/src/claim.ts) has always worked
 * this way, and says so — "only a matched write authorizes deleting the
 * object", which is why it writes row-at-a-time instead of one `updateMany`.
 * The same rule now holds on this side of the wire.
 *
 * The delete is BEST EFFORT and never changes what the caller sees. The row
 * transition is the part that must not be lost; a stranded object is
 * reclaimable by `~/server/functions/audio-cleanup.ts` on a later sweep,
 * whereas a thrown R2 error here would replace the refusal message the caller
 * needs ("you are over quota") with an S3 fault they can do nothing about.
 * Each failure is still reported, so a systematically failing delete shows up
 * in GlitchTip rather than quietly accruing storage cost — same treatment,
 * and the same reasoning, as `deleteAudioAsset`'s own R2 loop.
 *
 * Returns nothing: every caller throws its own `AudioClientError` (or plain
 * `Error`) immediately afterwards, and what that error says differs per
 * branch.
 */
async function fenceThenReclaim({
  filter,
  set,
  key,
  r2,
  actor,
  action,
}: {
  filter: Record<string, unknown>;
  set: Record<string, unknown>;
  key: string;
  // Only the two fields the delete needs, so callers can pass the pair they
  // already destructured for `HeadObject` rather than re-invoking `createR2`.
  r2: Pick<ReturnType<typeof createR2>, 'client' | 'bucket'>;
  actor: Actor;
  action: string;
}): Promise<void> {
  const claimed = await AudioAsset.findOneAndUpdate(filter, { $set: set });
  // The fence did not match: a concurrent request already moved this row on,
  // and the object now belongs to whatever it moved on to. Touch neither.
  if (!claimed) return;

  try {
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
  } catch (e) {
    void reportAudioError(e, actor, { action: `${action}.reclaim`, key });
  }
}

export async function createAudioUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof createAudioUploadSchema>;
} & Actor) {
  try {
    await ensureDb();

    // Both limits enforced FIRST, before `resolveAudioStoragePrefix` and
    // before the presign — see `assertUnderStorageQuota` and
    // `assertUnderPendingJobCap` for the full reasoning, shared verbatim
    // with `createOnceVariantUpload` below. The cap is checked here as well
    // as at confirm for the same reason the quota is: this is the only point
    // at which either can refuse before the caller spends bandwidth on an
    // upload that is going to be thrown away.
    await assertUnderPendingJobCap(userId, 'uploading more');
    await assertUnderStorageQuota({ userId, sessionUserId }, 'createAudioUpload');

    // Mints the user's R2 namespace if this is their first upload, and returns
    // the existing one otherwise — see `./audio-storage.ts`. It runs before the
    // presign because the key cannot be built without it, and before the row is
    // created so a user whose prefix cannot be resolved gets an error instead
    // of an asset pointing at a key nothing owns.
    const storagePrefix = await resolveAudioStoragePrefix(userId);
    const { uploadUrl, key } = await getAudioUploadUrl({
      contentType: data.contentType,
      bytes: data.bytes,
      storagePrefix,
      telemetryUserId: telemetryId({ userId, sessionUserId }),
    });

    const doc = await AudioAsset.create({
      ownerId: userId,
      title: data.title ?? titleFromFilename(data.filename),
      kind: data.kind,
      environment: data.environment ?? [],
      mood: data.mood ?? [],
      intensity: data.intensity ?? null,
      tags: data.tags ?? [],
      sourceKey: key,
      // Both explicitly null, and both must stay that way until confirm.
      // `sourceBytes` used to be seeded here from `data.bytes` — the client's
      // self-declared size, which nothing has verified and which the uploader
      // is free to lie about. Storing it made the field read as "this object is
      // N bytes" when it only ever meant "the uploader claimed N". The real
      // size arrives from confirm's HeadObject, and until then "unknown" is the
      // honest value. `confirmedAt` is the flag that says the check happened.
      sourceBytes: null,
      confirmedAt: null,
      status: 'uploading',
    });

    return { assetId: String(doc._id), uploadUrl, key };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'createAudioUpload' });
    throw e;
  }
}

export async function confirmAudioUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof confirmAudioUploadSchema>;
} & Actor) {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new AudioClientError('Audio asset not found');
    // Confirm is only meaningful for a row still awaiting its upload. Without
    // this precondition a logged-in user could replay confirm against an
    // already-`ready` asset to flip it back to `pending` and make the worker
    // re-transcode it — in a loop, on a single-node cluster. The check sits
    // ahead of the HeadObject/DeleteObject block on purpose: a replay must
    // never be able to delete the R2 object of a finished asset. The
    // `failed -> pending` transition belongs to `retryAudioAsset`, which owns
    // resetting the attempt budget with it.
    //
    // `variant !== 'once'` too — Task 18 nit fix, symmetric with the
    // worker's reaper split (`reapAbandonedUploads` vs
    // `reapAbandonedOnceUploads` in audio-worker/src/claim.ts). Without it
    // this precondition alone can't tell a genuine main upload apart from a
    // row that's `status: 'uploading'` because `createOnceVariantUpload`
    // put it there — this function only ever measures/confirms
    // `sourceKey`, never `onceSourceKey`, so confirming a once-attach here
    // would flip a row still carrying `variant: 'once'` to `pending`, and
    // the worker's `processAsset` would then run the ONCE pipeline against
    // whatever `onceSourceKey` happens to be at that moment — possibly
    // unset, if the browser's PUT to the once URL hasn't landed yet. Not a
    // data-loss path (an empty/wrong `onceSourceKey` fails through
    // `markOnceFailed` back to `ready`, same as any other once-variant
    // failure) and not reachable from the UI (nothing calls
    // `confirmAudioUpload` for an assetId mid-once-attach), but there is no
    // reason for this function to accept a row it was never meant to touch.
    if (asset.status !== 'uploading' || asset.variant === 'once') {
      throw new Error('Audio asset is not awaiting confirmation');
    }

    const { client, bucket } = createR2();

    // The per-user queue-depth bound (see `checkPendingJobCap`'s doc
    // comment for the shared counting logic and `getMaxPendingJobsPerUser`
    // for the default) — checked HERE, before `HeadObject`, because this is
    // "the point where a row becomes claimable": nothing before this line
    // can put a row into `pending`/`processing`, and everything after it is
    // building toward exactly that. Checking before `HeadObject` also means
    // a caller already at the cap is refused without spending an R2 round
    // trip on an object that is about to be rejected regardless of what it
    // turns out to be.
    const cap = await checkPendingJobCap(userId);
    if (cap) {
      const reason = pendingJobCapMessage(cap.pendingCount, cap.maxPendingJobs, 'uploading more');
      // FENCE FIRST, THEN RECLAIM — see `fenceThenReclaim`'s doc comment for
      // why this order is the load-bearing part and what the previous order
      // (delete unconditionally, then fence a write nobody read the result
      // of) destroyed. In short: the row this path means to fail is by
      // definition still `uploading` and still not the once pipeline's, so a
      // concurrent confirm that legitimately queued it makes this write a
      // no-op — and the object then belongs to THAT request, not this one.
      //
      // The object does still have to be reclaimed when the fence DOES
      // match: it already exists in R2 (the browser's PUT to the presigned
      // URL landed), nothing will ever reference it again, and the orphan
      // scanner is otherwise the only path back, on a later manual sweep.
      await fenceThenReclaim({
        filter: {
          _id: data.assetId,
          ownerId: userId,
          status: 'uploading',
          variant: { $ne: 'once' },
        },
        set: { status: 'failed', lastError: reason, updatedAt: new Date() },
        key: asset.sourceKey,
        r2: { client, bucket },
        actor: { userId, sessionUserId },
        action: 'confirmAudioUpload.pendingJobCap',
      });
      // AudioClientError: this is the caller's own doing (they queued more
      // than their share) and is reachable at will by uploading and
      // confirming repeatedly, so it must not file a GlitchTip event — same
      // shape as `assertUnderStorageQuota`'s refusal. The count is embedded
      // in the message so the caller knows to wait rather than retry
      // immediately.
      throw new AudioClientError(reason);
    }

    // The storage quota, checked HERE as well as at presign — see
    // `checkStorageQuota`'s doc comment for why a presign-only gate reads a
    // number that cannot include anything the caller has already presigned
    // and PUT, and for the overshoot that admits. Placed before
    // `HeadObject` for the same reason the cap check above is: a refusal
    // then costs no outbound R2 call beyond the delete it must perform
    // anyway.
    const quota = await checkStorageQuota({ userId, sessionUserId }, 'confirmAudioUpload');
    if (quota) {
      const reason = storageQuotaMessage(quota.usageBytes, quota.limitBytes);
      // Fence-then-reclaim, exactly as the cap refusal above — and this is
      // the branch where the old delete-first order was easiest to reach,
      // because a concurrent confirm's own success write is what sets the
      // `sourceBytes` that takes this caller over the limit. Request A lands,
      // request B measures A's effect, refuses, and used to delete A's
      // freshly-confirmed object. See `fenceThenReclaim`.
      //
      // `status: 'failed'` and NOT `permanentFailure`: this row is a fresh
      // upload with nothing else at stake (unlike `confirmOnceVariantUpload`,
      // whose row is an existing playable asset — see its own refusal), so
      // failing it is right; but unlike the tooLarge/badType branch below,
      // re-uploading the same file AFTER deleting something else succeeds,
      // which is the opposite of what `permanentFailure` means.
      await fenceThenReclaim({
        filter: {
          _id: data.assetId,
          ownerId: userId,
          status: 'uploading',
          variant: { $ne: 'once' },
        },
        set: { status: 'failed', lastError: reason, updatedAt: new Date() },
        key: asset.sourceKey,
        r2: { client, bucket },
        actor: { userId, sessionUserId },
        action: 'confirmAudioUpload.storageQuota',
      });
      // AudioClientError carrying both figures, exactly like the presign
      // refusal: the caller's own doing, reachable at will, so it must file
      // no GlitchTip event, and the UI can render "X of Y used" from the
      // structured pair rather than re-parsing the message.
      throw new AudioClientError(reason, {
        usageBytes: quota.usageBytes,
        limitBytes: quota.limitBytes,
      });
    }

    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.sourceKey }));

    const bytes = head.ContentLength ?? 0;
    const type = head.ContentType ?? '';
    const tooLarge = bytes > AUDIO_MAX_BYTES;
    const badType = !AUDIO_SOURCE_TYPES.has(type);

    if (tooLarge || badType) {
      const reason = tooLarge
        ? `File too large: ${bytes} bytes exceeds ${AUDIO_MAX_BYTES}`
        : `Unsupported audio type: ${type}`;
      // FENCED, with exactly the clauses the success write below carries, and
      // for exactly the same reason its comment gives: "only the filter on
      // the write makes exactly one of them win." This one is the more
      // dangerous of the three reject branches to leave open, because it
      // writes `permanentFailure: true` and `retryAudioAsset` refuses those
      // rows — an unfenced version has no path back.
      //
      // The interleave, one client: confirm a refused blob; while THIS
      // request is between its own HeadObject and its write, re-PUT good
      // audio to the same presigned URL (valid 300s, reusable) and confirm
      // again. Request #2's fenced success write wins — the row is now a
      // legitimately queued `pending` asset, or a `ready` one if the worker
      // got there first — and this request's write correctly matches
      // nothing. Under the OLD order it had also already deleted the GOOD
      // object by that point; `fenceThenReclaim` is what stops that, by
      // making the matched write the authorization to delete rather than
      // deleting first and fencing afterwards.
      await fenceThenReclaim({
        filter: {
          _id: data.assetId,
          ownerId: userId,
          status: 'uploading',
          variant: { $ne: 'once' },
        },
        set: {
          status: 'failed',
          lastError: reason,
          // PERMANENT, and it has to be stamped rather than inferred. Both
          // rejections above are decisions about the OBJECT — it was
          // HeadObject'd and measured, and it was refused for what it is.
          // Re-uploading the same file produces the same two numbers and the
          // same refusal, so this is exactly what `permanentFailure` means
          // (see errors.ts in the worker).
          //
          // Without it the row reads as "never confirmed" — `retryable` is
          // false either way because `confirmedAt` is null, but the UI's
          // advice comes from `permanentFailure`, and the un-stamped row got
          // "this upload never completed; upload the file again". That is
          // wrong twice: the upload DID complete, and uploading it again
          // fails identically.
          permanentFailure: true,
          updatedAt: new Date(),
        },
        key: asset.sourceKey,
        r2: { client, bucket },
        actor: { userId, sessionUserId },
        action: 'confirmAudioUpload.rejected',
      });
      throw new Error(reason);
    }

    // `status: 'uploading'` again, and atomically this time: the read above can
    // race a concurrent confirm for the same asset, and only the filter on the
    // write makes exactly one of them win. `variant: { $ne: 'once' }` closes
    // the same race the JS-level check above closes for the READ: a
    // concurrent `createOnceVariantUpload` could flip `variant` to `'once'`
    // in the window between this function's `findOne` and this write.
    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId, status: 'uploading', variant: { $ne: 'once' } },
      {
        $set: {
          status: 'pending',
          // The HeadObject-measured size, and the stamp saying it was measured.
          // This is the ONLY place either is written; `retryAudioAsset` relies
          // on that.
          sourceBytes: bytes,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updated) throw new Error('Audio asset is not awaiting confirmation');

    void serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'audio_upload_confirmed', {
      assetId: data.assetId,
    });
    return { assetId: data.assetId, status: updated.status ?? 'pending' };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'confirmAudioUpload' });
    throw e;
  }
}

/**
 * Task 18: presign a source upload for an EXISTING `music` asset's
 * once-variant (the composed-ending encode the board's `1×` position plays
 * — see the design doc's "Music variants"). Attaches to the SAME
 * `AudioAsset` row rather than creating a new one, because `onceRenditions`
 * has to land on the same document as `renditions` for `BoardPad`'s
 * `asset.onceRenditions` check (Task 16) to ever see it — a second document
 * could never be joined back to the first from the client's read model.
 *
 * Reuses the row's status/attempts/claim queue state for this second job
 * (see `variant` on the model). The `status: 'ready'` filter on the write
 * below does double duty: it refuses to attach onto audio that hasn't
 * finished its own transcode yet (nothing to pair a once-variant with), and
 * it is the replay guard — once this write flips status away from 'ready',
 * a second, concurrent attach request's identical filter matches nothing,
 * the same technique `confirmAudioUpload`'s `status: 'uploading'` filter
 * uses.
 *
 * `attempts: 0` is explicit, not incidental: `attempts` otherwise carries
 * over from whatever the MAIN pipeline last left it at, so a main asset that
 * needed 2 of its 3 attempts to transcode would hand its once job only 1
 * retry before `MAX_ATTEMPTS`. A once job is a fresh unit of work and gets
 * the full budget. `nextAttemptAt: null` for the same reason, from the other
 * side: a once job that previously failed and requeued (still within
 * budget, still `variant: 'once'`) can leave a FUTURE backoff timestamp
 * behind, and a fresh attach must not inherit an old job's delay —
 * `claimNext`'s filter would otherwise silently hold this brand-new attach
 * back for up to the backoff cap (5 minutes by default).
 *
 * Re-attaching (the row already has an `onceSourceKey` from a prior attach,
 * successful or not) mints a NEW key rather than reusing the old one — and
 * the old object is deleted, best-effort, once the row points at its
 * replacement. Without this a user who attaches, then attaches again with a
 * better file, strands the first once-variant's source object: nothing
 * references it (the row's `onceSourceKey` has moved on), and unlike the
 * main `sourceKey` — which is minted exactly once per asset — a once-attach
 * can happen any number of times, so this is not a one-off gap.
 */
export async function createOnceVariantUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof attachOnceVariantUploadSchema>;
} & Actor) {
  try {
    await ensureDb();

    // Both enforced FIRST, same as `createAudioUpload` and for the same
    // reasons — see `assertUnderPendingJobCap` and `assertUnderStorageQuota`.
    // The quota is the path Task 3b's `onceSourceBytes` aggregation term
    // exists to gate: without it, a caller already at the quota could still
    // attach a once-variant (its own source plus renditions) to every `music`
    // asset they own. The cap is here because a once-attach enqueues transcode
    // work exactly like a source upload does, so refusing at presign spares
    // the caller an upload that confirm was going to refuse anyway — and, for
    // this path specifically, spares the ROW: the attach write below flips an
    // existing, previously-`ready` asset into `uploading`, so an attach that
    // is doomed at confirm takes a playable asset out of service for the
    // round trip.
    await assertUnderPendingJobCap(userId, 'attaching another once-variant');
    await assertUnderStorageQuota({ userId, sessionUserId }, 'createOnceVariantUpload');

    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new AudioClientError('Audio asset not found');
    if (asset.kind !== 'music') {
      throw new Error('Only music assets can have a once-variant attached');
    }
    if (asset.status !== 'ready') {
      throw new Error('This asset must finish processing before a once-variant can be attached');
    }
    const previousOnceSourceKey = asset.onceSourceKey;

    const storagePrefix = await resolveAudioStoragePrefix(userId);
    const { uploadUrl, key } = await getAudioUploadUrl({
      contentType: data.contentType,
      bytes: data.bytes,
      storagePrefix,
      telemetryUserId: telemetryId({ userId, sessionUserId }),
    });

    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId, status: 'ready' },
      {
        $set: {
          onceSourceKey: key,
          // Paired with `onceSourceKey` above: the bytes field describes the
          // object the key points at, and the key just moved to a brand-new,
          // not-yet-confirmed object. Leaving the OLD measurement standing
          // would misattribute it to a key that no longer exists — the exact
          // "stale field describes destroyed bytes" bug the `onceRenditions:
          // {}` clear below exists to prevent, applied to this field's own
          // sibling. `confirmOnceVariantUpload`'s success write is the only
          // place this is ever set to a real number again, once THIS attach's
          // object is actually measured.
          onceSourceBytes: null,
          // CLEARED, not left standing. The once rendition keys are
          // DETERMINISTIC per asset (`${base}.once.${ext}` —
          // `renditionKeyBase`'s callers in audio-worker/src/process.ts), and
          // the worker PUTs both objects BEFORE it writes the row. So the
          // moment a second attach's job runs, it overwrites attach #1's live
          // objects in place — the bytes behind these keys are already gone,
          // whatever this field still says. If that job then fails partway
          // (one R2 blip on the second PUT, an evicted pod), `markOnceFailed`
          // reverts the row to `ready` still pointing here, and the asset
          // serves attach #2's audio to a browser that picks `.opus` and
          // attach #1's to one that picks `.aac`, with `bytes`/`durationMs`
          // describing neither. Nothing detects it and nothing reports it.
          //
          // `markOnceFailed`'s stated contract is "leave the row exactly as it
          // was before the attach". Clearing here does not break that promise
          // — it makes it TRUE. Before this line the promise was unkeepable:
          // "as it was before the attach" named two R2 objects the attach had
          // already destroyed. A cleared field means the GM sees "no
          // once-variant attached" and can re-attach, which is exactly the
          // recoverable state; the previous behaviour was an asset that
          // claimed a once-variant it could no longer play correctly.
          onceRenditions: {},
          variant: 'once',
          status: 'uploading',
          attempts: 0,
          // A previously-failed once run can leave a FUTURE nextAttemptAt
          // behind (requeueForRetry's backoff gate) even though this is a
          // brand-new attach, not a retry of that old job — without
          // clearing it, claimNext's `{ nextAttemptAt: null } | { $lte:
          // now }` filter would silently delay this attach's first claim
          // by up to the backoff cap (5 minutes by default).
          nextAttemptAt: null,
          // The once reaper's clock, and the ONLY write in either package
          // that sets it — see `onceUploadStartedAt` on the model for the
          // full argument. In short: this write is the only way a row can
          // enter `status: 'uploading', variant: 'once'`, so it is the only
          // write that starts an attach, so it is the only one entitled to
          // say when the current attach began. `updatedAt` below cannot
          // stand in for it, because `updateAudioAsset` and
          // `bulkTagAudioAssets` bump `updatedAt` on any row their owner
          // edits, which pushed the reap of a dead attach out indefinitely.
          onceUploadStartedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updated) {
      throw new Error('This asset is not ready to accept a once-variant right now');
    }

    // Best-effort, and only after the row is safely pointed at the NEW key —
    // an R2 outage here must not fail the attach, and deleting before the
    // write would risk destroying the only object a failed write still
    // references.
    if (previousOnceSourceKey) {
      try {
        const { client, bucket } = createR2();
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: previousOnceSourceKey }));
      } catch (e) {
        void reportAudioError(
          e,
          { userId, sessionUserId },
          {
            action: 'createOnceVariantUpload.replacedOnceSource',
            assetId: data.assetId,
            key: previousOnceSourceKey,
          }
        );
      }
    }

    return { assetId: data.assetId, uploadUrl, key };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'createOnceVariantUpload' });
    throw e;
  }
}

/**
 * Confirm step for the once-variant upload. Mirrors `confirmAudioUpload`
 * exactly — same HeadObject size/type enforcement, for the same reason (a
 * presigned PUT cannot constrain Content-Length). The only differences are
 * WHICH key is measured (`onceSourceKey`, not `sourceKey`) and which
 * transition it gates (`uploading` + `variant: 'once'` -> `pending`, so the
 * worker's claim query picks the row back up).
 */
export async function confirmOnceVariantUpload({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof confirmOnceVariantUploadSchema>;
} & Actor) {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.assetId, ownerId: userId });
    if (!asset) throw new AudioClientError('Audio asset not found');
    if (asset.status !== 'uploading' || asset.variant !== 'once' || !asset.onceSourceKey) {
      throw new Error('Once-variant asset is not awaiting confirmation');
    }

    const { client, bucket } = createR2();

    // The same per-user queue-depth bound `confirmAudioUpload` checks, and
    // for the identical reason: this is the point where a once-variant job
    // becomes claimable (the success write below flips `status` to
    // `pending`), so it is checked before `HeadObject` for the same
    // "don't pay for a round trip you're about to refuse anyway" reason.
    // See `checkPendingJobCap`'s doc comment for why this function is one
    // of three doors into the same bounded resource and cannot be left
    // uncapped just because the brief that introduced this control named
    // `confirmAudioUpload` specifically.
    //
    // The refusal below is NOT a copy of `confirmAudioUpload`'s: THIS
    // row is an existing, previously-`ready` `music` asset borrowing its
    // `status` field for the once-attach's own state machine — see the
    // `tooLarge`/`badType` branch immediately below for why writing
    // `status: 'failed'` here would brick that asset rather than merely
    // failing a fresh row. A cap refusal reverts the SAME way that branch
    // does: back to `ready`/`main`, with the once-source object gone and
    // the reason recorded on `onceLastError`, not `lastError`.
    const cap = await checkPendingJobCap(userId);
    if (cap) {
      const reason = pendingJobCapMessage(cap.pendingCount, cap.maxPendingJobs, 'uploading more');
      // Fence-then-reclaim — see `fenceThenReclaim`. A concurrent confirm for
      // the SAME once-attach could complete before this write; the fence
      // makes this a no-op then, and the once-source object belongs to that
      // request rather than being destroyed by this one. When the fence DOES
      // match, the object must be reclaimed: it already exists in R2 (the
      // browser's PUT landed) and nothing will reference it again.
      await fenceThenReclaim({
        filter: { _id: data.assetId, ownerId: userId, status: 'uploading', variant: 'once' },
        set: {
          status: 'ready',
          variant: 'main',
          onceSourceKey: null,
          // Paired with `onceSourceKey` above — see `createOnceVariantUpload`'s
          // identical reset for why a cleared key must never leave a stale
          // byte count standing.
          onceSourceBytes: null,
          onceLastError: reason,
          updatedAt: new Date(),
        },
        key: asset.onceSourceKey,
        r2: { client, bucket },
        actor: { userId, sessionUserId },
        action: 'confirmOnceVariantUpload.pendingJobCap',
      });
      // AudioClientError: the caller's own doing, reachable at will, must
      // not file a GlitchTip event — same shape as every other cap/quota
      // refusal in this file.
      throw new AudioClientError(reason);
    }

    // The storage quota, checked here for the same reason `confirmAudioUpload`
    // checks it — see `checkStorageQuota`'s doc comment — and before
    // `HeadObject` for the same reason the cap check above is.
    //
    // This path matters as much as the main one rather than less: Task 3b put
    // `onceSourceBytes` into the usage aggregation precisely so a once-source
    // counts, and this is the write that first makes it countable.
    const quota = await checkStorageQuota({ userId, sessionUserId }, 'confirmOnceVariantUpload');
    if (quota) {
      const reason = storageQuotaMessage(quota.usageBytes, quota.limitBytes);
      // REVERTS, it does not fail — the difference from `confirmAudioUpload`'s
      // quota refusal, and the same difference the cap refusal above and the
      // tooLarge/badType branch below both carry. This row is the MAIN
      // asset's own document, a fully-transcoded `music` asset that was
      // `ready` before the attach started; writing `status: 'failed'` here
      // would brick it (`retryAudioAsset` refuses `permanentFailure`,
      // `createOnceVariantUpload` refuses a non-`ready` row). So: back to
      // `ready`/`main`, once-source key and bytes cleared together, reason on
      // `onceLastError` rather than `lastError`.
      //
      // Fenced on `variant: 'once'` EXACT (not `$ne`), matching the two
      // writes around it: only a row still mid-attach may be reverted, so a
      // stale refusal that resumes after the user started a second attach is
      // a no-op instead of silently cancelling that fresh attach — and, via
      // `fenceThenReclaim`, is a no-op for that fresh attach's OBJECT too.
      await fenceThenReclaim({
        filter: { _id: data.assetId, ownerId: userId, status: 'uploading', variant: 'once' },
        set: {
          status: 'ready',
          variant: 'main',
          onceSourceKey: null,
          onceSourceBytes: null,
          onceLastError: reason,
          updatedAt: new Date(),
        },
        key: asset.onceSourceKey,
        r2: { client, bucket },
        actor: { userId, sessionUserId },
        action: 'confirmOnceVariantUpload.storageQuota',
      });
      // AudioClientError carrying both figures — same reasoning as the main
      // confirm's quota refusal.
      throw new AudioClientError(reason, {
        usageBytes: quota.usageBytes,
        limitBytes: quota.limitBytes,
      });
    }

    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: asset.onceSourceKey })
    );

    const bytes = head.ContentLength ?? 0;
    const type = head.ContentType ?? '';
    const tooLarge = bytes > AUDIO_MAX_BYTES;
    const badType = !AUDIO_SOURCE_TYPES.has(type);

    if (tooLarge || badType) {
      // Same reasoning as confirmAudioUpload's own reject path: the object
      // must go, or storage is paid for a file that was refused. THAT part
      // is unchanged. What must NOT be unchanged is the row write below it:
      // confirmAudioUpload's version writes `status: 'failed',
      // permanentFailure: true` onto a row that only ever describes a
      // NEW asset with nothing else at stake. This function's row is the
      // MAIN asset's own document — writing the same shape here bricks a
      // fully-transcoded, previously-`ready` music asset over a bad SECOND
      // file: `retryAudioAsset` refuses `permanentFailure: true`, and
      // `createOnceVariantUpload` refuses a non-`ready` row, so there is no
      // path back. Exactly the failure `markOnceFailed` (audio-
      // worker/src/process.ts) exists to prevent — this is that same
      // guarantee, applied here because this rejection happens in
      // `app/server/functions/`, not in the worker, so `markOnceFailed`
      // itself can't reach it.
      //
      // Reachable only by a client that under-declares `bytes` at
      // `createOnceVariantUpload` time and then PUTs a larger body — the
      // presigned PUT can't enforce Content-Length, which is the same
      // abuse `retryAudioAsset`'s `confirmedAt` gate treats as live
      // (see that function's doc comment). An honest client can't hit
      // `tooLarge` (the schema caps declared `bytes`) or `badType` (the
      // presign signs `ContentType`), but "clients are honest" is not a
      // safety property this codebase relies on anywhere else, so it isn't
      // relied on here either.
      const reason = tooLarge
        ? `File too large: ${bytes} bytes exceeds ${AUDIO_MAX_BYTES}`
        : `Unsupported audio type: ${type}`;
      // Fenced on `status: 'uploading', variant: 'once'` — final-review fix.
      // This was the one `findOneAndUpdate` in this file with only an
      // identity filter, and it CANCELS a once-attach: it writes `status:
      // 'ready', variant: 'main', onceSourceKey: null`. A stale reject
      // (this handler resumed after an await while the user, seeing the
      // first attach fail, already started a SECOND one) matched the fresh
      // attach's row and silently reverted it — the worker's claim query
      // never sees it, the browser's PUT lands on an object nothing
      // references, and the GM is told nothing. The fence makes it a no-op
      // instead: the row it means to revert is by definition still
      // `uploading`/`once`, so a narrower filter cannot cost this path
      // anything it should have done.
      //
      // And via `fenceThenReclaim`, the same stale reject no longer deletes
      // the fresh attach's object either — which the fence alone never
      // stopped, because the delete used to run before it.
      await fenceThenReclaim({
        filter: { _id: data.assetId, ownerId: userId, status: 'uploading', variant: 'once' },
        set: {
          status: 'ready',
          variant: 'main',
          onceSourceKey: null,
          // Paired with `onceSourceKey` above, same as `createOnceVariantUpload`'s
          // reset: the rejected object is reclaimed with this write and the
          // row no longer has a once-source at all, so nothing may describe
          // its size. In the normal case this attach's own `onceSourceBytes`
          // was already `null` (set by `createOnceVariantUpload` when THIS
          // attach started) — explicit here anyway so this write's own
          // invariant does not depend on a different function having run
          // first.
          onceSourceBytes: null,
          onceLastError: reason,
          updatedAt: new Date(),
        },
        key: asset.onceSourceKey,
        r2: { client, bucket },
        actor: { userId, sessionUserId },
        action: 'confirmOnceVariantUpload.rejected',
      });
      throw new Error(reason);
    }

    const updated = await AudioAsset.findOneAndUpdate(
      { _id: data.assetId, ownerId: userId, status: 'uploading', variant: 'once' },
      {
        $set: {
          status: 'pending',
          // The HeadObject-measured size of the once-source object, recorded
          // so the storage quota (`getUserStorageUsage`) can see it — this is
          // the same `bytes` already computed above for the AUDIO_MAX_BYTES
          // gate, not a new measurement or a new outbound R2 call.
          onceSourceBytes: bytes,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updated) throw new Error('Once-variant asset is not awaiting confirmation');

    void serverCaptureEvent(
      telemetryId({ userId, sessionUserId }),
      'audio_once_variant_confirmed',
      {
        assetId: data.assetId,
      }
    );
    return { assetId: data.assetId, status: updated.status ?? 'pending' };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'confirmOnceVariantUpload' });
    throw e;
  }
}

type AudioDoc = Record<string, unknown>;

export function serializeAudioAsset(a: AudioDoc): AudioAssetData {
  const d = a as {
    _id: unknown;
    ownerId: unknown;
    title?: string;
    kind?: string;
    environment?: string[];
    mood?: string[];
    intensity?: number | null;
    tags?: string[];
    status?: string;
    durationMs?: number | null;
    durationSamples?: number | null;
    loudnessTargetLufs?: number | null;
    peaks?: number[];
    renditions?: AudioAssetData['renditions'];
    onceRenditions?: AudioAssetData['onceRenditions'];
    lastError?: string | null;
    permanentFailure?: boolean | null;
    confirmedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: String(d._id),
    ownerId: String(d.ownerId),
    title: d.title ?? '',
    kind: (d.kind ?? 'ambience') as AudioAssetData['kind'],
    environment: d.environment ?? [],
    mood: d.mood ?? [],
    intensity: d.intensity ?? null,
    tags: d.tags ?? [],
    status: (d.status ?? 'uploading') as AudioAssetData['status'],
    durationMs: d.durationMs ?? null,
    durationSamples: d.durationSamples ?? null,
    loudnessTargetLufs: d.loudnessTargetLufs ?? null,
    peaks: d.peaks ?? [],
    renditions: d.renditions ?? {},
    // Task 18: the field genuinely starts as absent on every row (including
    // every row that predates this task) and stays absent until an owner
    // attaches a once-variant, so `{}` here — mirroring `renditions` above —
    // is the honest "nothing attached yet" value, not a placeholder.
    onceRenditions: d.onceRenditions ?? {},
    lastError: d.lastError ?? null,
    // Serialized so the UI can EXPLAIN a non-retryable row, not so it can
    // decide about one — `retryable` below is what decides. Absent (a row
    // written before the field existed) means not-permanent.
    permanentFailure: d.permanentFailure === true,
    // `retryAudioAsset`'s filter, all three clauses, evaluated here.
    //
    // The comment this replaces claimed that serializing `permanentFailure`
    // meant the UI and the server "can never disagree". It was false the day it
    // was written: the filter also requires `status: 'failed'` (which the UI did
    // check) and `confirmedAt != null` (which it could not, because
    // `confirmedAt` was not serialized). Both of the rows that condition exists
    // to exclude are ROUTINE — `reapAbandonedUploads` writes `failed` with a
    // null `confirmedAt` for every upload that was abandoned, and
    // `confirmAudioUpload`'s reject path does the same for every file that was
    // too large or the wrong type — so the Retry button rendered on them and
    // threw. Mirroring a filter clause-by-clause across a network boundary is
    // the kind of thing that is right when written and wrong a commit later;
    // one derived boolean is the thing the UI can mirror EXACTLY.
    //
    // Kept literally parallel to the query below so the correspondence is
    // checkable by eye, and `tests/server/functions/audio-mutations.test.ts`
    // drives both against the same documents.
    retryable:
      (d.status ?? '') === 'failed' &&
      (d.confirmedAt ?? null) !== null &&
      d.permanentFailure !== true,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
  };
}

/**
 * The list is sorted `{ createdAt: -1, _id: -1 }`, so the pagination cursor must
 * constrain on both fields together (not `_id` alone) or a page boundary that falls
 * between two documents with different `createdAt` values can skip or duplicate rows.
 * Encoded as `<createdAt epoch ms>_<id>` — compact, and the delimiter can't collide
 * with either part (epoch ms is digits-only, Mongo ids don't contain `_`).
 */
function encodeAudioCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}_${id}`;
}

/** JS's maximum representable Date. Anything beyond it builds an `Invalid Date`. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Both halves of the cursor are validated, and both had to be.
 *
 * The old guard was `Number.isFinite(ms)`, which reads as "this is a safe
 * timestamp" and isn't: `Number.isFinite(1e20)` is `true`, but the largest Date
 * JS can represent is 8.64e15 ms, so `new Date(1e20)` is `Invalid Date`.
 * Handing that to Mongoose produces a `CastError` — an HTTP 500 and a GlitchTip
 * event, from a one-line request body. The id half was never checked at all, so
 * `1700000000000_notanoid` did the same thing by a different route.
 *
 * Returning null means "this cursor is not something this server ever minted".
 * `listAudioAssets` treats that as a hard error rather than silently restarting
 * from page 1: a silent fallback re-serves page 1 in the middle of an infinite
 * scroll, so the user sees duplicate rows and the client never learns its
 * cursor was rejected. `listAudioAssetsSchema.cursor` rejects the same shapes at
 * the request boundary, so in practice nothing reaches this fail-closed path —
 * it exists so the function is safe for any caller, not just validated ones.
 */
function decodeAudioCursor(cursor: string): { createdAt: Date; id: string } | null {
  const idx = cursor.indexOf('_');
  if (idx <= 0 || idx === cursor.length - 1) return null;
  const msPart = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  if (!/^\d+$/.test(msPart)) return null;
  const ms = Number(msPart);
  if (!Number.isSafeInteger(ms) || ms > MAX_TIMESTAMP_MS) return null;
  if (!OBJECT_ID_RE.test(id)) return null;
  const createdAt = new Date(ms);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

export async function listAudioAssets({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof listAudioAssetsSchema>;
} & Actor): Promise<{ items: AudioAssetData[]; nextCursor: string | null }> {
  try {
    await ensureDb();

    const query: Record<string, unknown> = { ownerId: userId };
    if (data.kind) query.kind = data.kind;
    if (data.environment?.length) query.environment = { $in: data.environment };
    if (data.mood?.length) query.mood = { $in: data.mood };
    if (data.tags?.length) query.tags = { $all: data.tags };
    if (data.search) query.title = { $regex: escapeRegExp(data.search), $options: 'i' };
    if (data.intensityMin != null || data.intensityMax != null) {
      const range: Record<string, number> = {};
      if (data.intensityMin != null) range.$gte = data.intensityMin;
      if (data.intensityMax != null) range.$lte = data.intensityMax;
      query.intensity = range;
    }
    if (data.needsTagging) {
      query.status = 'ready';
      // needsTagging means "ready but unclassified": tags and environment must both
      // be empty. If the caller *also* passed an explicit tags/environment filter
      // (query.tags / query.environment already set above), don't clobber it — merge
      // both requirements with $and instead. Note that requiring a facet array to be
      // both non-empty (from the caller's filter) and $size:0 (from needsTagging) is
      // never satisfiable; that's the caller asking for a contradiction, and an empty
      // result set is the honest answer, not an implementation bug.
      const explicitTags = query.tags;
      const explicitEnvironment = query.environment;
      if (explicitTags !== undefined || explicitEnvironment !== undefined) {
        delete query.tags;
        delete query.environment;
        const and: Record<string, unknown>[] = [
          { tags: { $size: 0 } },
          { environment: { $size: 0 } },
        ];
        if (explicitTags !== undefined) and.push({ tags: explicitTags });
        if (explicitEnvironment !== undefined) and.push({ environment: explicitEnvironment });
        query.$and = and;
      } else {
        query.tags = { $size: 0 };
        query.environment = { $size: 0 };
      }
    }
    if (data.cursor) {
      const decoded = decodeAudioCursor(data.cursor);
      // Fail closed. Silently ignoring an undecodable cursor restarts the list
      // at page 1, which in the infinite-scroll UI appends page 1 underneath
      // page 1 — duplicate rows, and no signal to the client that its cursor
      // was thrown away.
      if (!decoded) throw new AudioClientError('Invalid pagination cursor');
      // Compound cursor: strictly older createdAt, OR same createdAt with a
      // strictly smaller _id — matches the `{ createdAt: -1, _id: -1 }` sort.
      query.$or = [
        { createdAt: { $lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, _id: { $lt: decoded.id } },
      ];
    }

    const rows = (await AudioAsset.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(data.limit)
      .lean()) as AudioDoc[];

    const items = rows.map(serializeAudioAsset);
    const lastRow = rows[rows.length - 1];
    const nextCursor =
      items.length === data.limit && lastRow
        ? encodeAudioCursor(lastRow.createdAt as Date, items[items.length - 1].id)
        : null;
    return { items, nextCursor };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'listAudioAssets' });
    throw e;
  }
}

export async function updateAudioAsset({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof updateAudioAssetSchema>;
} & Actor): Promise<AudioAssetData> {
  try {
    await ensureDb();
    // Only include fields the caller actually provided — the pre('save') hook that
    // normalizes tags does not fire on findOneAndUpdate, and an omitted field must
    // not be clobbered with undefined/null via $set.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) set.title = data.title;
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.environment !== undefined) set.environment = data.environment;
    if (data.mood !== undefined) set.mood = data.mood;
    if (data.intensity !== undefined) set.intensity = data.intensity;
    if (data.tags !== undefined) set.tags = normalizeTags(data.tags);

    // `.lean()` is required, not just a perf nicety: without it `doc` is a hydrated
    // Mongoose Document whose array/subdocument fields (`environment`, `tags`,
    // `renditions`, ...) are Mongoose-native (DocumentArray/EmbeddedDocument)
    // wrapper types, not plain arrays/objects — `serializeAudioAsset` copies them
    // by reference into the fields it returns, and TanStack Start's server-fn
    // response serializer can't serialize those wrapper types ("The value [object
    // Object] of type \"object\" cannot be parsed/serialized", a real HTTP 500 this
    // caught end-to-end). `listAudioAssets` already does this correctly below.
    const doc = await AudioAsset.findOneAndUpdate(
      { _id: data.id, ownerId: userId },
      { $set: set },
      { new: true }
    ).lean();
    if (!doc) throw new AudioClientError('Audio asset not found');
    return serializeAudioAsset(doc as unknown as AudioDoc);
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'updateAudioAsset' });
    throw e;
  }
}

export async function bulkTagAudioAssets({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof bulkTagAudioAssetsSchema>;
} & Actor): Promise<{ modified: number }> {
  try {
    await ensureDb();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.environment !== undefined) set.environment = data.environment;
    if (data.mood !== undefined) set.mood = data.mood;
    if (data.intensity !== undefined) set.intensity = data.intensity;

    const update: Record<string, unknown> = { $set: set };
    // Distinguish "tags absent" (leave alone) from "tags: []" (explicit, meaningful
    // input): in replace mode an empty array means "clear the tags," so it must
    // still reach $set. In add mode an empty array has nothing to add, so it's a
    // genuine no-op and must not emit $addToSet with an empty $each.
    if (data.tags !== undefined) {
      const tags = normalizeTags(data.tags);
      if (data.tagMode === 'replace') {
        // Whole-array overwrite — existing tags are discarded, including down to [].
        set.tags = tags;
      } else if (tags.length) {
        // $addToSet + $each preserves existing tags; findOneAndUpdate's own
        // pre('save') normalization doesn't run here, so tags are normalized above.
        update.$addToSet = { tags: { $each: tags } };
      }
    }

    const res = await AudioAsset.updateMany({ _id: { $in: data.ids }, ownerId: userId }, update);
    return { modified: res.modifiedCount ?? 0 };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'bulkTagAudioAssets' });
    throw e;
  }
}

/**
 * Requeue a `failed` asset for another run through the transcode pipeline.
 *
 * The source object is still in R2 (delete is the only thing that removes it),
 * so a failure caused by a transient fault — an R2 blip, a brief Atlas
 * failover, a worker OOM — is entirely recoverable. Without this the only
 * recovery is delete-and-re-upload, which for a 50-file bulk import means
 * re-dropping the whole folder.
 *
 * Resets the full queue state, not just `status`: `attempts` is back to 0 (the
 * row exhausted its budget, and a retry that immediately re-failed at the cap
 * would be no retry at all), `nextAttemptAt` is cleared so the worker can claim
 * it on the next pass, and the claim fields are cleared so it can't look
 * in-flight.
 *
 * The filter carries THREE preconditions, and all are load-bearing. All three
 * are also mirrored to the client, as the single derived `retryable` flag
 * `serializeAudioAsset` computes — see there for why one flag rather than three
 * fields, and for what went wrong when only two of the three were reachable
 * from the UI.
 *
 * - `status: 'failed'` — this can never be used to yank a `ready` asset back
 *   through the worker; that is the same abuse `confirmAudioUpload`'s own
 *   precondition closes.
 * - `permanentFailure: { $ne: true }` — the failure must be one a retry could
 *   plausibly fix. The worker sets `permanentFailure` whenever it threw a
 *   `PermanentError` (audio-worker/src/errors.ts), which covers rather more
 *   than "the audio was bad": over the 30-minute cap as MEASURED by decoding,
 *   zero decoded samples, wholly silent, an incomplete rendition, an object
 *   over `AUDIO_MAX_BYTES` (whose R2 object the worker has also deleted, so
 *   there is nothing left to retry against), a row with no `sourceKey`, and a
 *   `sourceKey` predating the per-owner storage layout. What unites them is
 *   that the worker KNEW the run could not succeed, rather than guessing from
 *   an exit code — never a transient fault that merely exhausted the attempt
 *   budget. Those
 *   files are poison on every run: without this clause each Retry click buys
 *   another full decode of pinned CPU on a single-node cluster, in a loop the
 *   user can drive by hand, for a guaranteed identical outcome. `$ne: true`
 *   rather than `false` so rows written before the field existed stay
 *   retryable (Mongo equality treats an absent field as null).
 * - `confirmedAt: { $ne: null }` — the row must have **passed confirm**.
 *   `confirmAudioUpload`'s `HeadObject` is the only real enforcement of
 *   `AUDIO_MAX_BYTES` in the system (a presigned PUT cannot constrain
 *   Content-Length; the dropzone's check is a courtesy), and `confirmedAt` is
 *   written only by a confirm SUCCESS path — so a null `confirmedAt`
 *   means nobody has ever measured this object. Two kinds of row are in that
 *   state: one the worker's `reapStale` aged out of `uploading`, and one
 *   confirm rejected (whose R2 object confirm already deleted, making a requeue
 *   pointless anyway). Without this clause, declaring `bytes: 1MB`, PUTting a
 *   1 GB body, never confirming, waiting out the upload reaper and clicking
 *   Retry hands the worker an unmeasured object to buffer whole into memory
 *   (`transformToByteArray`) in a pod capped at 768Mi — OOM, requeue, OOM,
 *   fail, Retry, repeat, on a single-node cluster.
 *
 *   It must be `confirmedAt` and not `sourceBytes`: `sourceBytes` was, until
 *   this commit, seeded at row creation from the client's self-declared
 *   `data.bytes`, so `{sourceBytes: {$ne: null}}` was true for every row that
 *   had ever existed and excluded exactly nothing. A guard whose premise is
 *   false is worse than no guard, because it reads as one.
 *
 *   TWO writers, not one, and the earlier claim of exclusivity here was
 *   wrong: `confirmOnceVariantUpload`'s success write stamps `confirmedAt`
 *   too, so after a once-attach the field describes the ONCE-source's
 *   HeadObject rather than the main source's. That does not weaken this
 *   clause — a once-attach requires `status: 'ready'`, which requires the
 *   main confirm to have already run and stamped it once, so the field is
 *   still non-null exactly when some object of this row's has been measured.
 *   It is recorded because the next guard built on "one writer" would not be
 *   safe, and a false premise reads as a true one.
 *
 * NOT gated on the storage quota, unlike the other paths that lead to
 * transcode work, and that omission is deliberate rather than an oversight
 * of the same class this file's other checks close. A retry adds no source
 * bytes — `sourceKey` already exists and was already measured — only the
 * renditions the worker produces from it, bounded by how many `failed` rows
 * the caller owns, each of which already passed the quota at its own
 * confirm. Gating it would take the only recovery path away from exactly the
 * user who most needs it: someone at their quota whose asset failed
 * transiently would be told to delete something in order to un-break a file
 * they have already paid for.
 */
export async function retryAudioAsset({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof retryAudioAssetSchema>;
} & Actor): Promise<AudioAssetData> {
  try {
    await ensureDb();

    // The same per-user queue-depth bound `confirmAudioUpload` and
    // `confirmOnceVariantUpload` check, and for the same underlying reason
    // — see `checkPendingJobCap`'s doc comment: this is the third of three
    // doors into `pending`/`processing`, and Task 2's `audioIngestLimiter`
    // rate-limits how FAST a caller can click Retry but not how DEEP the
    // queue they build gets, so it does not substitute for this.
    //
    // Checked BEFORE the eligibility write below, so a caller at the cap is
    // refused without even attempting a write the fenced filter would very
    // likely have granted.
    //
    // Unlike the other two doors, refusal here touches NEITHER R2 nor the
    // row. `confirmAudioUpload`/`confirmOnceVariantUpload` each just
    // finished a fresh upload's PUT — there is a brand-new R2 object that
    // will never be confirmed and must be reclaimed, and a row mid-transition
    // that needs to land somewhere definite. Retry starts from a different
    // place: `sourceKey` already exists, was already measured by the
    // original confirm, and is untouched by a retry either way — there is
    // no new object to strand. And the row is already `failed`; refusing
    // to requeue it doesn't put it in a new state, it just leaves it in the
    // one it was already in, still eligible the moment the caller's queue
    // has room. So the correct action is the cheapest one: throw, and
    // change nothing.
    const cap = await checkPendingJobCap(userId);
    if (cap) {
      // AudioClientError: the caller's own doing, reachable at will by
      // clicking Retry repeatedly, must not file a GlitchTip event — same
      // shape as every other cap/quota refusal in this file, and now the
      // same class as the "cannot be retried" throw below: this refusal
      // fires purely from the caller's OWN queue depth and is reachable on
      // any retry attempt regardless of which row it names.
      throw new AudioClientError(
        pendingJobCapMessage(cap.pendingCount, cap.maxPendingJobs, 'retrying')
      );
    }

    const doc = await AudioAsset.findOneAndUpdate(
      {
        _id: data.id,
        ownerId: userId,
        status: 'failed',
        confirmedAt: { $ne: null },
        permanentFailure: { $ne: true },
      },
      {
        $set: {
          status: 'pending',
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        },
      },
      { new: true }
      // `.lean()` for the same reason as updateAudioAsset — see that comment.
    ).lean();
    if (!doc) {
      // AudioClientError, not a plain `Error`: this compound filter's miss
      // is reachable by guessing ids the same way the five `'Audio asset
      // not found'` sites are — see the class doc comment above for why.
      throw new AudioClientError(
        'Audio asset cannot be retried (not found, not failed, its upload never completed, or the file itself was rejected)'
      );
    }
    void serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'audio_asset_retried', {
      assetId: data.id,
    });
    return serializeAudioAsset(doc as unknown as AudioDoc);
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'retryAudioAsset' });
    throw e;
  }
}

export async function deleteAudioAsset({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof deleteAudioAssetSchema>;
} & Actor): Promise<{ deleted: boolean }> {
  try {
    await ensureDb();
    const asset = await AudioAsset.findOne({ _id: data.id, ownerId: userId });
    if (!asset) throw new AudioClientError('Audio asset not found');

    const { client, bucket } = createR2();
    // Task 18 made onceRenditions/onceSourceKey real: an asset with a once-
    // variant attached has THREE extra R2 objects beyond the main
    // source+renditions (the once source, and its opus/aac renditions), and
    // all three live under this owner's storage prefix same as the rest —
    // deleting the row without deleting them would strand three objects the
    // orphan scanner (audio-cleanup.ts) would only catch on a later manual
    // sweep instead of immediately, same as every other key here.
    const keys = [
      asset.sourceKey,
      asset.renditions?.opus?.key,
      asset.renditions?.aac?.key,
      asset.onceSourceKey,
      asset.onceRenditions?.opus?.key,
      asset.onceRenditions?.aac?.key,
    ].filter((k): k is string => Boolean(k));

    // R2 deletion is BEST-EFFORT: a failing object delete must not block the row
    // delete. The user asked for this asset to be gone, and leaving the row
    // behind because a bucket was briefly unreachable produces a library entry
    // the UI still shows, still polls, and still offers Delete for — a worse
    // outcome than a stranded object.
    //
    // What this strands IS reclaimable, but only because of the storage
    // layout. Once the row below is gone its key exists nowhere else, so
    // nothing derived from the user's remaining rows can name it — the
    // reclaim path is `~/server/functions/audio-cleanup.ts` listing
    // `uploads/audio/<the caller's prefix>/` and subtracting what the rows
    // still reference (see `./audio-storage.ts` for why the prefix exists).
    // Each failure is still reported, so a systematically failing R2 delete
    // shows up in GlitchTip rather than quietly accruing storage cost that
    // somebody has to notice and sweep.
    for (const Key of keys) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
      } catch (e) {
        void reportAudioError(
          e,
          { userId, sessionUserId },
          {
            action: 'deleteAudioAsset.r2Object',
            assetId: data.id,
            key: Key,
          }
        );
      }
    }

    // Best-effort prune of package references to this asset. Same reasoning
    // as the R2 delete loop just above: a failure here must not block the
    // row delete — the user asked for this asset to be gone — so it is
    // caught and reported rather than allowed to propagate. Without this,
    // every package that placed this asset would keep a permanently
    // dangling `items[].assetId`, and in a document capped at 64 items that
    // is a slow leak: a GM who churns their library eventually can't add
    // items to a package whose pads are mostly tombstones.
    //
    // Scoped to `{ ownerId: userId, ... }` — the caller's OWN packages
    // only, never a bare `{ 'items.assetId': id }`, which would reach into
    // other users' packages. This is a plain scalar equality, not
    // `packageVisibilityFilter`'s read-side `$or` (which also matches
    // `ownerId: null`): a system package is read-only and a user cannot
    // delete a system-owned asset anyway (the `findOne` above already
    // scoped `asset` to `ownerId: userId`), so system packages must never
    // be reachable here.
    try {
      // TWO QUERIES, not one, and the split is a memory bound rather than a
      // style choice. This used to be a single `.find({...}).lean()` with no
      // projection, materialising every matched package IN FULL and at once:
      // `items`/`moods` are ~99% of a package document, a maxed one is about
      // 410 KiB, and `MAX_PACKAGES_PER_USER` is 100 — so one delete request
      // could hold ~41 MiB of package documents on a `replicaCount: 1` pod
      // capped at 512Mi, and `libraryMutationLimiter` admits a 60-request
      // burst.
      //
      // That is the same hazard `PACKAGE_SUMMARY_PROJECTION`
      // (`~/server/functions/packages.ts`) exists to close, which its own doc
      // comment records as having produced an OOMKill for `listPackages` —
      // the control was applied to the read that task named and left open on
      // this one, which reads the same documents the same way.
      //
      // The prune genuinely NEEDS `items` and `moods` (it rewrites both), so
      // a projection cannot fix it. Fetching ids first and then one document
      // at a time can: peak resident is one package instead of all of them.
      // The extra round trips are bounded by the same 100 and land on a path
      // that is already rate-limited and already spends up to six R2 deletes.
      const affectedIds = (await AudioPackage.find(
        { ownerId: userId, 'items.assetId': data.id },
        { _id: 1 }
      ).lean()) as unknown as { _id: unknown }[];

      for (const { _id } of affectedIds) {
        // Re-read under the same owner scope. A package deleted between the
        // two queries simply yields null and is skipped — there is nothing
        // left to prune, which is the outcome this loop wanted anyway.
        const pkg = (await AudioPackage.findOne(
          { _id, ownerId: userId },
          { items: 1, moods: 1 }
        ).lean()) as unknown as {
          _id: unknown;
          items: PackageItemData[];
          moods: MoodData[];
        } | null;
        if (!pkg) continue;
        // Two steps, not one `$pull`: moods reference `item.id`, never
        // `assetId` (see `~/lib/soundboard/prune`'s doc comment), so the
        // surviving item ids must be computed FIRST and used to prune
        // `moods[].states[]` too. A single `$pull` on `items` alone would
        // leave every mood state that named the removed item pointing at
        // an id that no longer exists — exactly the orphan Task 14 had to
        // go back and fix for the editor's own item-removal path.
        const survivingItems = pkg.items.filter((item) => !sameObjectId(item.assetId, data.id));
        const survivingMoods = pruneOrphanedMoodStates(pkg.moods, survivingItems);
        await AudioPackage.updateOne(
          { _id: pkg._id, ownerId: userId },
          { $set: { items: survivingItems, moods: survivingMoods, updatedAt: new Date() } }
        );
      }
    } catch (e) {
      void reportAudioError(
        e,
        { userId, sessionUserId },
        {
          action: 'deleteAudioAsset.prunePackages',
          assetId: data.id,
        }
      );
    }

    await AudioAsset.deleteOne({ _id: data.id, ownerId: userId });
    return { deleted: true };
  } catch (e) {
    reportAudioError(e, { userId, sessionUserId }, { action: 'deleteAudioAsset' });
    throw e;
  }
}
