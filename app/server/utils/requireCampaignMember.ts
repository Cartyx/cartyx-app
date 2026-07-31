import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';

/**
 * "You cannot reach this campaign" — either it does not exist, or the caller
 * is not at that table. A `subclass of Error`, so every existing caller (this
 * helper is shared by `calendars.ts`, `notes.ts`, `lore.ts`, `soundboard.ts`
 * and ~30 more, all of which `catch (e)` generically, report, and rethrow) is
 * completely unaffected: `instanceof Error` still holds, `.message` still
 * reads the same way, and the value still propagates identically. This is
 * additive information for the handlers that want it, not a behaviour change
 * for the ones that don't.
 *
 * The one handler that wants it today is `reportSoundboardError`
 * (`~/server/functions/soundboard.ts`). `loadBoardState`/`saveBoardState` take
 * a campaign id straight from the request, so ANY authenticated user can call
 * `loadBoardStateFn` in a loop with random 24-hex ids; every one of those
 * rejections used to file a GlitchTip exception, which makes error-report
 * volume against a shared single-node service an attacker-chosen number.
 * `packages.ts`'s `PackageClientError` defends the identical hazard on the
 * package side, and `soundboard.ts` already classified its own non-GM save
 * correctly — the "not a member at all" path, the only one reachable by
 * someone with no relationship to the campaign whatsoever, was the loud one.
 *
 * ONE MESSAGE for both the missing-campaign and the not-a-member case, on
 * purpose. Distinct messages ("Campaign not found" vs "Forbidden") are a
 * campaign-existence oracle: an outsider learns which of their guessed ids
 * name real campaigns purely from which error comes back. Collapsing them
 * costs a legitimate caller nothing — a member never sees either — and is the
 * same reason `getPackage` answers "not found" for a package that exists but
 * belongs to someone else.
 */
export class CampaignAccessError extends Error {
  constructor(message = 'Campaign not found') {
    super(message);
    this.name = 'CampaignAccessError';
  }
}

/**
 * Verify the authenticated user is a member of the given campaign.
 * Returns the DB user ID string, session user ID, and whether the user is the GM.
 *
 * Throws on any failure: not authenticated, DB unavailable, user not found,
 * campaign not found, or the user not being a member of the campaign. The last
 * two throw `CampaignAccessError` (see above) — the two the caller controls,
 * and the two that must not be distinguishable from each other.
 */
export async function requireCampaignMember(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string; isGM: boolean }> {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');

  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new CampaignAccessError();

  const userId = String(dbUser._id);
  const members = campaign.members ?? [];
  const member = members.find((m) => String(m.userId) === userId);
  const isGM = String(campaign.gameMasterId) === userId || member?.role === 'gm';
  const isMember = !!member || isGM;
  // Deliberately the SAME error and the SAME message as the missing-campaign
  // case above — see `CampaignAccessError`. A caller who is not at this table
  // must not be able to tell "no such campaign" from "not yours".
  if (!isMember) throw new CampaignAccessError();

  return { userId, sessionUserId: user.id, isGM };
}
