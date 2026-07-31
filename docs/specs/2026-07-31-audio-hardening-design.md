# Audio Hardening — Design (Phase 1.5)

**Date:** 2026-07-31
**Status:** Approved (design), pending implementation plan
**Phase:** 1.5 of the [GM Soundboard programme](./2026-07-28-soundboard-roadmap.md) — inserted between phase 2a and 2b
**Builds on:** [Phase 1 — Audio Asset Library](./2026-07-28-audio-library-design.md), [Phase 2a — Packages and the GM Board](./2026-07-30-soundboard-packages-design.md)

## Summary

Close the abuse surface on the audio ingest and package paths so phase 1 + 2a can
be promoted to production. Three controls that do not exist today — **request
rate limiting**, a **per-user storage quota**, and a **bound on how much of the
transcode queue one user can occupy** — plus a small set of robustness fixes an
adversarial review of 2a surfaced and deliberately deferred.

Ships no new user-facing feature. Its definition of done is that promoting
`dev` → `main` is no longer a knowingly bad idea.

## Why this phase exists, and why now

Phase 2a's [adversarial review](https://github.com/biozal/cartyx-app/pull/544)
ran five hostile passes over the branch. It fixed everything 2a introduced. What
it could not fix in a merge window was a class of problem inherited from phase 1
and never closed:

**`origin/main` contains no audio functions at all.** Phase 1 and 2a both live
only on `dev`. So promotion is not "expanding an existing surface" — it is the
first time any of this reaches production, and therefore the last moment where
adding controls costs nothing but a plan.

Three facts make that urgent rather than theoretical:

| Fact                                                                | Where                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| Registration is **open** — any Google/GitHub account becomes a user | `app/server/utils/oauth.ts:409` creates on first OAuth    |
| There are **zero role checks** on the ingest surface                | `audio.ts`, `packages.ts`, `require-actor.ts` — 0 matches |
| The transcode worker is **one replica** with a global FIFO claim    | `values.yaml`, `audio-worker/src/claim.ts:106`            |

A brand-new signup gets `role: 'unknown'`, which blocks `createCampaign` — so
`saveBoardState` is out of reach for a stranger. **Uploading audio and creating
packages are not.** Both need only `requireActor()`.

### What an attacker gets today

- **Starve the transcode queue for everyone.** `claimNext` sorts `createdAt`
  ascending across all users with no fairness term, so a flood of cheap uploads
  puts every other user's asset behind it for the length of the backlog. One
  replica, one job at a time.
- **Drive R2 storage arbitrarily.** ~126 MB per asset at the caps (50 MiB source
  - ~47 MB opus + ~29 MB aac), no per-user quota. Phase 1's own design lists this
    as its open question; it was never closed. These are _legitimate_ `ready`
    assets, so the orphan scanner will never reclaim them.
- **Amplify Atlas writes.** Every `saveBoardState` costs three round trips
  (`User.findOne`, `Campaign.findById`, then the upsert). The 200 ms debounce is
  **client-side only**; the endpoint has none.

2a's fix wave capped packages at 100 per user and projected the list query, which
closed the one path that could OOM the web pod. That was the acute problem. This
phase closes the rest.

## Goals

- One authenticated stranger cannot degrade service for anyone else.
- Storage cost per user is bounded and visible to them before they hit it.
- The controls are testable without a real Mongo, real R2, or real time.
- Promotion to production becomes a routine decision rather than a judgement call.

## Non-goals

- Anything from phase 2b — realtime broadcast, player playback, resync.
- Per-user CPU accounting or billing. A queue-depth bound is the crude control
  that fits a single-node home lab; metering is not.
- Reworking the transcode queue into real infrastructure. Phase 1 accepted
  queue-on-document knowingly and the note stands: _if a second job type is ever
  added this should become a real queue._ The once-variant made that true, and it
  remains recorded rather than acted on — a bounded FIFO is enough for one worker.
- A licensing/ToS position on user-uploaded audio. Still open, still owned by the
  phase that first makes libraries shareable.

## Key decisions

| Decision                | Choice                                               | Rationale                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate-limit placement    | **In-process, at the server-fn boundary**            | Web runs `replicaCount: 1`. An in-process bucket is honest at that scale and costs no round trip. Becomes per-replica if scaled — stated in code, not assumed. |
| Rate-limit shape        | **Pure token bucket, time injected**                 | Exactly `app/utils/exception-throttle.ts`'s shape, which was built to be portable and testable for the same reason. Reuse the idiom, not the module.           |
| Quota accounting        | **Aggregate on demand at upload time**               | A denormalised counter needs maintenance on create, delete, transcode-complete and reap — four writers, and the 2a review found bugs in three of them.         |
| Quota enforcement point | **`createAudioUpload`, before the presign**          | Refusing before the URL exists means no orphan to reclaim. Refusing at confirm means paying for the bytes first.                                               |
| Worker fairness         | **Cap pending jobs per user, not round-robin claim** | Bounding queue _depth_ bounds everyone else's wait without touching `claimNext`'s atomicity — the one part of the pipeline nothing has broken.                 |
| Where limits live       | **Server env, not `VITE_PUBLIC_*`**                  | Changing a limit must not need an image rebuild (see the `deploying` skill's client-baked env rules).                                                          |

### On the rate-limit placement

A Cloudflare rule at the edge would be strictly better — it rejects before the
request costs anything. It is also infrastructure config rather than code, so it
cannot be tested in CI, cannot be reviewed in a PR, and does not exist in
`cartyx-infrastructure` today. The in-process limiter is the version that ships
with tests. **If a Cloudflare rule is added later, this one stays** — defence in
depth, and it is the only layer that knows the caller's Mongo `_id` rather than
their IP.

### On aggregating the quota on demand

The cost is one `$group` aggregation per upload request, over one user's assets,
served by the existing `{ownerId, createdAt}` index. Uploads are not a
high-frequency path — the dropzone is multi-file, but each file is one request
and each request is already doing a presign round trip to R2.

The alternative, a `storageBytes` counter on `User`, is faster and wrong more
often. It has four writers (`confirmAudioUpload`, `processAsset` on success,
`deleteAudioAsset`, and both reapers), and 2a's adversarial review found
correctness bugs in three of those exact functions. A number that drifts is worse
than a number that costs 40 ms, because a drifted quota either blocks a user who
is under it or admits one who is over.

## Architecture

### Rate limiting

A pure `createRateLimiter({ capacity, refillPerSec, now })` returning
`{ check(key): { allowed, retryAfterMs } }`, in `app/lib/rate-limit.ts` —
`app/lib/` is the framework-free directory 2a established for exactly this.

Applied in `app/utils/*-server-fns.ts` at the wrapper layer, keyed on the Mongo
`_id` from `requireActor()`. That placement matters: it is after authentication,
so the key is an account rather than an IP, and it is one layer above every
server function, so no function can be added later that silently skips it.

Buckets, with the reasoning that sets each:

| Endpoint group                              | Bound         | Why                                                                                             |
| ------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `createAudioUpload` / `confirmAudioUpload`  | tight         | Each confirm enqueues transcode work. This is the queue-starvation lever.                       |
| `createPackage` / `clonePackage`            | tight         | Cheap per call but 100 of them is the cap; no legitimate user creates them in bursts.           |
| `saveBoardState`                            | moderate      | Debounced to ~1/200 ms legitimately, so the bound only has to catch a scripted caller.          |
| Reads (`listPackages`, `listPackageAssets`) | loose or none | Bounded by the projection and the `$in`; a read bound risks breaking a legitimate board reload. |

**A rejected request must not file a GlitchTip event.** 2a's review found
attacker-controlled telemetry amplification twice; a rate limiter that reports
every rejection is a third instance of the same mistake.

### Storage quota

`AUDIO_USER_QUOTA_BYTES` (server env, with a default). Usage is
`sourceBytes + renditions.{opus,aac}.bytes + onceRenditions.{opus,aac}.bytes`
summed across the caller's assets — the same six fields
`audio-cleanup.ts`'s `referencedKeys` enumerates, which is the list to copy so
the two cannot drift.

Enforced in `createAudioUpload` **before** the presign, refusing with the current
usage and the limit so the UI can say something useful. Surfaced on `/audio` as a
usage indicator, because a quota a user discovers only by hitting it is a support
ticket.

**A partially-transcoded asset counts what it has so far.** Counting only
`ready` assets would let a user park unbounded bytes in `pending`.

### Worker fairness

`MAX_PENDING_JOBS_PER_USER`, checked in `confirmAudioUpload` — the point where a
row becomes claimable. Counting `{ ownerId, status: { $in: ['pending','processing'] } }`
bounds the depth one user can put in front of everyone else.

`claimNext` is untouched. It is a single atomic `findOneAndUpdate` that nothing
in three phases has broken, and a fairness term would mean a sort over a computed
field. Bounding the input is the cheaper correct move.

### Robustness fixes carried from 2a's adversarial review

Each was found by a hostile pass, judged real, and deferred because it was not
what was blocking that merge:

| Item                                                       | Why it belongs here                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Optimistic concurrency on `updatePackage`                  | The editor blind-`$set`s its whole draft; an idle tab still overwrites a concurrent edit. Data loss.      |
| Engine decoded-buffer cache never evicts                   | 64 items × 30 min ≈ 44 GB. Self-harm in 2a; a cross-user weapon the moment phase 3's catalogue is shared. |
| In-flight rendition fetches never aborted                  | Teardown leaves up to 64 downloads running, each filing a GlitchTip event on rejection.                   |
| `captureException` runs before the mounted check           | Same path, one line, same amplification class.                                                            |
| `reapAbandonedOnceUploads`' fence can match a later attach | The surviving instance of a class fixed twice elsewhere. One clause.                                      |
| `updateAudioAsset` resets the once reaper's only clock     | A facet edit indefinitely postpones reaping a stuck attach, with no self-service recovery.                |

## Failure modes

| Failure                             | Handling                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Rate limit hit by a legitimate user | 429-shaped error with `retryAfterMs`; the UI says when to retry. Never a silent failure and never a GlitchTip event.           |
| Quota exceeded mid-batch upload     | Per-file rejection, not batch failure — phase 1's dropzone is already per-file. Files under the line still land.               |
| Quota aggregation fails             | **Fail closed.** Refuse the upload. An unmeasurable quota that admits the request is not a quota.                              |
| Pending-job cap hit                 | Refuse at confirm with the count, so the object is deleted rather than stranded. The user's earlier jobs still drain normally. |
| Web pod restarts                    | In-process buckets reset. Accepted: the window is seconds and the durable controls (quota, job cap) are Mongo-backed.          |

## Testing

- **The limiter is pure** — capacity, refill and clock all injected — so its tests
  are exhaustive and fast. Model on `exception-throttle.test.ts`.
- **Quota and job-cap tests assert the actual query**, not a mocked return. Phase 1
  shipped a security test that passed with its ownership clause deleted; every
  scoped-count test in this phase names the filter it expects.
- **The fail-closed path needs its own test.** Make the aggregation reject and
  assert the upload is refused — the easy bug is a `catch` that logs and continues.
- **E2E:** upload past the quota and assert the refusal is visible in the UI. The
  E2E runs against deliberately fake R2 credentials, so the refusal must happen
  **before** any outbound R2 call or the test cannot distinguish a quota refusal
  from a credentials failure.

## Open questions

| Question                                      | Disposition                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Default quota and rate-limit values           | Set in the plan against measured asset sizes; tune after real usage.     |
| Whether to add a Cloudflare edge rule as well | Out of scope here; the in-process limiter stands either way.             |
| Licensing/ToS on user-uploaded audio          | Still open. Blocks shareable libraries, not this phase.                  |
| Per-user CPU/egress accounting                | Deferred. Queue depth is the proxy control until it demonstrably is not. |

## Decisions recorded for phase 2b

Settled while scoping this phase, so 2b's design opens with them rather than
re-litigating (both update the roadmap's open-questions table):

- **Players get master _and_ per-track volume.** More capable than the master-only
  option, and it inherits a known hazard: the GM's mood switches will fight a
  player's per-track overrides. 2b must decide explicitly whether a mood change
  resets or preserves them — this is the same `mood ?? item` merge that produced
  2a's subtlest bugs, now with a second writer.
- **Late join is position-accurate.** A joiner is sample-aligned with the table,
  not merely playing the same items. This needs clock sync and a broadcast
  playhead; 2a's engine tracks `startedAt` per-browser only, so this is genuinely
  new machinery rather than a read of persisted state.
