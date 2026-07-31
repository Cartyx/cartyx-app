# Audio Hardening — Implementation Plan (Phase 1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close the abuse surface on audio ingest and packages so phase 1 + 2a can be promoted to production.

**Design spec:** [2026-07-31-audio-hardening-design.md](./2026-07-31-audio-hardening-design.md)
**Programme scope:** [2026-07-28-soundboard-roadmap.md](./2026-07-28-soundboard-roadmap.md)

**Branch:** create `audio-hardening` from `dev`. Every PR targets `dev`. NEVER open a PR against `main`.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`npm run lint` runs with `--max-warnings 0`** — one new warning fails CI.
- **`npm run typecheck` must be clean.**
- **`npm run build` must pass, and it is NOT implied by the other checks.** Phase 2a broke the client bundle for ten tasks while typecheck, lint, unit and Storybook all stayed green. The trap: server-fn wrapper modules **are** client-bundled and TanStack Start strips only `.handler()` bodies, so a helper referenced solely inside them is tree-shaken — but **exporting** it defeats that and drags mongoose and `@sentry/node` into the browser build. `requireActor` lives in `app/utils/require-actor.ts` and is reached **only** via `await import(...)` inside a handler. Nothing mechanically enforces that.
- **Unit tests mock mongoose** — per-method model mocks, no in-memory Mongo. **They cannot catch identity-resolution or query-shape bugs**: a mock returns what it was told regardless of what the query asked. Every scoped-count test in this phase must assert on the **actual filter argument**.
- **Every new component needs a `.stories.tsx`** — `npm run test:storybook` runs stories in a real browser and blocks CI.
- **Telemetry:** `serverCaptureEvent(distinctId, event, properties)` — distinctId first. Never `await` capture calls. **A rejected request must never file a GlitchTip event** — 2a's review found attacker-controlled telemetry amplification twice.
- **Identity:** `requireActor()` returns `{ userId, sessionUserId }`. `userId` (Mongo `_id`) is the only value that may scope a query; `sessionUserId` is telemetry-only.
- **Ids reaching Mongo are ObjectId-validated in the Zod schema.** `objectId` is now **case-canonical** (`.transform(toLowerCase)`) — an uppercase id previously defeated a whole prune because `String(oid)` renders lowercase. Do not compare a client id to a server-derived one without normalising.
- **Every array field in a Zod schema needs a `.max()`.**
- **New env vars are server-side only**, never `VITE_PUBLIC_*` — see the `deploying` skill's client-baked env rules.

### On the code in this plan

Snippets are **starting points, not authority**. Phase 1's plan had fourteen wrong ones; 2a's had six plus four requirements assigned to no task at all. Verify every snippet against the actual API. Where a snippet contradicts the codebase, **the codebase wins** — report it rather than making the codebase match.

### On fixtures

Ask what shape would make each test pass for the wrong reason, then use that shape. In 2a this caught: a negative test whose payload was missing three other required fields; a memo test that proved only the wrapper existed; a worker test that passed with the code pointed at the wrong source object.

---

## File Structure

**Create:**

| Path                                     | Responsibility                        |
| ---------------------------------------- | ------------------------------------- |
| `app/lib/rate-limit.ts`                  | Pure token bucket, injected clock     |
| `app/server/functions/audio-quota.ts`    | Usage aggregation and the quota check |
| `app/components/audio/AudioQuotaBar.tsx` | Usage indicator on `/audio`           |

**Modify:**

| Path                                 | Change                                         |
| ------------------------------------ | ---------------------------------------------- |
| `app/utils/audio-server-fns.ts`      | Apply rate limiting                            |
| `app/utils/soundboard-server-fns.ts` | Apply rate limiting                            |
| `app/server/functions/audio.ts`      | Quota check, pending-job cap, reaper clock fix |
| `app/server/functions/packages.ts`   | Optimistic concurrency on `updatePackage`      |
| `app/lib/soundboard/engine.ts`       | Buffer-cache eviction, fetch abort             |
| `app/hooks/useSoundboard.ts`         | Abort wiring, telemetry ordering               |
| `audio-worker/src/claim.ts`          | Once-reaper fence                              |
| `deploy/charts/cartyx/`              | New env vars — **run `render-tests.sh`**       |

---

## Task 1: The rate limiter

**Files:** create `app/lib/rate-limit.ts`, `tests/lib/rate-limit.test.ts`

**Produces:** `createRateLimiter({ capacity, refillPerSec, now, maxKeys })` → `{ check(key) }` returning `{ allowed, retryAfterMs }`.

**Pure, with the clock injected** — `app/utils/exception-throttle.ts` is the shape to follow and was written portable for exactly this reason. Read it first. `app/lib/` is the framework-free directory 2a established.

**Bound the key map.** An unbounded `Map` keyed by user id is itself a memory leak on the pod this phase exists to protect; evict oldest past `maxKeys`, as `exception-throttle.ts` does.

- [ ] Tests: refills at the stated rate; a burst up to `capacity` passes and the next is refused; `retryAfterMs` is accurate enough to act on; keys are independent; eviction past `maxKeys` does not resurrect a refused key as allowed.
- [ ] **Teeth-proof:** make refill unconditional (ignore elapsed time) and confirm the refill test fails.

```bash
git commit -m "feat(audio): pure token-bucket rate limiter"
```

---

## Task 2: Apply rate limiting at the wrapper layer

**Files:** modify `app/utils/audio-server-fns.ts`, `app/utils/soundboard-server-fns.ts`; tests alongside each

Apply in the **wrapper**, after `requireActor()`, keyed on the Mongo `_id`. That placement is deliberate: the key is an account rather than an IP, and no server function added later can silently skip it.

Buckets per the design's table — tight on `createAudioUpload`/`confirmAudioUpload` and `createPackage`/`clonePackage`, moderate on `saveBoardState`, loose or absent on reads. Pick the numbers, and **justify each against a realistic legitimate burst** (a 20-file dropzone drop is legitimate; 200 confirms in a second is not).

**A rejection must not file a GlitchTip event.** Verify by asserting `serverCaptureException` was not called.

**Run `npm run build`.** This task touches both wrapper modules, which is exactly where 2a's ten-task build regression lived.

- [ ] Test, per bucket: over-limit rejects **and** the underlying server function is `not.toHaveBeenCalled()`. The negative assertion is what protects the gate — asserting only that it rejects passes with the limiter deleted, because a later line throws anyway.
- [ ] **Teeth-proof:** remove one limiter call, confirm that endpoint's `not.toHaveBeenCalled()` assertion fails.

```bash
git commit -m "feat(audio): rate-limit the ingest and package endpoints"
```

---

## Task 3: Storage usage aggregation

**Files:** create `app/server/functions/audio-quota.ts`, `tests/server/functions/audio-quota.test.ts`

**Produces:** `getUserStorageUsage(userId)` → `{ bytes, assetCount }`.

Sum the **same six fields** `audio-cleanup.ts`'s `referencedKeys` enumerates — `sourceBytes`, `renditions.{opus,aac}.bytes`, `onceRenditions.{opus,aac}.bytes`. Copy that list rather than re-deriving it, so the two cannot drift; 2a shipped a bug where a new key field was missing from exactly that enumeration.

**Count every status, not just `ready`.** Counting only `ready` would let a user park unbounded bytes in `pending`.

- [ ] Test: assert the **actual aggregation pipeline**, not a mocked result. A fixture with a `pending` asset carrying only `sourceBytes` and a `ready` one carrying all six proves both halves.
- [ ] Test: an asset with `null` bytes (never confirmed) contributes 0 rather than `NaN`.

```bash
git commit -m "feat(audio): per-user storage usage aggregation"
```

---

## Task 4: Enforce the quota at upload

**Files:** modify `app/server/functions/audio.ts`; test alongside

`AUDIO_USER_QUOTA_BYTES` from server env with a documented default. Check in `createAudioUpload` **before the presign** — refusing after means an object exists that something has to reclaim.

**Fail closed.** If the aggregation throws, refuse. The easy bug is a `catch` that logs and continues, which converts the quota into a suggestion.

Refuse with the current usage and the limit in the error, so the UI can say something useful. Use the client-error type so a refusal does not file a GlitchTip event.

- [ ] Test: over quota refuses **and** no presign is issued (`not.toHaveBeenCalled()` on the R2 client).
- [ ] Test: the aggregation rejecting refuses the upload — **its own test**, not a branch of another.
- [ ] Test: exactly at the limit is refused or allowed per your stated rule; say which and be consistent with `MAX_PACKAGES_PER_USER`'s `>=`, which 2a chose deliberately.
- [ ] **Teeth-proof:** remove the fail-closed `catch`, confirm the aggregation-failure test fails.

```bash
git commit -m "feat(audio): enforce a per-user storage quota before presign"
```

---

## Task 5: Surface usage in the UI

**Files:** create `app/components/audio/AudioQuotaBar.tsx` + stories, modify `app/routes/audio.tsx`; tests alongside

A quota a user discovers only by hitting it is a support ticket. Show usage against the limit on `/audio`, near the dropzone.

Needs a server-fn wrapper for `getUserStorageUsage` — follow `soundboard-server-fns.ts`'s shape exactly, including the dynamic `requireActor` import, and add its query key under the existing nested `queryKeys` object.

- [ ] Test: renders usage and limit; a near-limit state is visually distinct from a healthy one.
- [ ] Stories for each state (healthy, near limit, over). **Check the stories do not throw on missing props** — tasks 14, 15 and 16 of phase 2a each caught their own stories doing exactly that before commit.

```bash
git commit -m "feat(audio): show storage usage on the library route"
```

---

## Task 6: Bound the transcode queue per user

**Files:** modify `app/server/functions/audio.ts`; test alongside

`MAX_PENDING_JOBS_PER_USER` from server env. Check in `confirmAudioUpload` — the point where a row becomes claimable — counting `{ ownerId: userId, status: { $in: ['pending','processing'] } }`.

**Do not touch `claimNext`.** It is a single atomic `findOneAndUpdate` that nothing across three phases has broken; bounding its input is the cheaper correct move than adding a fairness term.

Refuse with the count so the user knows to wait. Delete the uploaded object on refusal, or it is stranded — and note the ordering trap 2a's review found in this same function: the R2 delete must not leave a row the caller believes failed.

- [ ] Test: assert the **actual count filter**, including `ownerId`. A test asserting only "it refused" passes with the ownership clause deleted.
- [ ] Test: a user at the cap is refused while a _different_ user at zero is admitted, in the same test file — a single-user fixture cannot catch a global-count bug.
- [ ] **Teeth-proof:** drop `ownerId` from the filter, confirm the two-user test fails.

```bash
git commit -m "feat(audio): cap pending transcode jobs per user"
```

---

## Task 7: Optimistic concurrency on `updatePackage`

**Files:** modify `app/server/functions/packages.ts`, `app/routes/audio_.packages_.$packageId.tsx`; tests alongside

The editor blind-`$set`s its whole draft, so an idle tab overwrites a concurrent edit and can resurrect items pruned by an asset delete. 2a fixed the invalidation; the underlying write is still last-write-wins over whole arrays.

Add a version or `updatedAt` precondition to the update filter and surface the conflict rather than silently losing the other write. **Decide and state** whether a conflict re-fetches and merges or asks the user — a conflict UI that silently discards is the bug with extra steps.

- [ ] Test: a stale write is refused, and the refusal is distinguishable from a not-found.
- [ ] Test: a non-stale write still succeeds — the guard must not make every save fail.
- [ ] **Teeth-proof:** remove the precondition, confirm the stale-write test fails.

```bash
git commit -m "fix(soundboard): refuse a stale package write instead of clobbering"
```

---

## Task 8: Bound the engine's decoded-buffer cache

**Files:** modify `app/lib/soundboard/engine.ts`; test in `app/lib/soundboard/engine.browser.test.ts`

`assets` is a `Map` with no eviction and no cap. At the caps — 64 items × 30-minute assets, 48 kHz stereo float32 — that is ~691 MB per asset and ~44 GB total. Today it is self-harm; it becomes a cross-user weapon the moment phase 3's catalogue is shared.

Add an eviction policy. **Never evict a buffer whose track is currently playing** — that is the obvious wrong LRU and it would cut audio mid-scene.

**These tests run in a real browser** (`npm run test:browser`, the third vitest project 2a added). Do not mock Web Audio.

- [ ] Test: past the cap, an idle buffer is evicted and a playing one is not.
- [ ] Test: an evicted asset re-decodes on next play rather than erroring.
- [ ] **Teeth-proof:** make eviction ignore the playing check, confirm the playing-buffer test fails.

```bash
git commit -m "fix(soundboard): bound the engine's decoded-buffer cache"
```

---

## Task 9: Abort in-flight loads on teardown

**Files:** modify `app/lib/soundboard/engine.ts`, `app/hooks/useSoundboard.ts`; tests alongside

Teardown leaves up to 64 fetch/decode chains running against a closed `AudioContext`. Each rejects, and `captureException` at `useSoundboard.ts` runs **before** the `mountedRef` check — so a board clear files an event per asset.

Two fixes: an `AbortController` per engine, aborted in `dispose()`; and move the capture behind the mounted/disposed check.

- [ ] Test: after `dispose()`, an in-flight load neither throws into the graph nor files a capture.
- [ ] **Teeth-proof:** move the capture back above the guard, confirm the test fails.

```bash
git commit -m "fix(soundboard): abort in-flight loads and stop teardown telemetry"
```

---

## Task 10: The two narrow worker fixes

**Files:** modify `audio-worker/src/claim.ts`, `app/server/functions/audio.ts`; tests alongside

Both were found by 2a's adversarial pass, judged real, deferred as narrow:

1. **`reapAbandonedOnceUploads`' fence can match a later attach.** Its write filter is `{_id, status:'uploading', variant:'once'}` — which a _second_ attach also satisfies, so the reaper can revert an attach seconds old and tell the user it "never completed". Its sibling was hardened for exactly this class. Add `onceSourceKey: row.onceSourceKey` so the fence identifies _which_ attach.
2. **`updateAudioAsset` resets the once reaper's only clock.** It writes `updatedAt` unfenced, and `claim.ts` gates abandoned-once reaping on `updatedAt < cutoff` — so a facet edit postpones the reap indefinitely, with no self-service recovery because `createOnceVariantUpload` needs `status: 'ready'`. Use a dedicated timestamp for job liveness.

Run `(cd audio-worker && npm run typecheck && npm test)` — the root suite does not cover the worker.

- [ ] Test each against the real mechanism, not a filter-shape assertion. 2a's equivalent used a filter-evaluating fake collection driving the real reaper; reuse it.
- [ ] **Teeth-proof both.**

```bash
git commit -m "fix(audio): identify the once-reap by attach, and stop facet edits resetting its clock"
```

---

## Task 11: Chart and config

**Files:** modify `deploy/charts/cartyx/` (values, deployment env), `docs/observability.md` if alerts change

Wire the new env vars — quota, job cap, rate-limit values — as **server-side env**, never `VITE_PUBLIC_*`, so changing a limit needs no image rebuild.

**`bash deploy/charts/cartyx/tests/render-tests.sh` is REQUIRED whenever anything under `deploy/charts/` changes**, and is a CI job. `deploy/charts/` is prettierignored — do not format it.

- [ ] Add render-test assertions for each new var, matching the existing style.
- [ ] Document the defaults and where to change them.

```bash
git commit -m "chore(deploy): wire the audio hardening limits"
```

---

## Task 12: E2E and the gate

**Files:** extend `e2e/audio-library.spec.ts` or add `e2e/audio-hardening.spec.ts`

**Seed real fixtures.** Do **not** guard assertions behind `if (await x.count())` — with no seed data that condition is always false and the spec reports coverage it does not have.

**The E2E runs against deliberately fake R2 credentials.** A quota refusal must therefore happen **before** any outbound R2 call, or the test cannot distinguish a quota refusal from a credentials failure. That is itself a useful assertion about where the check lives.

- [ ] Cover: a user over quota sees the refusal in the UI, and the usage indicator reflects reality.
- [ ] **Prove the seed matters:** remove it and confirm the spec fails.

- [ ] **Run the whole gate before opening the PR:**

```bash
npm run build
npm run typecheck && npm run lint && npm test && npm run test:storybook && npm run test:browser
bash deploy/charts/cartyx/tests/render-tests.sh
(cd audio-worker && npm run typecheck && npm test)
(cd realtime && npm run typecheck && npm test)
npx playwright test
```

- [ ] **Open the PR against `dev`.**

```bash
git push -u origin audio-hardening
gh pr create --base dev --title "feat(audio): hardening — rate limits, storage quota, queue fairness"
```

---

## After this phase

Promoting `dev` → `main` becomes a routine decision. Per `CLAUDE.md`, promotion is a PR `dev`→`main` merged with `gh pr merge --merge --admin`, and the `deploying` skill holds the runbook.

**Verify before promoting:** `origin/main` currently contains no audio functions at all, so this promotion carries phases 1, 2a and 1.5 together. It is a large surface reaching production for the first time — worth watching GlitchTip and the worker's queue depth for the first session.

---

## Self-Review

| Requirement                                     | Task |
| ----------------------------------------------- | ---- |
| Rate limiting on ingest and package endpoints   | 1, 2 |
| Per-user storage quota, enforced before presign | 3, 4 |
| Quota visible to the user                       | 5    |
| Transcode queue bounded per user                | 6    |
| Stale package writes refused                    | 7    |
| Engine buffer cache bounded                     | 8    |
| Teardown aborts loads, no telemetry storm       | 9    |
| Once-reaper identifies its attach               | 10   |
| Facet edits do not postpone reaping             | 10   |
| Limits configurable without a rebuild           | 11   |
| End-to-end proof                                | 12   |

**Not covered, by design:** phase 2b in full; per-user CPU or egress metering; a Cloudflare edge rule; the licensing/ToS position; reworking queue-on-document into real infrastructure.

**Known risk:** Task 2 touches both server-fn wrapper modules, which is precisely where phase 2a's ten-task build regression lived. Run `npm run build` on that task specifically, not just at the gate.
