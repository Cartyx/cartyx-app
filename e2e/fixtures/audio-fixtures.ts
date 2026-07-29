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
