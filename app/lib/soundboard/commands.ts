import type { AudioPackageData } from '~/types/soundboard';

/**
 * The full vocabulary the GM board's reducer (and, in phase 2b, the
 * realtime broadcast channel) can act on. Every command is a plain,
 * serializable value — no functions, no `Date`/timer handles — so it can be
 * replayed by `boardReducer` and later re-broadcast verbatim.
 *
 * `loadPackage` carries the resolved package (`pkg`), not a bare
 * `packageId`. A pure reducer with no network access cannot turn an id into
 * a package's items and moods by itself — and `setMood` (below) MUST see
 * every item and mood definition to resolve "every item in the package, not
 * just the ones the mood names" (see `reducer.ts`). The caller already has
 * the full package in hand before it can meaningfully dispatch this command
 * — `useSoundboard(campaignId, pkg)` (Task 12) receives `pkg` as an argument
 * for exactly this reason, mirroring `initialBoardState(pkg)`'s own
 * signature. This is the one place this file's command shapes diverge from
 * the plan doc's snippet; see the Task 9 report for the full reasoning.
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
