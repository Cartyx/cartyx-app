import { createRateLimiter } from '~/lib/rate-limit';

/**
 * The per-account request budgets for the audio ingest and soundboard-package
 * surface, plus the one message helper the wrappers format their refusals
 * with.
 *
 * WHY THIS MODULE EXISTS SEPARATELY: the buckets are consumed from BOTH
 * `~/utils/audio-server-fns.ts` and `~/utils/soundboard-server-fns.ts`, and a
 * limiter is only a limiter if both wrappers share ONE instance of it — a
 * bucket created per-module would silently double every budget the day a
 * third wrapper appears. It lives under `app/lib/` because both of those
 * wrapper modules are client-bundled: this file may therefore import nothing
 * but `~/lib/rate-limit` (itself import-free). Adding any dependency here
 * that reaches mongoose or `@sentry/node` breaks `npm run build`, not
 * `typecheck`/`lint`/`test` — see `~/utils/require-actor.ts`'s doc comment
 * for the exact mechanism.
 *
 * WHERE THEY ARE APPLIED: in the wrapper layer, immediately after
 * `requireActor()`, keyed on the caller's Mongo `_id`. That placement is
 * deliberate — the key is an ACCOUNT rather than an IP (so rotating IPs buys
 * an abuser nothing, and a household behind one NAT is not one bucket), and
 * it sits one layer above every server function, so a function added later
 * cannot silently skip the gate.
 *
 * SCOPE: these buckets are in-process (see `~/lib/rate-limit`'s own scope
 * note). The web pod runs `replicaCount: 1`, so per-process is the whole
 * picture today; at N>1 replicas every number below becomes per-replica.
 *
 * THE NUMBERS ARE HARDCODED ON PURPOSE. Task 11 of this phase wires the
 * limits that need operational tuning (quota, job cap) into the Helm chart as
 * server env. If a rate-limit value ever needs the same treatment it must be
 * a plain `process.env` read with the default below retained, and never a
 * `VITE_PUBLIC_*` name — this module is client-bundled, so a `VITE_PUBLIC_*`
 * read here would bake the limit into the browser image.
 */

/**
 * Ingest: `createAudioUpload`, `confirmAudioUpload`, both once-variant
 * halves, and `retryAudioAsset`. The design's "tight" row, and the one that
 * matters most — every confirm enqueues transcode work on a single-replica
 * worker with a global FIFO claim, so this is the queue-starvation lever.
 * `retryAudioAsset` is on this bucket too: it makes a `failed` row claimable
 * again, which is the same act as a confirm under a different verb.
 *
 * Capacity 60 — the legitimate burst is a multi-file dropzone drop, which
 * costs TWO calls per file (presign + confirm; `AudioUploadDropzone` runs
 * them sequentially, one file at a time). 60 tokens absorbs a 30-file drop
 * with the bucket starting full, comfortably over the 20-file drop the plan
 * names as legitimate, and still cuts a scripted flood of 200 confirms in a
 * second down to 60.
 *
 * Refill 1/s — one call every second sustained, i.e. one FILE every two
 * seconds once the burst budget is spent. A GM importing a 100-file SFX
 * library gets the first 30 files at full speed and the rest at ~2 s each
 * (~3 minutes), which is slower than the upload itself only for tiny files.
 * An abuser gets 3,600 calls an hour instead of the tens of thousands a
 * tight loop would otherwise manage — and the storage quota (task 4) and
 * per-user pending-job cap (task 5) bound what those calls can actually
 * consume.
 */
export const audioIngestLimiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });

/**
 * Package writes: `createPackage` and `clonePackage`. The design's other
 * "tight" row — cheap per call, but `MAX_PACKAGES_PER_USER` is 100, so a
 * hundred calls is the entire cap, and nothing in the UI creates packages in
 * bulk (each one is a form submit or a single clone-button click).
 *
 * Capacity 15 — an impatient GM reorganising a library might create or clone
 * a dozen packages back to back; 15 covers that with headroom and is still
 * well short of the 100 cap.
 *
 * Refill 0.25/s — one every four seconds sustained. That is far above any
 * human's package-authoring rate and turns "fill the 100-package cap
 * instantly" into a ~6-minute grind, which is long enough that the cap's own
 * refusal is what the abuser actually meets.
 */
export const packageWriteLimiter = createRateLimiter({ capacity: 15, refillPerSec: 0.25 });

/**
 * Board state: `saveBoardState`. The design's "moderate" row.
 *
 * Legitimately this is debounced client-side — `SAVE_FLUSH_MS` (200 ms) for
 * discrete play/stop/mood changes and a trailing `SAVE_SETTLE_MS` (800 ms)
 * for slider drags (see `~/hooks/useSoundboard.ts`), so the theoretical
 * ceiling for one window is 5 writes/second and the realistic rate is far
 * below 1.
 *
 * Capacity 40 — eight seconds at that theoretical 5/s ceiling, which also
 * covers a GM driving the board from the tabletop window and the GM screen
 * at once (same account, one bucket) during a frantic combat round.
 *
 * Refill 2/s — roughly double the worst realistic sustained rate, so the
 * bound only ever catches a scripted caller. Note this is looser per-second
 * than the ingest bucket by design: a save is one small document write with
 * no queue and no R2 object behind it, and `saveBoardState` is additionally
 * GM-gated, so a brand-new signup (`role: 'unknown'`) cannot reach it at
 * all.
 */
export const boardStateLimiter = createRateLimiter({ capacity: 40, refillPerSec: 2 });

/**
 * Orphan cleanup: `scanOrphanAudio` and `deleteOrphanAudio`. Not in the
 * design's table; added on the same reasoning that put `retryAudioAsset` on
 * the ingest bucket — the table names endpoint GROUPS, and the placement
 * rationale it states ("no server function added later can silently skip it")
 * argues for covering the surface rather than the list.
 *
 * This is the tightest bucket of the four, because these two are the only
 * endpoints on the surface where a single call has an unbounded EXTERNAL
 * cost. Both run `findOrphans`, which pages an R2 `ListObjectsV2` over the
 * caller's prefix up to `AUDIO_ORPHAN_SCAN_MAX_KEYS` (10,000) — up to ten
 * Class-A operations per call — and both fire an un-awaited
 * `serverCaptureEvent` (`audio_orphan_scan` / `audio_orphan_delete`) on every
 * success. Ungated, a loop makes both R2 spend and Umami event volume an
 * attacker-controlled parameter; the second is the same telemetry-
 * amplification shape 2a's review found twice.
 *
 * Capacity 10 — orphan cleanup is an operator-cadence action, not a user-loop
 * one. `/audio` drives it from two explicit buttons: one scan, then one
 * batched delete for the whole selection (the key list is a single
 * `.max()`ed array, not a call per key). A whole session is
 * scan -> delete -> re-scan to verify, i.e. three calls; 10 covers three such
 * cycles back to back.
 *
 * Refill 1/30s — one call every thirty seconds sustained. That is far above
 * any human's cleanup cadence (nothing about the result changes within thirty
 * seconds) and caps the sustained cost at ~120 scans/hour rather than
 * thousands.
 */
export const orphanCleanupLimiter = createRateLimiter({ capacity: 10, refillPerSec: 1 / 30 });

/**
 * NO BUCKET ON READS — `listPackages`, `getPackage`, `listPackageAssets`,
 * `listAudioAssets`, `loadBoardState`. Per the design: they are bounded by
 * their projections and by the `$in` over a package's <=64 items, and a read
 * bound risks breaking a legitimate board reload (opening a campaign fires
 * several of these at once, and a refused one leaves a half-loaded board).
 *
 * Formats the refusal message a rejected caller sees. Rounds UP to whole
 * seconds and never says "0s" — a message that tells the user to retry
 * immediately is worse than no message, because retrying immediately fails.
 */
export function rateLimitMessage(action: string, retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many ${action} requests. Try again in ${seconds}s.`;
}
