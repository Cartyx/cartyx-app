# Audio Asset Library — Design

**Date:** 2026-07-28
**Status:** Approved (design), pending implementation plan
**Phase:** 1 of 3 — see [GM Soundboard — Programme Scope](./2026-07-28-soundboard-roadmap.md)
for the big picture, the other phases, and the programme-level decisions this
design inherits.

## Summary

Add a per-user **audio library** to Cartyx: upload audio in bulk, transcode and
loudness-normalize it server-side, classify it with a required `kind` plus
structured facets and free-form tags, and browse/search/filter it from a
standalone route outside any campaign.

This is the foundation for a GM soundboard (Syrinscape-style) in which the GM
controls playback and **players hear the audio in their own browsers**. This
phase deliberately ships no playback engine, no packages, and no realtime
broadcast — only a library you can fill, classify, find, and audition one file
at a time.

## Programme context

**The authoritative source for the overall project is
[GM Soundboard — Programme Scope](./2026-07-28-soundboard-roadmap.md).** It holds
the vision, all three phases, the competitive research that sets phase 2's
feature bar, the programme-level decisions, and the cross-cutting concerns. This
section is only the minimum needed to read the present document.

| #   | Phase                                                                                             | Status        |
| --- | ------------------------------------------------------------------------------------------------- | ------------- |
| 1   | **Audio asset library** — upload, transcode, classify, search                                     | this document |
| 2   | **Packages + soundboard** — collections, moods, Web Audio engine, GM controls, realtime broadcast | not started   |
| 3   | **`ai-sound-generator`** — Python generate → approve → upload tool                                | not started   |

Packages and the soundboard are one phase because a package with no player is
untestable and a board with no packages has nothing to load; splitting them
means building throwaway scaffolding twice.

### Prior art: the `ttrpg-sfx` POC

`~/Developer/ttrpg-sfx` is a working local toolkit whose `docs/soundboard.md`
documents a **verified** Web Audio engine — per-track gain nodes, click-free
fades, loop/one-shot semantics, retrigger behaviour, and `∞`/`1×` music variants
with measured evidence (fade envelopes sampled in a real browser, master-bus RMS
matching the −20 LUFS target). Phase 2 should port that engine rather than
reinvent it.

Its normalization target (−20 LUFS, via `normalize.sh`) is adopted as this
library's canonical loudness so generated and hand-uploaded audio sit at the
same level.

### Phase 3 shape (summary — has its own spec)

`ai-sound-generator` is a **Python tool that generates a candidate sound, plays
it for approval, and on acceptance uploads it through this library's ingest
API**, returning the resulting asset link. Audio is never committed: the repo
holds only the Python source, and every generated file lives in R2.

This matters for phase 1 because the tool is a **second ingest client**.
It does not get its own R2 credentials or its own Mongo access — it uses the
same presigned-upload and confirm endpoints the browser uses, so validation,
transcoding, and the resulting `AudioAsset` are identical no matter which client
uploaded. See [Ingest API surface](#ingest-api-surface).

The generator knows what it produced — the `SCENES`/`SPELLS` entry, the prompt,
whether it is ambience or a one-shot — so it sends `kind`, facets, and tags at
upload time. Generated audio therefore arrives **fully classified** and never
enters the "needs tagging" pile, which is the case that would otherwise dominate
that queue.

Sizing note for that phase: `~/Developer/ttrpg-sfx` is currently 15 GB
(`models/` 10 G, `output/` 2.9 G, `MOSS-TTS/` 1.4 G, `stable-audio-3/` 473 M, the
last a nested git repo) against roughly 50 KB of authored shell. Only the
authored code and docs move; models and output stay gitignored and local.

## Goals

- Upload many files at once and classify them afterwards in bulk.
- Guarantee every asset is playable in every browser a player might use.
- Make one sound findable among hundreds.
- Reuse the library across all campaigns a user runs, without re-uploading.
- Build components that phase 2 can mount inside a campaign unchanged.

## Non-goals

- Packages/collections, playback control, fades, layering, random triggers.
- Realtime broadcast to players; player-side audio.
- A curated global/built-in sound library shared across users.
- Sharing a library between users.
- **Personal access token issuance/revocation** — the ingest server routes and
  their auth hook ship here, but token management belongs to phase 3.
- The Python generator itself.

## Key decisions

| Decision                          | Choice                                          | Rationale                                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who hears audio (programme-level) | Players hear it in their browsers               | Syrinscape "Online" model. Drives the format-compatibility work below.                                                                                                          |
| Library ownership                 | **Per-user**, reused across their campaigns     | Cartyx scopes content by `campaignId` and copies SRD data per campaign; that is fine for small documents but would mean paying R2 storage repeatedly for identical audio bytes. |
| Classification                    | Required `kind` + structured facets + free tags | `kind` is functional (drives playback defaults, as the POC's `SECTIONS` do); facets make filtering precise; tags stay open-ended.                                               |
| Ingest                            | Multi-file upload + bulk tag editing            | Scales to generator output without filename discipline.                                                                                                                         |
| Processing                        | **Server-side ffmpeg pipeline**                 | Guarantees loudness consistency and, critically, emits per-browser renditions.                                                                                                  |
| Worker placement                  | New `cartyx-audio-worker` deployment            | Isolated CPU limits so bulk imports cannot starve SSR on the single-node cluster; follows the existing web + realtime two-service pattern.                                      |
| Job queue                         | Claim state on the asset document               | No Redis in the stack; a Mongo atomic claim needs no new infrastructure.                                                                                                        |

## Architecture

### Data model — `AudioAsset`

Owned by a user, not a campaign.

| Field                                             | Type              | Notes                                                                                                                                                                                       |
| ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ownerId`                                         | ObjectId → `User` | Indexed.                                                                                                                                                                                    |
| `title`                                           | String            | Required.                                                                                                                                                                                   |
| `kind`                                            | enum              | `music` \| `ambience` \| `one-shot`. Required; drives playback defaults in phase 2.                                                                                                         |
| `environment[]`                                   | String[]          | Facet. Multi-value — a sound may be both `forest` and `night`.                                                                                                                              |
| `mood[]`                                          | String[]          | Facet. Multi-value.                                                                                                                                                                         |
| `intensity`                                       | Number            | 1–5, single value. Lets the board swap calm↔intense variants of a scene.                                                                                                                    |
| `tags[]`                                          | String[]          | Free-form, normalized via the existing `normalizeTags` helper.                                                                                                                              |
| `sourceKey`                                       | String            | Original upload; retained so assets can be re-transcoded when settings change.                                                                                                              |
| `renditions`                                      | Object            | `{ opus: {key,url,bytes}, aac: {key,url,bytes} }`.                                                                                                                                          |
| `onceRenditions`                                  | Object?           | Optional second set, `kind: 'music'` only — see [Music variants](#music-variants).                                                                                                          |
| `durationMs`                                      | Number            | From `ffprobe`, **not** from the decoded buffer. See [Gapless looping](#gapless-looping).                                                                                                   |
| `loudnessTargetLufs`                              | Number            | The loudnorm **target** applied (`-20`), not a measurement — single-pass loudnorm doesn't guarantee the output lands on it. A real two-pass measurement would be a separate `loudnessLufs`. |
| `sampleRate`, `channels`                          | Number            | From ffprobe.                                                                                                                                                                               |
| `peaks[]`                                         | Number[]          | ~400 buckets; drives waveform UI without fetching audio.                                                                                                                                    |
| `status`                                          | enum              | `uploading` → `pending` → `processing` → `ready` \| `failed`.                                                                                                                               |
| `attempts`, `lastError`, `claimedAt`, `claimedBy` | —                 | Queue/retry state.                                                                                                                                                                          |

Indexes: `{ownerId, kind}`, `{ownerId, tags}`, `{status, createdAt}` for the
claim query.

#### Music variants

The POC ships two files per music track — `name.ogg` (seamless loop) and
`name_once.ogg` (composed ending) — and its `∞`/`1×` toggle selects between
them. That is a shipped, documented feature. `onceRenditions` exists in the
schema from day one so phase 2 does not open with a migration.

**In this phase the field is reserved but never written.** The UI for
attaching a `once` variant ships in phase 2, alongside the `∞`/`1×`
toggle that consumes it — building the attach flow now would produce a field
nothing reads. The worker requires no change to support it later: a `once`
variant is transcoded by the same pipeline, writing to `onceRenditions` instead
of `renditions`. Readers must therefore treat `onceRenditions` as always absent
until phase 2.

#### Queue-on-document

A worker claims work with one atomic operation:

```js
findOneAndUpdate(
  { status: 'pending' },
  { $set: { status: 'processing', claimedAt: new Date(), claimedBy: workerId } },
  { sort: { createdAt: 1 } }
);
```

A reaper returns rows stuck in `processing` past a timeout to `pending`.

**Trade-off, accepted knowingly:** this keeps everything in one collection with
no new infrastructure, but if a second job type is ever added this should become
a real queue rather than growing more status enums.

### Upload flow

1. Client requests a presigned URL per file. Server creates the `AudioAsset`
   (`status: 'uploading'`) and returns `{ assetId, uploadUrl }`.
2. Client `PUT`s directly to R2 (the pattern `uploadToR2` already uses).
3. Client calls `confirmAudioUpload(assetId)`; server flips it to `pending`.

**Step 3 is a security requirement, not bookkeeping.** A presigned `PUT` cannot
enforce a size limit — S3/R2 support content-length conditions only on POST
policies. Confirm therefore issues a `HeadObject`, validates real size and
content type against the cap, and deletes the object and fails the asset if they
do not match. Without it the size cap is decorative.

### Ingest API surface

The browser is **not** the only ingest client: phase 3's Python tool uses
the same two steps. That rules out implementing ingest solely as TanStack Start
server functions — those speak an internal RPC protocol that is not a stable
contract for an external client, and pinning a Python tool to it would break on
framework upgrades.

Ingest is therefore structured as **one shared module with two thin adapters**,
the pattern `readyz.ts` already uses (a server route delegating to
`~/server/functions/health`):

| Consumer    | Adapter                                                                         | Auth           |
| ----------- | ------------------------------------------------------------------------------- | -------------- |
| Browser     | `createServerFn` wrapper                                                        | Session cookie |
| Python tool | Server route — `POST /api/audio/uploads`, `POST /api/audio/uploads/:id/confirm` | Bearer token   |

Both adapters call the same implementation, so validation, the `HeadObject` size
check, and asset creation cannot drift between clients. Only the auth check
differs.

**Personal access tokens do not exist in Cartyx today** — authentication is
session-cookie only. Issuing, storing (hashed), scoping, and revoking a token is
real work, and it belongs to **phase 3**, where the tool that needs it is
built. Phase 1's obligation is narrower: put the ingest logic in a shared
module and expose the server routes, with the token check stubbed to reject
until phase 3 implements it. That keeps this phase from building an
auth system nothing uses yet, while ensuring phase 3 does not have to
restructure ingest to add one.

Accepting client-supplied metadata (`kind`, facets, tags) on the upload request
is part of this surface from the start — it is how generated audio arrives
pre-classified, and the browser dropzone's batch-default uses the same field.

### Worker pipeline

New `audio-worker/` package alongside `realtime/`; Node + ffmpeg on Alpine.
Per claimed asset:

1. `ffprobe` → true duration, sample rate, channels.
2. `loudnorm=I=-20:TP=-1.5` → the POC's target.
3. Encode **Opus** (`libopus`, Ogg) and **AAC** (`aac`, M4A).
4. Decode to mono PCM, downsample to ~400 buckets → `peaks[]`.
5. Upload renditions, write metadata, `status: 'ready'`.

Concurrency defaults to 2 (configurable). Retries with backoff to `attempts: 3`,
then `failed` with `lastError`. Permanent failures (corrupt source) are
distinguished from transient ones (R2 timeout) and are not retried.

#### Why two renditions

Players are on browsers we do not control. Opus covers Chrome/Firefox at small
file sizes; AAC/M4A covers Safari/iOS. The client selects via `canPlayType`.
This is the concrete payoff of server-side processing: format compatibility is
solved once, centrally, instead of being each uploader's problem.

#### Gapless looping

AAC carries encoder delay and padding. Decoding it with `decodeAudioData`
yields an `AudioBuffer` slightly longer than the real content, so a looping
ambience track **ticks on every repeat — on Safari specifically**, which is the
main use case on the browser the AAC rendition exists to serve.

The fix is not a different codec. The board (phase 2) sets
`source.loopStart = 0` and `source.loopEnd = durationMs / 1000` using ffprobe's
value rather than trusting `buffer.duration`, giving sample-accurate looping
regardless of codec padding. **This only works if an accurate duration is stored
now**, which is why step 1 is ffprobe rather than reading the decoded buffer.

### UI

Components in `app/components/audio/`, built context-agnostic:

| Component             | Responsibility                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AudioLibraryBrowser` | Filter bar + results. Takes `selectable` / `onSelectionChange` and an actions slot, so it does not know whether it is managing or picking. |
| `AudioFilterBar`      | Kind chips, facet multi-selects, tag autocomplete, text search                                                                             |
| `AudioAssetRow`       | Title, kind badge, facets, duration, waveform, preview                                                                                     |
| `AudioWaveform`       | Renders `peaks[]`; fetches no audio                                                                                                        |
| `AudioUploadDropzone` | Multi-file drop, per-file progress, batch default kind                                                                                     |
| `AudioBulkTagBar`     | Multi-select bulk apply of kind/facets/tags                                                                                                |
| `AudioAssetDetail`    | Single-asset edit                                                                                                                          |

**Route:** `/audio`, a new top-level route beside `dashboard.tsx`.

**In-campaign mounting is deferred to phase 2.** The components are
designed for reuse, but nothing in a campaign can receive a picked asset until
packages exist. Building a picker now means building a throwaway destination for
it.

**Filtering is server-side.** Mongo query on `ownerId` plus optional `kind`,
`$in` on facets, `$all` on tags, and a title match, with cursor pagination. The
client never receives the full set.

Facet counts (`forest (23)`) are **deferred**: they need an aggregation per
query and only earn their cost once the library is large.

**`kind` is set at drop time.** Since it is required and drives playback
defaults, the dropzone takes a batch default — a folder of ambience is usually
dropped together — with per-file override afterwards. "Needs tagging" then means
_ready but no facets or tags_, available as a saved filter so bulk-uploaded
files cannot vanish into the pile.

**Preview is a plain `<audio>` element.** Auditioning one file to tag it does
not need the Web Audio graph; that engine arrives with the board. Two competing
playback implementations would be worse than a dumb one here.

### Existing conventions to respect

- Deletes go through the shared `ConfirmDialog` (per `faaa4b0`).
- Overflow menus and focus restoration follow `b95cbd2` / `9bba23d`.
- Every component needs a story; `test:storybook` runs stories in a real browser
  and blocks CI.

## Integration points

Easy to miss, and each breaks something silently if skipped:

| File                              | Change                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app/server/functions/uploads.ts` | `ALLOWED_TYPES` is image-only. Add audio MIME types and a size cap.                                     |
| `app/server/functions/cleanup.ts` | Add `uploads/audio/` to `TRACKED_PREFIXES`, or the orphan scanner ignores every audio file ever stored. |
| `.github/dependabot.yml`          | Add an `/audio-worker` npm entry targeting `dev` — the same gap fixed for `/realtime` on 2026-07-28.    |
| `.github/workflows/deploy.yml`    | Build/push `cartyx-audio-worker`; add a `# ci:worker-tag` marker in `cartyx-infrastructure`.            |
| `deploy/charts/cartyx/`           | `worker-deployment.yaml` + values, `replicas: 1`, explicit CPU limits. Run `render-tests.sh`.           |

## Error handling

| Failure                               | Handling                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Confirm rejects size/type             | Delete the R2 object, mark `failed`, surface inline. The object must go or storage is paid for a refused file.                           |
| Source will not decode / ffmpeg error | `failed` + `lastError`, retry button. Permanent vs transient classified.                                                                 |
| Worker down                           | Assets sit in `pending`. UI shows "waiting to process" with elapsed time — a stalled queue must be visible, never an indefinite spinner. |
| Worker dies mid-job                   | Reaper reclaims past the `claimedAt` timeout; `attempts` caps poison files.                                                              |
| Partial batch                         | Per-file rows and per-file jobs from creation, so 3 failures out of 50 cannot endanger the other 47.                                     |

Backend-unavailable paths reuse the existing `backend-health.ts`,
`circuit-breaker.ts`, `retryMutation.ts`, and `BackendUnavailableError` rather
than inventing a parallel story.

**Telemetry:** client via `captureException`/`captureEvent`, server via
`serverCaptureException`/`serverCaptureEvent`, both safe no-ops without env vars.
The worker is a new service and needs its own wiring — pino matching
`realtime/src/logger.ts`, plus exception capture and an explicit event on
transcode failure. A silently failing worker is the most likely way this feature
rots.

## Testing

- **Unit** (vitest, mocked mongoose per house pattern — no in-memory Mongo):
  the atomic claim (two workers must never claim one asset), the reaper,
  retry/backoff classification, confirm-step validation, filter-query
  construction.
- **Stories** for every component; story tests run in a real browser.
- **Worker integration test with real ffmpeg**: a tiny WAV fixture in, assert
  two renditions, correct duration, sane peaks. Mocking ffmpeg would test
  nothing worth testing. Requires ffmpeg in CI.
- **E2E** (Playwright) on the UI path with seeded `ready` assets — upload →
  filter → bulk-tag → delete. Driving a real transcode through Playwright would
  be slow and flaky for little added signal.

### Targeted fix to existing code

`realtime/` currently has **no CI job at all** — nothing typechecks, tests, or
audits it on any PR. This work adds a second unbuilt service. Add one `services`
CI job covering both `realtime/` and `audio-worker/` rather than shipping a
third service with the same blind spot. This is also why the `/realtime`
dependabot gap went unnoticed long enough to produce an unmergeable
`main`-targeted PR (#534).

## Rollout

All configuration is server-side env — Mongo URI, R2 credentials, CDN URL,
concurrency, size cap. Nothing is `VITE_PUBLIC_*`, so no image rebuild is needed
to change a setting (contrast the client-baked env rules in the `deploying`
skill). The worker ships at `replicas: 1` with explicit CPU limits.

## Open questions

None blocking. Deferred by choice: facet counts, in-campaign mounting
(phase 2), and any global/shared library.
