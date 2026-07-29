/**
 * The R2 key layout, worker side.
 *
 * MIRRORS `app/server/functions/audio-storage.ts`. The worker is a separate
 * package with its own tsconfig and deliberately imports nothing from `app/`,
 * so the layout is stated in both places; each side has a test pinning the
 * exact strings (`audio-worker/tests/keys.test.ts` and
 * `tests/server/functions/audio-storage.test.ts`), so a change on one side
 * fails on that side rather than silently producing keys the other cannot see.
 *
 *   source:    uploads/audio/<prefix>/<timestamp>-<random>.<ext>
 *   rendition: uploads/audio/<prefix>/renditions/<assetId>.<opus|m4a>
 *
 * The prefix is 32 hex characters of per-user randomness minted by the app. It
 * is what makes the app's audio cleanup owner-scoped by construction: a
 * `ListObjectsV2` under `uploads/audio/<prefix>/` cannot return another user's
 * object, so anything it returns that no row references is reclaimable. That
 * only holds if renditions live under the prefix TOO — a rendition written to
 * a shared `uploads/audio/renditions/` root would fall outside every user's
 * listing and be exactly as unreclaimable as the flat layout this replaced.
 * Hence the derivation below rather than a constant.
 */

/** The prefix segment of a source key: 32 lowercase hex characters. */
const STORAGE_PREFIX_RE = /^uploads\/audio\/([0-9a-f]{32})\/[^/]+$/;

/**
 * The per-user storage prefix carried by a source key, or null if the key is
 * not in the current layout.
 *
 * Deriving it from the source key rather than reading it from the row or the
 * User document keeps renditions beside the source they came from by
 * construction — there is no second value that could disagree with the first.
 */
export function storagePrefixFromSourceKey(sourceKey: string): string | null {
  return STORAGE_PREFIX_RE.exec(sourceKey)?.[1] ?? null;
}

/**
 * The rendition key stem for an asset — callers append `.opus` / `.m4a`.
 * Null when the source key predates the per-user layout, which the caller must
 * treat as a permanent failure: renditions written outside a user's namespace
 * are invisible to that user's cleanup, and no number of retries changes the
 * source key.
 */
export function renditionKeyBase(sourceKey: string, assetId: string): string | null {
  const prefix = storagePrefixFromSourceKey(sourceKey);
  return prefix ? `uploads/audio/${prefix}/renditions/${assetId}` : null;
}
