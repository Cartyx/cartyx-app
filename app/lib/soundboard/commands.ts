import type { AudioPackageData } from '~/types/soundboard';

/**
 * The full vocabulary the GM board's reducer (and, in phase 2b, the
 * realtime broadcast channel) can act on. Every command is a plain,
 * serializable value — no functions, no `Date`/timer handles — so it can be
 * replayed by `boardReducer` and later re-broadcast verbatim.
 *
 * `loadPackage` carries the resolved package (`pkg`), not a bare
 * `packageId`, and this is an AUTHORIZATION choice, not a purity one.
 * `packageVisibilityFilter` (`~/server/functions/packages.ts`) scopes every
 * package read to `{ $or: [{ ownerId: userId }, { ownerId: null }] }` — a
 * player in the GM's campaign cannot fetch the GM's own (non-system)
 * package by id at all. An id-only `loadPackage` broadcast would resolve
 * for system packages and silently fail (or 403) for every GM-owned one,
 * which is the common case. Carrying the already-authorized `pkg` payload
 * sidesteps that: whoever dispatches `loadPackage` proves they could see
 * the package by already holding its contents, and every recipient — GM or
 * player, in phase 2b — gets the same data without a second fetch that
 * would fail for exactly the packages this board is built to run.
 * `useSoundboard(campaignId, pkg)` (Task 12) receiving `pkg` directly, and
 * `initialBoardState(pkg)`'s identical signature, both follow from this.
 * This is the one place this file's command shapes diverge from the plan
 * doc's snippet — `docs/specs/2026-07-30-soundboard-packages-plan.md` and
 * `…-design.md` were amended alongside this comment; see the Task 9 report
 * for the full history (an earlier version of this comment argued purity
 * alone, which is incomplete: a curried `makeBoardReducer(lookup)` would
 * have kept `packageId` and stayed pure — authorization is the real reason
 * an id can't work here).
 */
export type SoundboardCommand =
  | { type: 'loadPackage'; pkg: AudioPackageData }
  | { type: 'setMood'; moodId: string }
  | { type: 'play'; itemId: string }
  | { type: 'stop'; itemId: string }
  /**
   * A single random ambient fire (Task 11's scheduler emits this on a
   * timer). Deliberately transient — see `boardReducer`'s `fireOneShot`
   * case for why it never touches `BoardState`.
   */
  | { type: 'fireOneShot'; itemId: string }
  | { type: 'setItemVolume'; itemId: string; volume: number }
  | { type: 'setMasterVolume'; volume: number }
  | { type: 'stopAll' };
