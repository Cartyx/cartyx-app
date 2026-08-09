import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioAsset } from '../db/models/AudioAsset';
import { AudioPackage } from '../db/models/AudioPackage';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { serializeAudioAsset } from './audio';
import type { AudioAssetData } from '~/types/audio';
import { PACKAGE_STALE_WRITE_ERROR_NAME } from '~/lib/soundboard/stale-write';
import { PACKAGE_CLIENT_ERROR_NAME } from '~/lib/client-refusal';
import { pruneOrphanedMoodStates } from '~/lib/soundboard/prune';
import {
  DEFAULT_VOLUME,
  DEFAULT_FADE_SECONDS,
  MAX_PACKAGES_PER_USER,
  type AudioPackageData,
  type AudioPackageSummaryData,
  type PackageItemData,
  type MoodData,
  type MoodStateData,
} from '~/types/soundboard';
import type {
  createPackageSchema,
  updatePackageSchema,
  deletePackageSchema,
  getPackageSchema,
  clonePackageSchema,
  listPackageAssetsSchema,
} from '~/types/schemas/soundboard';

async function ensureDb() {
  if (!isDBConnected()) await connectDB();
}

/**
 * A "not found" from this file, in every case, means one of two things: the
 * id genuinely does not exist, or it belongs to another user's private
 * package. Neither is a server fault — it's a caller asking about a document
 * it cannot see, which for `getPackage` in particular is a shape any
 * authenticated user can trigger just by guessing ids. Same class, same
 * purpose, as `AudioClientError` in `app/server/functions/audio.ts`: it
 * marks the error as "the caller's own doing" so `reportPackageError` below
 * does not file a GlitchTip event for it. Packages has a STRONGER case for
 * this than audio does — `getPackage` reads through the visibility filter,
 * so a probe against ids the caller cannot see is an attacker-controlled
 * GlitchTip volume path if left unguarded.
 */
export class PackageClientError extends Error {
  /**
   * Set only when the refusal is a rate-limit rejection thrown by
   * `~/utils/soundboard-server-fns.ts`'s wrapper gate — same field, same
   * meaning, as `AudioClientError.retryAfterMs`.
   */
  readonly retryAfterMs?: number;

  constructor(message: string, options?: { retryAfterMs?: number }) {
    super(message);
    // From the shared constant — the browser recognises this refusal by
    // `.name` in order to keep its own telemetry as quiet as
    // `reportPackageError` keeps the server's. See `~/lib/client-refusal.ts`.
    this.name = PACKAGE_CLIENT_ERROR_NAME;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/**
 * The optimistic-concurrency refusal: the caller's `expectedUpdatedAt` did
 * not match the stored document, so somebody else wrote to it between the
 * caller's read and their save.
 *
 * A `PackageClientError` SUBCLASS, deliberately — it is the caller's own
 * doing in exactly the same sense (a save built on a read that has since gone
 * out of date), so `reportPackageError` keeps filing no GlitchTip event for
 * it: a second tab left open on an editor would otherwise author one error
 * report per Save click. But it is a DIFFERENT identity from the bare
 * `PackageClientError('Package not found')` its sibling failure throws, and
 * that separation is the point. "Not found" and "changed underneath you" mean
 * opposite things — one says the package is gone or was never yours, the
 * other says it is very much there and newer than you think — and the editor
 * has to offer completely different affordances for each. Nothing downstream
 * should have to regex a message to tell them apart; see
 * `~/lib/soundboard/stale-write.ts` for how the browser recognises this one.
 */
export class PackageStaleWriteError extends PackageClientError {
  /**
   * The `updatedAt` the stored document actually carries, ISO-encoded the way
   * `serializePackage` encodes it. This is the token a client needs to retry
   * the SAME edit as a deliberate overwrite — the editor's "keep my edits"
   * path replays the identical draft with this value as its
   * `expectedUpdatedAt`, which is still a compare-and-swap: if a third write
   * lands in the meantime it is refused again, rather than the retry
   * degrading into an unfenced write.
   *
   * No leak: the update filter this follows is already `ownerId`-scoped, so
   * this value only ever describes a document the caller owns.
   */
  readonly currentUpdatedAt: string;

  constructor(currentUpdatedAt: string) {
    super(
      'This package changed somewhere else after you opened it. Nothing has been lost — your unsaved edits are still here, and the saved version is still stored. Choose which one to keep.'
    );
    this.name = PACKAGE_STALE_WRITE_ERROR_NAME;
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

/**
 * Every package function takes the acting user twice, and the two values are
 * genuinely different things — same split as `app/server/functions/audio.ts`'s
 * `Actor`, and for the same reason:
 *
 * - `userId` is the User document's Mongo `_id`. It is what `AudioPackage.ownerId`
 *   references, so it is the ONLY value that may be used to scope a query.
 * - `sessionUserId` is the OAuth provider's subject id, used for telemetry only.
 *   Phase 1 shipped the provider id into a query and every audio call
 *   CastError'd — this split is what keeps that from happening again here.
 */
type Actor = { userId: string; sessionUserId?: string };

function telemetryId(actor: Actor): string {
  return actor.sessionUserId ?? actor.userId;
}

/** Report to GlitchTip unless the failure was the caller's own doing. */
function reportPackageError(e: unknown, actor: Actor, context: Record<string, unknown>) {
  if (e instanceof PackageClientError) return;
  serverCaptureException(e, telemetryId(actor), context);
}

/**
 * A package is visible to `userId` if they own it, or if it is a system
 * package (`ownerId: null` — phase 3's generated catalogue, readable by
 * everyone). This is the one seam in the soundboard where phase 1's
 * ownerId-only scoping does not apply, so it is expressed exactly once here
 * and reused by every READ below — never an incidental `$or` re-typed at a
 * call site.
 *
 * NEVER used for a write. Every mutation in this file filters on
 * `{ _id, ownerId: userId }` instead — see `updatePackage`/`deletePackage` —
 * so a system package can never be mutated by anyone. If a write ever went
 * through this filter, any authenticated user could edit or delete the
 * shared system catalogue.
 */
export function packageVisibilityFilter(userId: string): {
  $or: [{ ownerId: string }, { ownerId: null }];
} {
  return { $or: [{ ownerId: userId }, { ownerId: null }] };
}

type PackageDoc = Record<string, unknown>;

/**
 * Task 2's model defaults `label`, `volumeJitter`, `panJitter`,
 * `randomIntervalMin` and `randomIntervalMax` to `null` (Mongoose's own
 * default for an unset optional field), but Task 1 types every one of those
 * fields as bare-optional (`label?: string`), never `| null`. A cast
 * (`as PackageItemData`) would compile and ship `null` straight through to a
 * client that expects `undefined` — and Task 8's `mood ?? item` resolution
 * treats an explicit `null` differently than an absent key. So every one of
 * those fields is normalised with `?? undefined` here, not cast.
 */
function serializePackageItem(item: unknown): PackageItemData {
  const i = item as {
    id: string;
    assetId: unknown;
    label?: string | null;
    volume?: number;
    fadeSeconds?: number;
    loop?: boolean;
    randomIntervalMin?: number | null;
    randomIntervalMax?: number | null;
    volumeJitter?: number | null;
    panJitter?: number | null;
    sortIndex?: number;
  };
  return {
    id: i.id,
    assetId: String(i.assetId),
    label: i.label ?? undefined,
    volume: i.volume ?? DEFAULT_VOLUME,
    fadeSeconds: i.fadeSeconds ?? DEFAULT_FADE_SECONDS,
    loop: i.loop ?? false,
    randomIntervalMin: i.randomIntervalMin ?? undefined,
    randomIntervalMax: i.randomIntervalMax ?? undefined,
    volumeJitter: i.volumeJitter ?? undefined,
    panJitter: i.panJitter ?? undefined,
    sortIndex: i.sortIndex ?? 0,
  };
}

/** Same `null` -> `undefined` normalisation as `serializePackageItem`, and for the same reason. */
function serializeMoodState(state: unknown): MoodStateData {
  const s = state as {
    itemId: string;
    playing?: boolean;
    volume?: number | null;
    fadeSeconds?: number | null;
    randomIntervalMin?: number | null;
    randomIntervalMax?: number | null;
  };
  return {
    itemId: s.itemId,
    playing: s.playing ?? false,
    volume: s.volume ?? undefined,
    fadeSeconds: s.fadeSeconds ?? undefined,
    randomIntervalMin: s.randomIntervalMin ?? undefined,
    randomIntervalMax: s.randomIntervalMax ?? undefined,
  };
}

function serializeMood(mood: unknown): MoodData {
  const m = mood as { id: string; name?: string; states?: unknown[] };
  return {
    id: m.id,
    name: m.name ?? '',
    states: (m.states ?? []).map(serializeMoodState),
  };
}

export function serializePackage(p: PackageDoc): AudioPackageData {
  const d = p as {
    _id: unknown;
    ownerId: unknown;
    name?: string;
    description?: string | null;
    items?: unknown[];
    moods?: unknown[];
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: String(d._id),
    // Nullable by design: null IS the system-package marker, not something to
    // normalise away.
    ownerId: d.ownerId == null ? null : String(d.ownerId),
    name: d.name ?? '',
    description: d.description ?? null,
    items: (d.items ?? []).map(serializePackageItem),
    moods: (d.moods ?? []).map(serializeMood),
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
  };
}

/**
 * The projection `listPackages` reads through, and the reason it exists.
 *
 * `items`/`moods` are ~99% of a package document — a maxed one (64 items with
 * 200-char labels, 32 moods of 64 states, a 2000-char description) is about
 * 410 KiB serialized, of which the scalar fields below are a few hundred
 * bytes. `listPackages` is unpaginated and fires on every `/audio/packages`
 * visit and every soundboard mount, so returning whole documents made one
 * user's package count the memory cost of their own page load on a
 * `replicaCount: 1` pod capped at 512Mi (`deploy/charts/cartyx/values.yaml`) —
 * an OOMKill that takes the site down for every other user and recurs on
 * restart, because the victim's own next page load fires the same read.
 *
 * `$size` (a Mongo aggregation expression, supported in `find` projections
 * since 4.4) gives the list exactly what it renders — the counts — without
 * either array crossing the wire or the process boundary. `$ifNull` guards a
 * document written before the field existed; `$size` throws on a missing
 * field rather than returning 0.
 *
 * NOT applied to `getPackage`/`listPackageAssets`/`clonePackage`: each of
 * those reads ONE document and genuinely needs its items (to edit it, to
 * resolve its assets, to copy it). The hazard here is the unbounded row
 * count, not the document.
 */
const PACKAGE_SUMMARY_PROJECTION = {
  ownerId: 1,
  name: 1,
  description: 1,
  createdAt: 1,
  updatedAt: 1,
  itemCount: { $size: { $ifNull: ['$items', []] } },
  moodCount: { $size: { $ifNull: ['$moods', []] } },
} as const;

/** Same `null` handling as `serializePackage`, minus the arrays it never sees. */
export function serializePackageSummary(p: PackageDoc): AudioPackageSummaryData {
  const d = p as {
    _id: unknown;
    ownerId: unknown;
    name?: string;
    description?: string | null;
    itemCount?: number;
    moodCount?: number;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: String(d._id),
    // Nullable by design: null IS the system-package marker.
    ownerId: d.ownerId == null ? null : String(d.ownerId),
    name: d.name ?? '',
    description: d.description ?? null,
    itemCount: d.itemCount ?? 0,
    moodCount: d.moodCount ?? 0,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
  };
}

export async function listPackages({
  userId,
  sessionUserId,
}: Actor): Promise<{ items: AudioPackageSummaryData[] }> {
  try {
    await ensureDb();
    const rows = (await AudioPackage.find(
      packageVisibilityFilter(userId),
      PACKAGE_SUMMARY_PROJECTION
    )
      .sort({ name: 1 })
      .lean()) as PackageDoc[];
    return { items: rows.map(serializePackageSummary) };
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'listPackages' });
    throw e;
  }
}

/**
 * The per-user package cap, checked before every insert in this file.
 *
 * `ownerId: userId` and nothing else — never `packageVisibilityFilter`, whose
 * `$or` also matches `ownerId: null`. Counting system packages against a
 * user's own cap would mean phase 3 publishing a catalogue silently consumed
 * every user's allowance, and (once the catalogue grew past the cap) locked
 * every user out of creating any package at all.
 *
 * `>=`, not `>`: the count is taken BEFORE the insert, so a user already at
 * the cap must be refused rather than allowed to reach cap+1. Two concurrent
 * creates can both read `cap - 1` and both insert — the same benign
 * off-by-one every `countDocuments`-then-insert cap in this codebase has
 * (`mapAoE.ts`, `gmscreens.ts`). This is a resource bound, not an invariant;
 * a transaction to make it exact would cost more than the one extra document
 * it prevents.
 */
async function assertPackageBudget(userId: string): Promise<void> {
  const count = await AudioPackage.countDocuments({ ownerId: userId });
  if (count >= MAX_PACKAGES_PER_USER) {
    // A `PackageClientError`: the caller asked for one package too many. It is
    // their own doing, it is entirely expected, and it must not file a
    // GlitchTip event — a client retrying a create at the cap would otherwise
    // author one error report per click.
    throw new PackageClientError(
      `You already have the maximum of ${MAX_PACKAGES_PER_USER} sound packages. Delete one to make room.`
    );
  }
}

export async function getPackage({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof getPackageSchema>;
} & Actor): Promise<AudioPackageData> {
  try {
    await ensureDb();
    // `_id` narrows to the one requested document; the visibility `$or` is
    // ANDed alongside it, not replaced by it — a system package must still
    // be readable here, and another user's private package must still not be.
    const doc = await AudioPackage.findOne({
      _id: data.id,
      ...packageVisibilityFilter(userId),
    }).lean();
    if (!doc) throw new PackageClientError('Package not found');
    return serializePackage(doc as unknown as PackageDoc);
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'getPackage' });
    throw e;
  }
}

/**
 * The design's Authorization section states two rules; `packageVisibilityFilter`
 * above is rule one. This is rule two: "An asset is readable if it is owned
 * by the caller, or is system-owned and referenced by a package the caller
 * can see." Nothing in the plan implemented this until now — `listAudioAssets`
 * queries `{ ownerId: userId }` only, so a system package's pads were
 * structurally unplayable (and a cloned system package, which copies asset
 * REFERENCES rather than bytes, inherited the same dead end).
 *
 * Two gates, strictly in order:
 *
 * 1. Resolve the package through `packageVisibilityFilter(userId)`, exactly
 *    like `getPackage`. If the caller cannot see it, they get nothing — and
 *    no asset query runs at all. Without this, a caller could enumerate any
 *    package's referenced asset ids just by supplying them, whether or not
 *    they can see the package that groups them.
 * 2. Read exactly the assets that package's items reference:
 *    `{ _id: { $in: referencedIds }, $or: [{ ownerId: userId }, { ownerId: null }] }`.
 *    The `$in` is what bounds this query — this is "the assets this one
 *    package needs", not a library listing, so there is deliberately no
 *    pagination and no cap beyond the package's own `MAX_PACKAGE_ITEMS` (64).
 *    The ownership `$or` still applies within that bound: an id in the
 *    package is only returned if the caller owns it or it is system-owned:
 *    a package can reference another user's private asset (nothing prevents
 *    that today) and this must not leak it.
 *
 * Deliberately NOT a `listAudioAssets` widening — that function is the
 * library browser's, it is owner-scoped, and phase 1's review already caught
 * a campaign-authorized function enumerating per-user data. This is a
 * second, narrower, package-gated entry point instead.
 */
export async function listPackageAssets({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof listPackageAssetsSchema>;
} & Actor): Promise<{ items: AudioAssetData[] }> {
  try {
    await ensureDb();
    const pkg = (await AudioPackage.findOne({
      _id: data.packageId,
      ...packageVisibilityFilter(userId),
    }).lean()) as unknown as { items?: { assetId: unknown }[] } | null;
    if (!pkg) throw new PackageClientError('Package not found');

    const referencedIds = [...new Set((pkg.items ?? []).map((i) => String(i.assetId)))];
    const rows = (await AudioAsset.find({
      _id: { $in: referencedIds },
      $or: [{ ownerId: userId }, { ownerId: null }],
    }).lean()) as unknown[];
    return { items: rows.map((r) => serializeAudioAsset(r as Record<string, unknown>)) };
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'listPackageAssets' });
    throw e;
  }
}

export async function createPackage({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof createPackageSchema>;
} & Actor): Promise<AudioPackageData> {
  try {
    await ensureDb();
    // Before the insert, same order as `createMapAoE` — a refused create must
    // not have written a document first.
    await assertPackageBudget(userId);
    const doc = await AudioPackage.create({
      ownerId: userId,
      name: data.name,
      description: data.description ?? null,
      items: data.items ?? [],
      moods: data.moods ?? [],
    });
    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'package_created', {
      packageId: String((doc as { _id: unknown })._id),
    });
    // `.toObject()`, not the Document itself: `doc.items`/`doc.moods` are
    // Mongoose DocumentArrays here, and `serializePackage` expects plain
    // arrays/objects the way every other read in this file (which uses
    // `.lean()`) already provides them — see `updateAudioAsset`'s comment in
    // audio.ts for the TanStack Start serialization failure this avoids.
    return serializePackage(
      (doc as { toObject: () => PackageDoc }).toObject() as unknown as PackageDoc
    );
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'createPackage' });
    throw e;
  }
}

/**
 * Server-only, NOT exported — same discipline as `assertPackageBudget` above.
 * Decides WHICH refusal a failed `updatePackage` filter earned, and it is the
 * only thing that can: `findOneAndUpdate` returning `null` is a single answer
 * to three different questions ANDed together (does the id exist, does the
 * caller own it, is it still at the revision they read), so on its own it
 * cannot tell "gone or not yours" from "changed underneath you".
 *
 * One extra read, on the failure path only, with the precondition dropped and
 * everything else — `_id` AND `ownerId` — held identical. Holding `ownerId`
 * is load-bearing: re-reading by `_id` alone would answer "does this document
 * exist" rather than "does it exist FOR YOU", which would turn a probe against
 * another user's package id into a stale-write refusal and leak the existence
 * of documents the caller cannot see. Another owner's package must stay
 * indistinguishable from an absent one, exactly as it is for every other read
 * in this file.
 */
async function staleWriteOrNotFound(id: string, userId: string): Promise<PackageClientError> {
  const current = (await AudioPackage.findOne(
    { _id: id, ownerId: userId },
    { updatedAt: 1 }
  ).lean()) as unknown as { updatedAt?: Date } | null;
  if (!current) return new PackageClientError('Package not found');
  // Same `instanceof Date` normalisation `serializePackage` applies to the
  // same field, for the same reason — this value is going to a client that
  // will hand it straight back as the next `expectedUpdatedAt`.
  return new PackageStaleWriteError(
    current.updatedAt instanceof Date ? current.updatedAt.toISOString() : ''
  );
}

/**
 * Drops items whose `assetId` no longer resolves to an asset this caller can
 * see, and prunes the mood states that referenced them.
 *
 * WHY THIS EXISTS, and it is the other half of the optimistic-concurrency
 * fence below rather than a separate idea. That fence's whole justification
 * is that an unfenced whole-array replace "RESURRECTS whatever the newer
 * write removed, including the items `deleteAudioAsset`'s prune took out
 * because their asset no longer exists." The fence REFUSES such a write —
 * but the editor's conflict notice then offers "Keep my edits and overwrite",
 * which replays the same draft against the newer revision. That is the right
 * affordance (the user's edits are real and they get to keep them), and
 * without this it was also a supported, two-click path back into precisely
 * the state the fence was built to prevent: the deleted asset's pad returns,
 * permanently dangling, and the GM has no way to know it happened, because
 * "my edits" is not a phrase that tells anyone a pad's audio was deleted
 * underneath them.
 *
 * FILTERING, NOT REJECTING. Refusing the save outright would strand the user:
 * the editor gives them no way to find or remove the offending pads, so their
 * only exit would be discarding every edit they made. Dropping the dead items
 * converges on what `deleteAudioAsset`'s prune already did unilaterally to
 * this same document, which makes the two paths agree instead of fighting.
 * The saved document comes back in the response and re-seeds the editor, so
 * the pad visibly disappears rather than silently persisting as a tombstone.
 * (Telling the user how many went, and why, needs a response field and a
 * surface for it — worth doing, deliberately not smuggled into this fix.)
 *
 * EXISTENCE, NOT VISIBILITY, and the distinction is the whole correctness of
 * this function. "The asset row is gone" and "you cannot read that asset" are
 * different facts with opposite right answers, and an ownership-scoped query
 * here answers the second while claiming to answer the first.
 *
 * A package may legitimately reference an asset its owner cannot see —
 * `listPackageAssets` says so explicitly ("a package can reference another
 * user's private asset (nothing prevents that today) and this must not leak
 * it") and handles it by refusing to RETURN the asset, so the board renders
 * the pad in its own unresolved group with an honest reason. That reference
 * is intact and the asset is alive. Scoping this query by ownership deletes
 * it on the owner's next save — silent data loss, of exactly the kind this
 * function exists to prevent, inflicted on a case that was working. (Caught
 * by the E2E that seeds a foreign-owned item precisely to pin that
 * behaviour; the unit suite's mongoose mocks cannot see the difference,
 * which is the failure mode CLAUDE.md warns about.)
 *
 * So: `{_id: {$in: ids}}` and nothing else. That is not a leak. It reads no
 * field of any document — the projection is `_id` — and every id in the
 * answer is an id the CALLER supplied. The only thing derivable is whether a
 * 24-hex id the caller already possesses exists, which is not information
 * any 96-bit identifier is protecting.
 *
 * One `$in` over at most `MAX_PACKAGE_ITEMS` (64) ids, projected to `_id`.
 */
async function dropUnresolvableItems(
  items: PackageItemData[],
  moods: MoodData[] | undefined
): Promise<{ items: PackageItemData[]; moods: MoodData[] | undefined; dropped: boolean }> {
  // No ids to resolve — but the moods still have to be reconciled against the
  // (empty) item list, because a payload of `items: []` with mood states in it
  // is every state orphaned. An early return that skipped that would make this
  // function's guarantee true for 1..64 items and false for 0, which is the
  // shape of edge case that survives review by looking like an optimisation.
  const survivingItems = items.length === 0 ? items : await resolveExistingItems(items);
  const dropped = survivingItems.length !== items.length;

  // Moods reference `item.id`, never `assetId` (see `~/lib/soundboard/prune`),
  // so removing items without this leaves mood states pointing at ids that no
  // longer exist — the same orphan `deleteAudioAsset`'s prune handles with the
  // same helper. `moods` may be absent: this is a partial update, and an
  // omitted field must stay omitted rather than being materialised here — see
  // `updatePackage`, which reconciles the STORED moods in that case.
  return {
    items: survivingItems,
    moods: moods === undefined ? undefined : pruneOrphanedMoodStates(moods, survivingItems),
    dropped,
  };
}

/** The existence query itself — see `dropUnresolvableItems` for why it is unscoped. */
async function resolveExistingItems(items: PackageItemData[]): Promise<PackageItemData[]> {
  const referencedIds = [...new Set(items.map((item) => item.assetId))];
  const rows = (await AudioAsset.find(
    { _id: { $in: referencedIds } },
    { _id: 1 }
  ).lean()) as unknown as { _id: unknown }[];

  const live = new Set(rows.map((row) => String(row._id).toLowerCase()));
  return items.filter((item) => live.has(item.assetId.toLowerCase()));
}

/**
 * OPTIMISTIC CONCURRENCY. Every field this function writes is a whole-value
 * replace — `items` and `moods` most of all — so without a precondition the
 * write is last-write-wins over entire arrays. That is data loss, not
 * staleness: an editor tab left open for ten minutes and then saved does not
 * merely lose the newer edit, it RESURRECTS whatever the newer write removed,
 * including the items `deleteAudioAsset`'s prune took out because their asset
 * no longer exists (`app/server/functions/audio.ts`) — putting the document
 * back into a state the rest of the system has already moved past.
 *
 * The fence is `updatedAt`, ANDed into the update filter, and the choice
 * between it and a dedicated version counter came down to two properties of
 * THIS collection:
 *
 * 1. Every writer of an `AudioPackage` already advances it, and the one that
 *    matters most already does. `deleteAudioAsset`'s prune (audio.ts) `$set`s
 *    `updatedAt` on every package it rewrites; `createPackage`/`clonePackage`
 *    insert with the schema's own default. So the fence closes the
 *    resurrection case above against the writer that exists today, with no
 *    change to another module. A `version` counter would have to be threaded
 *    into that writer by hand, and into every future one.
 * 2. Every stored document already HAS it. `version: { type: Number, default:
 *    0 }` does not retro-apply to documents already in Mongo, and `{ version:
 *    0 }` does not match a document where the field is absent — so a counter
 *    would have made every package created before this change permanently
 *    unsaveable, unless paired with a `$exists` special case that then lives
 *    forever or a backfill this phase has no migration mechanism for.
 *
 * The cost is stated honestly: `updatedAt` has millisecond resolution, so two
 * writes to the same package inside the same clock tick can both satisfy the
 * precondition and the later one still clobbers. Both writers are behind a
 * human click, both are scoped to the same single owner, and the outcome in
 * that window is merely today's behaviour — a bounded, non-escalating
 * residual, and one a counter would not have paid for at the price above.
 *
 * NOT the same mistake as Task 10's. That defect is `updateAudioAsset`
 * bumping `updatedAt` and thereby resetting a clock the once-upload reaper
 * reads as "how long since this JOB progressed" — a second, different
 * question inferred from the field. This asks `updatedAt` exactly the
 * question it answers: has this document been modified since I read it. A
 * writer that modifies the document and stamps `updatedAt` is CORRECTLY
 * invalidating the caller's read, not accidentally defeating a mechanism.
 * The invariant this does rely on, and which nothing mechanically enforces:
 * any future writer of an `AudioPackage` must stamp `updatedAt`, or it will
 * be invisible to this fence.
 */
export async function updatePackage({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof updatePackageSchema>;
} & Actor): Promise<AudioPackageData> {
  try {
    await ensureDb();
    // Only include fields the caller actually provided, same reasoning as
    // `updateAudioAsset` in audio.ts: an omitted field must not be clobbered.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) set.name = data.name;
    if (data.description !== undefined) set.description = data.description;
    if (data.items !== undefined) {
      // Before the write, not after: see `dropUnresolvableItems`. A draft
      // built before `deleteAudioAsset` pruned this package would otherwise
      // put the dead pads back — which the fence below refuses on the first
      // attempt, and the editor's "keep my edits" retry then carries through
      // on the second.
      const pruned = await dropUnresolvableItems(data.items, data.moods);
      set.items = pruned.items;
      if (pruned.moods !== undefined) {
        set.moods = pruned.moods;
      } else if (pruned.dropped) {
        // ITEMS WERE DROPPED AND THE CALLER SENT NO MOODS. The editor always
        // sends both, but `updatePackageSchema` allows `items` alone, and in
        // that case the moods this write leaves standing are the STORED ones —
        // which may now reference item ids that no longer exist. Pruning only
        // what we were handed would make this check's own invariant ("the
        // items and moods written are mutually consistent") hold for the
        // caller who needs it least.
        //
        // Reading here is safe against the very race this function sits
        // inside: the write below is fenced on the caller's
        // `expectedUpdatedAt`, so if anything lands between this read and that
        // write, the write is refused rather than shipping moods built on a
        // stale read.
        const stored = (await AudioPackage.findOne(
          { _id: data.id, ownerId: userId },
          { moods: 1 }
        ).lean()) as unknown as { moods?: MoodData[] } | null;
        const storedMoods = stored?.moods;
        if (storedMoods?.length) {
          set.moods = pruneOrphanedMoodStates(storedMoods, pruned.items);
        }
      }
    } else if (data.moods !== undefined) {
      set.moods = data.moods;
    }

    // Owner-scoped, NEVER the visibility filter — see `packageVisibilityFilter`'s
    // doc comment. This is the query that keeps a system package immutable.
    // `updatedAt` is the precondition; it must be a `Date`, because Mongo
    // compares a BSON date against a string as a type mismatch that never
    // matches — which would refuse every save rather than only the stale ones.
    const doc = await AudioPackage.findOneAndUpdate(
      { _id: data.id, ownerId: userId, updatedAt: new Date(data.expectedUpdatedAt) },
      { $set: set },
      { new: true }
    ).lean();
    if (!doc) throw await staleWriteOrNotFound(data.id, userId);
    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'package_updated', {
      packageId: data.id,
    });
    return serializePackage(doc as unknown as PackageDoc);
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'updatePackage' });
    throw e;
  }
}

export async function clonePackage({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof clonePackageSchema>;
} & Actor): Promise<AudioPackageData> {
  try {
    await ensureDb();
    // Read through the visibility filter, exactly like `getPackage` — this is
    // the one legitimate read-side use of `$or` beyond `listPackages`/
    // `getPackage`, and it is precisely why cloning works at all: a system
    // package (`ownerId: null`) is otherwise immutable, so cloning is how a
    // user gets an editable copy of it.
    const source = await AudioPackage.findOne({
      _id: data.id,
      ...packageVisibilityFilter(userId),
    }).lean();
    if (!source) throw new PackageClientError('Package not found');
    const src = source as unknown as {
      name?: string;
      description?: string | null;
      items?: unknown[];
      moods?: unknown[];
    };
    // Deliberate, field-by-field decision about what a clone copies:
    // - `ownerId`: REPLACED with the caller — this is the whole point of a
    //   clone. Never the source's (`null` for a system package, or another
    //   user's private id).
    // - `_id`, `createdAt`, `updatedAt`, any Mongoose `__v`: DROPPED. This is
    //   a new document with its own identity; carrying the source `_id`
    //   through would collide with (or, worse, silently overwrite) the
    //   original. `create()` assigns a fresh `_id`, and the schema's own
    //   `createdAt`/`updatedAt` defaults + `pre('save')` hook stamp fresh
    //   timestamps — never taken from `src`.
    // - `name`: the caller's `data.name` if given, else the source's — a
    //   rename-on-clone convenience `clonePackageSchema` already supports.
    // - `description`: copied as-is.
    // - `items`/`moods`: copied byte-for-byte, NOT regenerated. Every
    //   `item.id` and `mood.states[].itemId` must survive verbatim — moods
    //   reference `item.id`, never `assetId`, so renumbering items here would
    //   silently break every mood in the clone. The model's own `_id: false`
    //   on both subdocument schemas exists for exactly this: the
    //   client-supplied `id` is the only identity these subdocuments need,
    //   so there is no Mongo-generated `_id` to strip either.
    //
    // Capped exactly like `createPackage` — a clone is an insert, and it is
    // the CHEAPER of the two to drive in a loop: one request per new document,
    // no body to build, and cloning a maxed system package mints a maxed
    // ~410 KiB document every time. Capping only `createPackage` would leave
    // the whole hazard reachable through the button next to it.
    await assertPackageBudget(userId);
    const doc = await AudioPackage.create({
      ownerId: userId,
      name: data.name ?? src.name ?? '',
      description: src.description ?? null,
      items: src.items ?? [],
      moods: src.moods ?? [],
    });
    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'package_cloned', {
      packageId: String((doc as { _id: unknown })._id),
      sourceId: data.id,
    });
    // `.toObject()`, not the Document itself — same reasoning as `createPackage`.
    return serializePackage(
      (doc as { toObject: () => PackageDoc }).toObject() as unknown as PackageDoc
    );
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'clonePackage' });
    throw e;
  }
}

export async function deletePackage({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof deletePackageSchema>;
} & Actor): Promise<{ deleted: boolean }> {
  try {
    await ensureDb();
    // Owner-scoped, NEVER the visibility filter — same reasoning as
    // `updatePackage`. A system package must not be deletable by anyone.
    const res = await AudioPackage.deleteOne({ _id: data.id, ownerId: userId });
    if (!res.deletedCount) throw new PackageClientError('Package not found');
    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'package_deleted', {
      packageId: data.id,
    });
    return { deleted: true };
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'deletePackage' });
    throw e;
  }
}
