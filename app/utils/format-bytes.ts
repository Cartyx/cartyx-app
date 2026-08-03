/**
 * Human-readable byte size, e.g. `512.0 MB` or `2.00 GB`.
 *
 * The audio domain had THREE near-identical copies of this (Task 5's review,
 * phase-B item B2): `AudioQuotaBar.tsx` (the one below, with a GB tier at 2
 * decimals) and `AudioOrphanCleanup.tsx`/`CleanUpPanel.tsx` (no GB tier,
 * stopped at MB with 1 decimal) — so a 2 GiB value rendered `2.00 GB` in one
 * audio panel and `2048.0 MB` in another on the same `/audio` route.
 *
 * This is the audio pair's single shared implementation, using the GB-tier
 * version: `AudioQuotaBar` shows totals against a multi-GiB quota
 * (`AUDIO_USER_QUOTA_BYTES`), where a bare MB figure is the less readable of
 * the two, and this file's own `AudioQuotaBar.test.tsx` already pins that
 * exact "512.0 MB of 2.00 GB used" / "1.00 GB of 2.00 GB used" output — so
 * that panel's rendering is UNCHANGED by the consolidation.
 *
 * `AudioOrphanCleanup`'s rendering DOES change: individual orphan sizes stay
 * under the MB tier (`AUDIO_MAX_BYTES` caps a single asset at 50 MB, well
 * under 1 GiB), but its "Delete N files (total)" summary sums every orphan
 * found, and that aggregate can cross 1 GiB on an account with enough
 * orphaned files — where it now renders e.g. `1.17 GB` instead of
 * `1200.0 MB`.
 *
 * `CleanUpPanel.tsx` (campaign image orphan cleanup, `~/components/mainview/
 * settings/`) deliberately keeps its OWN copy rather than importing this one.
 * It sits outside the audio domain entirely — a different route, a different
 * actor model (campaign GM, not the audio library's owner), and a different
 * resource (images, which this task never touched and which have no
 * observed formatting divergence to fix). Folding it in would widen this
 * fix's blast radius into an unrelated panel for a cosmetic-only upside (an
 * even-larger orphaned-image total rendering in GB instead of MB), so it is
 * left alone; nothing stops a later task from doing the same consolidation
 * there if a real divergence ever shows up.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
