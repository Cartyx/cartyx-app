/**
 * Shared identifiers for the audio-library E2E fixtures. `globalSetup.ts`
 * upserts one `AudioAsset` document per key here (owned by the seeded GM
 * user) so `audio-library.spec.ts` has real, addressable rows to drive —
 * there is no seeded audio data otherwise, and the transcode worker does not
 * run in E2E, so nothing would ever reach `ready` without this.
 *
 * Titles double as the natural key tests select rows by (`getByText`,
 * `aria-label` interpolation) — kept here so globalSetup and the spec can't
 * drift against each other.
 */
export const AUDIO_FIXTURE_TITLES = {
  /** status: ready. Has tags/environment/mood, so it's excluded from "needs tagging". Read by several tests; only the bulk-tag test mutates it (adds a tag, additively — safe to share). */
  ambienceReady: 'E2E Audio — Ambience Ready',
  /** status: ready, no tags/environment/mood — the one row "needs tagging" should surface. Read-only across tests. */
  musicUntagged: 'E2E Audio — Music Untagged',
  /** status: processing (never ready — no worker runs in E2E). Used to prove Play is withheld for a non-ready row. Read-only. */
  oneShotProcessing: 'E2E Audio — One-shot Processing',
  /** status: ready. Exclusively owned by the edit-modal test, which renames it. */
  editMe: 'E2E Audio — Edit Me',
  /** status: ready. Exclusively owned by the delete test, which removes it — globalSetup re-creates it on every run. */
  deleteMe: 'E2E Audio — Delete Me',
} as const;

/**
 * The storage-quota fixture `audio-hardening.spec.ts` depends on (phase 1.5,
 * Task 12): enough seeded bytes, owned by the same GM user, to put that user
 * OVER `AUDIO_USER_QUOTA_BYTES` before the spec does anything.
 *
 * WHY SEEDED BYTES AND NOT A LOWERED LIMIT. The other way to produce an
 * over-quota user is to set `AUDIO_USER_QUOTA_BYTES` low for the E2E run. That
 * has to reach the SERVER process, and the only checked-in place to do it is
 * `playwright.config.ts`'s `webServer.env` — which `reuseExistingServer:
 * !process.env.CI` skips entirely whenever a developer already has `npm run
 * dev` on :3000, the normal local working state. The spec's meaning would then
 * depend on whether a dev server happened to be running: green in CI, red (or
 * worse, vacuous) locally. Fixture rows are applied by `globalSetup` against
 * Mongo, so they hold no matter which process serves the request — and the
 * quota reads Mongo, never R2, so no real stored objects are needed.
 *
 * WHY THE BYTES ARE SPREAD, AND WHY THERE IS MORE THAN ONE ROW.
 * `getUserStorageUsage` (`app/server/functions/audio-quota.ts`) is a `$group`
 * summing SIX byte fields across every row a user owns. A single row with a
 * single huge `sourceBytes` would put the user over the limit while exercising
 * one term of that sum and no grouping at all — it would still pass if five of
 * the six fields were dropped from the aggregation. Each filler below carries
 * a value in every one of the six fields, and there are three of them.
 *
 * READ THIS BEFORE WRITING A SPEC THAT UPLOADS AUDIO. These rows put the
 * seeded GM over the storage quota for the WHOLE run, in every spec, not just
 * `audio-hardening.spec.ts` — that user shares one library across the suite.
 * Any new spec that uploads a file, or attaches a once-variant, will be
 * refused by `assertUnderStorageQuota` with a message about storage, which is
 * a confusing thing to meet when your spec is about something else entirely.
 * No spec is affected today (verified: nothing else in `e2e/` uploads). If
 * yours needs to, delete these rows for the duration of your test rather than
 * removing the seed — `audio-hardening.spec.ts` depends on them existing.
 *
 * The per-row totals are deliberately larger than a real upload could produce
 * (`AUDIO_MAX_BYTES` caps one source at 50 MiB): reaching 2 GiB with realistic
 * per-asset figures takes ~17 rows, which would bury `audio-library.spec.ts`'s
 * five fixtures in noise for no gain — the quota never re-measures R2, it sums
 * exactly these fields.
 */
export const AUDIO_QUOTA_FIXTURE = {
  /** How many filler rows `globalSetup` upserts. */
  count: 3,
  /**
   * Per row, spread across the six fields `getUserStorageUsage` sums. Totals
   * 800,000,000 per row → 2,400,000,000 across the three, comfortably past the
   * 2 GiB (2,147,483,648) `AUDIO_USER_QUOTA_BYTES` default.
   */
  bytes: {
    source: 300_000_000,
    onceSource: 200_000_000,
    opus: 120_000_000,
    aac: 80_000_000,
    onceOpus: 60_000_000,
    onceAac: 40_000_000,
  },
  /** `${titlePrefix} N` — visible in the library, so it is obvious what these rows are. */
  titlePrefix: 'E2E Audio — Quota Filler',
  /**
   * `${sourceKeyPrefix}N` — the natural key for the upsert, and the ONLY thing
   * `globalTeardown.ts` deletes on. Nothing points at a real R2 object.
   */
  sourceKeyPrefix: 'e2e/fixtures/audio/quota-filler-',
} as const;
