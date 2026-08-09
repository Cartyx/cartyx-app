import type { z } from 'zod';
import { SoundboardState } from '../db/models/SoundboardState';
import { requireCampaignMember, CampaignAccessError } from '../utils/requireCampaignMember';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { DEFAULT_VOLUME, type BoardStateData, type BoardItemStateData } from '~/types/soundboard';
import type { saveBoardStateSchema, loadBoardStateSchema } from '~/types/schemas/soundboard';
import { SOUNDBOARD_CLIENT_ERROR_NAME } from '~/lib/client-refusal';

/**
 * Same reasoning as `PackageClientError` in `app/server/functions/packages.ts`:
 * marks a failure as "the caller's own doing" so `reportSoundboardError` below
 * does not file a GlitchTip event for it. The one thrown here — a non-GM
 * attempting `saveBoardState` — is exactly this kind of caller-triggerable,
 * non-server-fault shape: any campaign member can hit it just by calling the
 * save function the client-side GM gating exists to prevent them from calling.
 */
export class SoundboardClientError extends Error {
  /**
   * Set only when the refusal is a rate-limit rejection thrown by
   * `~/utils/soundboard-server-fns.ts`'s wrapper gate — same field, same
   * meaning, as `AudioClientError.retryAfterMs`.
   */
  readonly retryAfterMs?: number;

  constructor(message: string, options?: { retryAfterMs?: number }) {
    super(message);
    // From the shared constant, for the same reason `AudioClientError` and
    // `PackageClientError` take theirs from one: the browser suppresses its
    // own telemetry for these by `.name`. See `~/lib/client-refusal.ts`.
    this.name = SOUNDBOARD_CLIENT_ERROR_NAME;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/**
 * Same split as `packages.ts`'s `Actor`, and for the same reason: `userId`
 * and `sessionUserId` are genuinely different values, and only one of them
 * may ever be used to scope or stamp a write.
 *
 * Unlike `packages.ts`, authorization here does NOT come from this type —
 * `requireCampaignMember(data.campaignId)` re-derives the caller's identity
 * from the session independently (see that function), and ITS returned
 * `userId` is the only one ever used to scope a query or stamp `updatedBy`.
 * This `Actor` is used exclusively for telemetry: the un-awaited
 * `serverCaptureException`/`serverCaptureEvent` calls need *some* identity to
 * tag events with, including in the "not even a campaign member" failure
 * path, where `requireCampaignMember` has thrown before handing back
 * anything to tag with instead.
 */
type Actor = { userId: string; sessionUserId?: string };

function telemetryId(actor: Actor): string {
  return actor.sessionUserId ?? actor.userId;
}

/**
 * Report to GlitchTip unless the failure was the caller's own doing.
 *
 * `CampaignAccessError` counts, and it is the one that mattered: both
 * functions below take `data.campaignId` straight from the request and hand it
 * to `requireCampaignMember` before anything else, so any authenticated user
 * can call `loadBoardStateFn` in a loop with random 24-hex ids and mint one
 * GlitchTip exception per call against a shared single-node service — the
 * volume becomes an attacker's parameter. A campaign the caller is not a
 * member of is not a server fault; it is the same class as
 * `SoundboardClientError` and the same class `packages.ts` already excludes
 * for exactly this reason.
 *
 * Everything else still reports, including `requireCampaignMember`'s
 * `Not authenticated`/`User not found`/`Database not available` — a session
 * that resolves to no user, or an unreachable Atlas, is a genuine fault and
 * neither is reachable by guessing ids.
 */
function reportSoundboardError(e: unknown, actor: Actor, context: Record<string, unknown>) {
  if (e instanceof SoundboardClientError || e instanceof CampaignAccessError) return;
  serverCaptureException(e, telemetryId(actor), context);
}

type BoardStateDoc = Record<string, unknown>;

function serializeBoardItemState(item: unknown): BoardItemStateData {
  const i = item as { itemId: string; playing?: boolean; volume?: number };
  return {
    itemId: i.itemId,
    playing: i.playing ?? false,
    volume: i.volume ?? DEFAULT_VOLUME,
  };
}

export function serializeBoardState(doc: BoardStateDoc): BoardStateData {
  const d = doc as {
    campaignId: unknown;
    packageId?: unknown;
    moodId?: string | null;
    items?: unknown[];
    masterVolume?: number;
  };
  return {
    campaignId: String(d.campaignId),
    // Nullable by design, matching Task 3's model: null IS "nothing loaded",
    // not something to normalise away.
    packageId: d.packageId == null ? null : String(d.packageId),
    moodId: d.moodId ?? null,
    items: (d.items ?? []).map(serializeBoardItemState),
    masterVolume: d.masterVolume ?? DEFAULT_VOLUME,
  };
}

/**
 * Player-readable: a member reading the live board is 2b's resync path
 * (rejoin mid-session without losing what's playing) and costs nothing to
 * allow now, so this checks membership only, not `isGM`.
 *
 * Returns `null`, not an error, when no document exists yet — a campaign
 * whose GM has never opened the board is a valid "nothing loaded" state, not
 * a fault.
 */
export async function loadBoardState({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof loadBoardStateSchema>;
} & Actor): Promise<BoardStateData | null> {
  try {
    // Membership check FIRST, before any model call — a player who is not
    // at this table must never learn whether a board even exists for it.
    await requireCampaignMember(data.campaignId);
    const doc = await SoundboardState.findOne({ campaignId: data.campaignId }).lean();
    if (!doc) return null;
    return serializeBoardState(doc as unknown as BoardStateDoc);
  } catch (e) {
    reportSoundboardError(
      e,
      { userId, sessionUserId },
      {
        action: 'loadBoardState',
        campaignId: data.campaignId,
      }
    );
    throw e;
  }
}

/**
 * GM-only: throws `SoundboardClientError` for anyone else. In 2a the GM's own
 * browser is the sole authority over the live board by construction — the
 * design's two-GMs case is last-write-wins BETWEEN GMs, not a reason to open
 * this to every player at the table. (The plan's original text said
 * membership was enough for both `loadBoardState` and `saveBoardState`; that
 * would have left the live board writable by any player. Decided 2026-07-29,
 * carried forward from Task 6's brief.)
 *
 * Upserts on `campaignId` alone — the unique index Task 3's model puts on
 * that field is what guarantees a campaign never accumulates two documents,
 * so the filter here must never grow a second clause that could let a second
 * document slip past it. Last-write-wins: whichever save lands last simply
 * overwrites the row.
 */
export async function saveBoardState({
  data,
  userId,
  sessionUserId,
}: {
  data: z.infer<typeof saveBoardStateSchema>;
} & Actor): Promise<BoardStateData> {
  try {
    // Membership+GM check FIRST, before any model call.
    const member = await requireCampaignMember(data.campaignId);
    if (!member.isGM)
      throw new SoundboardClientError('Forbidden: only the GM can save board state');

    // Task 3's `pre('save')` hook (which stamps `updatedAt`) does NOT fire on
    // `findOneAndUpdate` — it only fires on `.save()`. `updatedAt` must be set
    // explicitly here, matching every `findOneAndUpdate` call site in
    // `audio.ts`.
    const doc = await SoundboardState.findOneAndUpdate(
      { campaignId: data.campaignId },
      {
        $set: {
          packageId: data.packageId ?? null,
          moodId: data.moodId ?? null,
          items: data.items,
          masterVolume: data.masterVolume,
          // The Mongo `_id` `requireCampaignMember` itself verified — NEVER
          // the caller-supplied `userId` argument. Phase 1 shipped the OAuth
          // provider id into a query this way and every call CastError'd;
          // the fix there (and here) is to only ever trust the identity the
          // auth check itself resolved.
          updatedBy: member.userId,
          updatedAt: new Date(),
        },
      },
      { new: true, upsert: true, lean: true }
    );
    serverCaptureEvent(telemetryId({ userId, sessionUserId }), 'board_state_saved', {
      campaignId: data.campaignId,
    });
    return serializeBoardState(doc as unknown as BoardStateDoc);
  } catch (e) {
    reportSoundboardError(
      e,
      { userId, sessionUserId },
      {
        action: 'saveBoardState',
        campaignId: data.campaignId,
      }
    );
    throw e;
  }
}
