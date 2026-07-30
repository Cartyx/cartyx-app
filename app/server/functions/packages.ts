import type { z } from 'zod';
import { connectDB, isDBConnected } from '../db/connection';
import { AudioPackage } from '../db/models/AudioPackage';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import {
  DEFAULT_VOLUME,
  DEFAULT_FADE_SECONDS,
  type AudioPackageData,
  type PackageItemData,
  type MoodData,
  type MoodStateData,
} from '~/types/soundboard';
import type {
  createPackageSchema,
  updatePackageSchema,
  deletePackageSchema,
  getPackageSchema,
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
  constructor(message: string) {
    super(message);
    this.name = 'PackageClientError';
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

export async function listPackages({
  userId,
  sessionUserId,
}: Actor): Promise<{ items: AudioPackageData[] }> {
  try {
    await ensureDb();
    const rows = (await AudioPackage.find(packageVisibilityFilter(userId))
      .sort({ name: 1 })
      .lean()) as PackageDoc[];
    return { items: rows.map(serializePackage) };
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'listPackages' });
    throw e;
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

export async function createPackage({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof createPackageSchema>;
} & Actor): Promise<AudioPackageData> {
  try {
    await ensureDb();
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
    if (data.items !== undefined) set.items = data.items;
    if (data.moods !== undefined) set.moods = data.moods;

    // Owner-scoped, NEVER the visibility filter — see `packageVisibilityFilter`'s
    // doc comment. This is the query that keeps a system package immutable.
    const doc = await AudioPackage.findOneAndUpdate(
      { _id: data.id, ownerId: userId },
      { $set: set },
      { new: true }
    ).lean();
    if (!doc) throw new PackageClientError('Package not found');
    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'package_updated', {
      packageId: data.id,
    });
    return serializePackage(doc as unknown as PackageDoc);
  } catch (e) {
    reportPackageError(e, { userId, sessionUserId }, { action: 'updatePackage' });
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
