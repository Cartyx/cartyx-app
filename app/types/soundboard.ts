/**
 * Items are capped at 64 per package, moods at 32. A board with more pads
 * than that is unusable as a live surface long before the embedded document
 * approaches Mongo's own limits, so this is a usability bound that happens to
 * also bound the document. Enforced in the Zod schema (see
 * `~/types/schemas/soundboard`) — phase 1 shipped an uncapped `tags` array
 * into a `$all` query precisely by omitting a bound one of its sibling
 * schemas already had.
 */
export const MAX_PACKAGE_ITEMS = 64;
export const MAX_PACKAGE_MOODS = 32;

export const DEFAULT_VOLUME = 1;
export const DEFAULT_FADE_SECONDS = 2;

/**
 * A single pad: one library asset placed in a package with its own playback
 * settings.
 *
 * `id` is stable WITHIN THE PACKAGE and is what `Mood.states[].itemId`
 * references — never `assetId`. That indirection is what lets one `thunder`
 * asset appear in many moods at different volumes and different random
 * rates ("every 30-90s" in one mood, "every 3-5 minutes" in another) without
 * duplicating the item.
 */
export type PackageItemData = {
  id: string;
  assetId: string;
  /** Optional override of the asset's own title, shown on this package's pads. */
  label?: string;
  volume: number;
  fadeSeconds: number;
  loop: boolean;
  /** One-shot scheduling — "thunder goes off occasionally". Seconds. */
  randomIntervalMin?: number;
  randomIntervalMax?: number;
  /** One-shot variation, applied per fire. */
  volumeJitter?: number;
  panJitter?: number;
  /** Board ordering. */
  sortIndex: number;
};

/**
 * One item's playback state as overridden by a mood. Every field here is
 * optional and `undefined` means "inherit from the item" — `mood ?? item` is
 * the resolution rule `resolveItemState` (Task 8) implements. Because `0` and
 * `false` are meaningful override values (silence, or "do not autoplay this
 * pad in this mood"), these must stay genuinely optional rather than
 * defaulted — a defaulted `volume: number` would make "inherit" and "set to
 * the default" indistinguishable.
 */
export type MoodStateData = {
  itemId: string;
  playing: boolean;
  volume?: number;
  fadeSeconds?: number;
  randomIntervalMin?: number;
  randomIntervalMax?: number;
};

/** A named preset within a package — a complete scene description. */
export type MoodData = {
  id: string;
  name: string;
  states: MoodStateData[];
};

/**
 * A themed, self-contained collection of library assets with per-package
 * playback settings. `ownerId` is nullable: `null` means a system package
 * (phase 3's generated catalogue), readable by everyone but editable by no
 * one — cloning is how a user makes their own copy.
 */
export type AudioPackageData = {
  id: string;
  ownerId: string | null;
  name: string;
  description: string | null;
  items: PackageItemData[];
  moods: MoodData[];
  createdAt: string;
  updatedAt: string;
};

/** One item's live playback state on the board. */
export type BoardItemStateData = {
  itemId: string;
  playing: boolean;
  volume: number;
};

/**
 * The GM board's live state, persisted per campaign so a reload does not
 * silence the table. `moodId` is `null` when no mood has been selected yet.
 */
export type BoardStateData = {
  campaignId: string;
  packageId: string;
  moodId: string | null;
  items: BoardItemStateData[];
  masterVolume: number;
};
