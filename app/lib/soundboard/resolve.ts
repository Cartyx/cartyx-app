import type { PackageItemData, MoodStateData } from '~/types/soundboard';

/**
 * One item's fully-resolved playback state for a given mood (or lack of
 * one). This is what the Web Audio engine (Task 10) and the random one-shot
 * scheduler (Task 11) actually consume — never `PackageItemData` or
 * `MoodStateData` directly, since those represent "defaults" and "overrides"
 * rather than "what should be true right now".
 */
export type ResolvedItemState = {
  playing: boolean;
  volume: number;
  fadeSeconds: number;
  /**
   * `undefined` when neither the mood nor the item sets a random-fire
   * window — i.e. this item is not a randomly-scheduled ambient one-shot in
   * this mood. Task 11 should treat `undefined` (either bound) as "do not
   * schedule a random fire for this item", not as "use some fallback
   * interval".
   */
  randomIntervalMin: number | undefined;
  randomIntervalMax: number | undefined;
  loop: boolean;
  assetId: string;
};

/**
 * Resolves one package item's playback state for a given mood — the
 * two-record merge at the seam phase 1 kept getting wrong.
 *
 * The rule, and the whole point of this function: **an override applies
 * only when present.** `undefined` inherits from the item; `0` and `false`
 * are values, not absence — `volume: 0` in a mood means silent, not
 * "inherit the item's 0.8". Every field below is therefore resolved with
 * `??`, never `||`: `moodState.volume || item.volume` would silently turn
 * an explicit silence override back into the item's default volume,
 * because `0` is falsy.
 *
 * `moodState` is `undefined` when the mood's `states[]` doesn't name this
 * item at all. That must resolve to `playing: false` — switching mood has
 * to silence every item the new mood doesn't mention, or the previous
 * scene's tracks keep running underneath the new one. `playing` therefore
 * always comes from `moodState` alone: an item has no item-level "playing"
 * to inherit, since it isn't playing outside of some mood's context.
 *
 * `loop` and `assetId` have no mood-level override at all (see
 * `MoodStateData`) and always come from the item.
 */
export function resolveItemState(
  item: PackageItemData,
  moodState: MoodStateData | undefined
): ResolvedItemState {
  return {
    playing: moodState?.playing ?? false,
    volume: moodState?.volume ?? item.volume,
    fadeSeconds: moodState?.fadeSeconds ?? item.fadeSeconds,
    randomIntervalMin: moodState?.randomIntervalMin ?? item.randomIntervalMin,
    randomIntervalMax: moodState?.randomIntervalMax ?? item.randomIntervalMax,
    loop: item.loop,
    assetId: item.assetId,
  };
}
