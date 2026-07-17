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

    const campaign = await Campaign.findById((session as any).campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const member = (campaign as any).members?.find(
      (m: { userId: unknown }) => String(m.userId) === String(dbUser._id)
    );
    if (!member) throw new Error('Forbidden');

    const isGM = member.role === 'gm';

    return { dbUser, campaignId: String((session as any).campaignId), isGM };
  }
);
