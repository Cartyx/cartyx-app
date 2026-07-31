import { z } from 'zod';
import { objectId } from '~/types/schemas/audio';
import { MAX_PACKAGE_ITEMS, MAX_PACKAGE_MOODS } from '~/types/soundboard';

const volume = z.number().min(0).max(1);
const fadeSeconds = z.number().min(0).max(30);

/**
 * One-shot scheduling interval, in seconds — "thunder goes off occasionally".
 * Capped at an hour: anything longer belongs to the GM manually triggering
 * the pad, not the scheduler.
 */
const randomIntervalSeconds = z.number().int().positive().max(3600);

/**
 * `PackageItem.id`, `Mood.id`, and every reference to either
 * (`Mood.states[].itemId`, board state's `items[].itemId`/`moodId`) are
 * client-generated stable ids scoped to their package — NOT Mongo
 * ObjectIds, so they get a generic bound rather than the `objectId` regex.
 */
const stableId = z.string().min(1).max(64);

/**
 * Shared by `packageItemSchema` and `moodStateSchema`: both carry an
 * optional `randomIntervalMin`/`randomIntervalMax` pair, and an inverted
 * range (min > max) is a scheduler that can never fire — reject it at the
 * boundary rather than have the scheduler silently do nothing.
 */
function validRandomInterval(data: { randomIntervalMin?: number; randomIntervalMax?: number }) {
  return (
    data.randomIntervalMin === undefined ||
    data.randomIntervalMax === undefined ||
    data.randomIntervalMin <= data.randomIntervalMax
  );
}
const randomIntervalRefinement: { message: string; path: (string | number)[] } = {
  message: 'randomIntervalMin must be <= randomIntervalMax',
  path: ['randomIntervalMax'],
};

/**
 * A single pad. `assetId` is ObjectId-validated here — the one boundary
 * every ingest path (package create/update, and eventually clone) shares —
 * so a malformed reference never reaches Mongo as a `CastError`.
 *
 * `sortIndex` defaults to `0` rather than being required: packages are
 * authored incrementally in the editor, and the client assigns real indices
 * as items are ordered, not at construction time.
 */
export const packageItemSchema = z
  .object({
    id: stableId,
    assetId: objectId,
    label: z.string().min(1).max(200).optional(),
    volume,
    fadeSeconds,
    loop: z.boolean(),
    randomIntervalMin: randomIntervalSeconds.optional(),
    randomIntervalMax: randomIntervalSeconds.optional(),
    volumeJitter: z.number().min(0).max(1).optional(),
    panJitter: z.number().min(0).max(1).optional(),
    sortIndex: z
      .number()
      .int()
      .min(0)
      .max(MAX_PACKAGE_ITEMS - 1)
      .default(0),
  })
  .refine(validRandomInterval, randomIntervalRefinement);

/**
 * A mood's override of one item's playback state. Every override field is
 * `.optional()` and NONE may gain a `.default()` — `resolveItemState`
 * (`mood ?? item`) depends on `undefined` meaning "inherit" while `0` and
 * `false` remain meaningful overrides (silence a track; don't autoplay it in
 * this mood). Defaulting any of these here would make "inherit" and "set to
 * the default" indistinguishable before the resolver ever runs.
 *
 * Module-private, like `boardItemStateSchema` below: both are embedded-array
 * element schemas with no standalone caller, and the brief's export list
 * names only the schemas a server function actually parses input with
 * (`moodSchema` itself, not its `states[]` element type).
 */
const moodStateSchema = z
  .object({
    itemId: stableId,
    playing: z.boolean(),
    volume: volume.optional(),
    fadeSeconds: fadeSeconds.optional(),
    randomIntervalMin: randomIntervalSeconds.optional(),
    randomIntervalMax: randomIntervalSeconds.optional(),
  })
  .refine(validRandomInterval, randomIntervalRefinement);

/**
 * A named preset within a package. `states` is capped at `MAX_PACKAGE_ITEMS`
 * — a mood can override at most one state per item that exists.
 */
export const moodSchema = z.object({
  id: stableId,
  name: z.string().min(1).max(200),
  states: z.array(moodStateSchema).max(MAX_PACKAGE_ITEMS).default([]),
});

export const createPackageSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  items: z.array(packageItemSchema).max(MAX_PACKAGE_ITEMS).default([]),
  moods: z.array(moodSchema).max(MAX_PACKAGE_MOODS).default([]),
});

export const updatePackageSchema = z.object({
  id: objectId,
  /**
   * The `updatedAt` the caller last SAW, as the ISO string `serializePackage`
   * emitted — the optimistic-concurrency precondition. `updatePackage` ANDs
   * it into the update filter, so a write built from a stale read matches no
   * document and is refused instead of replacing `items`/`moods` wholesale
   * over whatever landed in between (see `updatePackage`'s doc comment).
   *
   * REQUIRED, not optional. Every field below is a whole-array replace, so an
   * unfenced update is a last-write-wins clobber by construction; making the
   * fence opt-in would mean any caller that simply omitted it — a stale
   * bundle, a hand-rolled request — got the old destructive behaviour back
   * and the guard would protect only the callers that did not need
   * protecting.
   *
   * `.datetime()` (the same form `~/types/schemas/sessions.ts` uses) accepts
   * exactly what `Date.prototype.toISOString` produces, which is the only
   * thing that ever populates this field.
   */
  expectedUpdatedAt: z.string().datetime(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  items: z.array(packageItemSchema).max(MAX_PACKAGE_ITEMS).optional(),
  moods: z.array(moodSchema).max(MAX_PACKAGE_MOODS).optional(),
});

/**
 * System packages are read-only; cloning is how a user gets an editable copy
 * (see the design doc's visibility rule). `name` optionally renames the
 * clone; omitted, the server names it after the source.
 */
export const clonePackageSchema = z.object({
  id: objectId,
  name: z.string().min(1).max(200).optional(),
});

export const deletePackageSchema = z.object({ id: objectId });

/** A single package lookup by id, visibility-scoped (owner or system package). */
export const getPackageSchema = z.object({ id: objectId });

/**
 * The assets one package's items reference — Task 21's package-gated read.
 * `packageId` is validated the same way every other package-id field in this
 * file is; the `$in` bound and ownership check happen server-side in
 * `listPackageAssets`, not here.
 */
export const listPackageAssetsSchema = z.object({ packageId: objectId });

/** Module-private — see the comment on `moodStateSchema` above. */
const boardItemStateSchema = z.object({
  itemId: stableId,
  playing: z.boolean(),
  volume,
});

/**
 * The GM board's live state for one campaign. Capped at `MAX_PACKAGE_ITEMS`
 * entries for the same reason the package's own `items[]` is — one entry per
 * item that exists, at most.
 *
 * `packageId`/`moodId`: nullable AND optional. A campaign can legitimately
 * have a board with nothing loaded yet — Task 3's `SoundboardState` model
 * makes both fields nullable for exactly this reason (`packageId: { default:
 * null }`, `moodId: { default: null }`). This schema originally typed
 * `packageId` as a required `objectId`, which a fresh-campaign save (no
 * package chosen yet) fails to parse against — caught by a review running
 * this file's own Task 6 fixture (`{ campaignId, masterVolume }`, no
 * `packageId`/`moodId` at all) through it. The model was correct; this
 * schema was not.
 */
export const saveBoardStateSchema = z.object({
  campaignId: objectId,
  packageId: objectId.nullable().optional(),
  moodId: stableId.nullable().optional(),
  items: z.array(boardItemStateSchema).max(MAX_PACKAGE_ITEMS).default([]),
  masterVolume: volume,
});

// Checked for the same packageId/moodId nullability defect as
// `saveBoardStateSchema` above: it has none, because it carries no
// `packageId`/`moodId` field at all — a load is identified purely by
// `campaignId`, so there is nothing here that could reject a "nothing
// loaded" board.
export const loadBoardStateSchema = z.object({
  campaignId: objectId,
});
