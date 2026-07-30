import type { MoodData, PackageItemData } from '~/types/soundboard';

/**
 * Drops every `moods[].states[]` entry whose `itemId` no longer names a
 * surviving item. Moods reference `item.id`, never `assetId` (see the design
 * doc), so anything that removes items — the package editor's remove button
 * (Task 14), or `deleteAudioAsset`'s package prune (Task 20) — leaves a
 * dangling `states[]` entry behind unless it also runs this.
 *
 * Filters `moods[].states[]` by id membership; it does NOT rebuild `states`
 * from `items`. A rebuild-from-items version would silently drop every
 * per-state override (`volume`, `fadeSeconds`, `randomIntervalMin/Max`, even
 * a bare `playing: true`/`false` toggle) for every item that survived, not
 * just the one that was removed — filtering by id membership is the only
 * operation that changes exactly what needs to change and nothing else.
 *
 * Originally lived in `~/routes/audio_.packages_.$packageId.tsx` (Task 14's
 * fix round, prompted by a review finding that the editor's item-removal
 * path orphaned mood states). Moved here — a framework-free module already
 * shared by the reducer/resolve/engine/scheduler pieces — so Task 20's
 * server-side prune (`app/server/functions/audio.ts`'s `deleteAudioAsset`)
 * can reuse the exact same logic instead of hand-rolling a second,
 * subtly-different filter. The route re-exports this for backward
 * compatibility with its existing import path and test file.
 */
export function pruneOrphanedMoodStates(moods: MoodData[], items: PackageItemData[]): MoodData[] {
  const survivingIds = new Set(items.map((item) => item.id));
  return moods.map((mood) => ({
    ...mood,
    states: mood.states.filter((state) => survivingIds.has(state.itemId)),
  }));
}
