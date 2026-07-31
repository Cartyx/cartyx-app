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

/**
 * Packages a single user may own, enforced with a `countDocuments` before
 * every insert — `createPackage` and `clonePackage` — exactly the way
 * `mapAoE.ts`'s `MAX_AOE_PER_MAP`, `gmscreens.ts` and the tabletop screens do
 * it. System packages (`ownerId: null`) are never counted: they are not the
 * caller's, and one user creating packages must not push another user (or the
 * shared catalogue) against a cap.
 *
 * 100, and the number comes from the memory arithmetic rather than taste. A
 * MAXED package — 64 items with 200-char labels and 24-char ids, 32 moods of
 * 64 states each, a 2000-char description — serializes to roughly 410 KiB.
 * The web pod is `replicaCount: 1` at `limits.memory: 512Mi`
 * (`deploy/charts/cartyx/values.yaml`), so a read that loads every package a
 * user owns is bounded at ~41 MiB of JSON — several times that once it is
 * live JS objects, but still a fraction of the pod rather than a multiple of
 * it. At the ~1,200 packages an uncapped account could reach, the same read
 * is ~480 MiB of JSON alone and the pod is OOMKilled for every user, not just
 * the one who did it.
 *
 * `listPackages` no longer performs that read at all (it projects `items`/
 * `moods` away and returns counts), so this cap is the second of two
 * independent defences, not the only one: it bounds what a future
 * un-projected read — or a Mongo-side working set — can cost. 100 is also far
 * past any plausible use: a package is a scene set, and a campaign runs on a
 * handful.
 */
export const MAX_PACKAGES_PER_USER = 100;

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

/**
 * What a package LIST row is: everything `AudioPackageData` carries except
 * the two embedded arrays, plus their sizes.
 *
 * `listPackages` returns these, not full packages, and the distinction is a
 * memory bound rather than a tidiness one. The list view (`PackageList`) and
 * the board's package picker between them read `id`, `ownerId`, `name`,
 * `description` and the two array LENGTHS — never an item or a mood itself —
 * while a maxed package serializes to ~410 KiB, essentially all of it
 * `items`/`moods`. Sending the arrays so a component can call `.length` on
 * them made every visit to `/audio/packages` proportional to the caller's
 * whole library on a `replicaCount: 1`, 512Mi pod. The counts come from
 * Mongo's own `$size`, so the arrays never leave the database.
 *
 * `getPackage` still returns the full `AudioPackageData` — the editor and the
 * board genuinely need every item and mood, for exactly one package at a time.
 */
export type AudioPackageSummaryData = Omit<AudioPackageData, 'items' | 'moods'> & {
  itemCount: number;
  moodCount: number;
};

/** One item's live playback state on the board. */
export type BoardItemStateData = {
  itemId: string;
  playing: boolean;
  volume: number;
};

/**
 * The GM board's live state, persisted per campaign so a reload does not
 * silence the table. `packageId` and `moodId` are both `null` when nothing
 * has been loaded yet — matching Task 3's `SoundboardState` model, which
 * makes both fields nullable for exactly this reason. (This type originally
 * had `packageId: string`, non-nullable — the same defect Task 6's review
 * found in `saveBoardStateSchema`, just in the plain-TS sibling instead of
 * the Zod one. Fixed alongside it: a fresh campaign's board, with nothing
 * loaded, needs to be representable here too.)
 */
export type BoardStateData = {
  campaignId: string;
  packageId: string | null;
  moodId: string | null;
  items: BoardItemStateData[];
  masterVolume: number;
};
