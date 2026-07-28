import { Session } from '../db/models/Session';
import { Campaign } from '../db/models/Campaign';
import { User } from '../db/models/User';
import { withLogging } from '../utils/logger';

export const requireSessionAccess = withLogging(
  'sessionAccess.requireSessionAccess',
  async (sessionId: string, userId: string) => {
    const dbUser = await User.findOne({ providerId: userId });
    if (!dbUser) throw new Error('User not found');

    const session = await Session.findById(sessionId).select('campaignId').lean();
    if (!session) throw new Error('Session not found');

    const campaign = await Campaign.findById(session.campaignId).lean();
    if (!campaign) throw new Error('Campaign not found');

    const member = campaign.members?.find((m) => String(m.userId) === String(dbUser._id));
    if (!member) throw new Error('Forbidden');

    return { dbUser, campaignId: String(session.campaignId), isGM: member.role === 'gm' };
  }
);
