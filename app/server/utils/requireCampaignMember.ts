import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';

/**
 * Verify the authenticated user is a member of the given campaign.
 * Returns the DB user ID string, session user ID, and whether the user is the GM.
 *
 * Throws on any failure: not authenticated, DB unavailable, user not found,
 * campaign not found, or the user not being a member of the campaign.
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
  if (!campaign) throw new Error('Campaign not found');

  const userId = String(dbUser._id);
  const members = campaign.members ?? [];
  const member = members.find((m) => String(m.userId) === userId);
  const isGM = String(campaign.gameMasterId) === userId || member?.role === 'gm';
  const isMember = !!member || isGM;
  if (!isMember) throw new Error('Forbidden');

  return { userId, sessionUserId: user.id, isGM };
}
