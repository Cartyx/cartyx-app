import { z } from 'zod';
import mongoose from 'mongoose';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Session } from '../db/models/Session';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import {
  listSessionsSchema,
  getSessionCatchUpSchema,
  createSessionSchema,
  updateSessionSchema,
} from '~/types/schemas/sessions';

/**
 * Validates auth, connects to DB, and verifies the current user is the GM of the given campaign.
 * Returns { user, dbUser, campaign } on success; throws on failure.
 */
async function requireGM(campaignId: string) {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');

  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (String(campaign.gameMasterId) !== String(dbUser._id)) throw new Error('Forbidden');

  return { user, dbUser, campaign };
}

export const listSessions = async ({ data }: { data: z.infer<typeof listSessionsSchema> }) => {
  try {
    await requireGM(data.campaignId);

    const filter: Record<string, unknown> = { campaignId: data.campaignId };
    if (!data.includeCompleted) {
      filter.status = { $ne: 'completed' };
    }

    const sessions = await Session.find(
      filter,
      '_id name number startDate endDate status summary createdAt updatedAt'
    )
      .sort({ startDate: -1 })
      .lean();

    return (
      sessions as Array<{
        _id: unknown;
        name: string;
        number: number;
        startDate: Date;
        endDate: Date | null;
        status: string;
        summary?: string | null;
      }>
    ).map((s) => ({
      id: String(s._id),
      name: s.name,
      number: s.number,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate ? s.endDate.toISOString() : null,
      status: (s.status ?? 'not_started') as 'not_started' | 'active' | 'completed',
      catchUp: s.summary ?? null,
    }));
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'listSessions',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

/**
 * Fetch a single session's catch-up (summary) markdown. Readable by any
 * campaign member — players need this to catch up on sessions they missed.
 * The campaign payload only ships the active session's catch-up, so the
 * dashboard fetches other sessions' catch-ups on demand via this function.
 */
export const getSessionCatchUp = async ({
  data,
}: {
  data: z.infer<typeof getSessionCatchUpSchema>;
}) => {
  try {
    await requireCampaignMember(data.campaignId);

    const session = (await Session.findOne(
      { _id: data.sessionId, campaignId: data.campaignId },
      '_id summary'
    ).lean()) as { _id: unknown; summary?: string | null } | null;

    if (!session) return { catchUp: null };

    return { catchUp: session.summary ?? null };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'getSessionCatchUp',
      campaignId: data.campaignId,
      sessionId: data.sessionId,
    });
    throw e;
  }
};

export const createSession = async ({ data }: { data: z.infer<typeof createSessionSchema> }) => {
  try {
    const { user, dbUser } = await requireGM(data.campaignId);

    const mongoSession = await mongoose.startSession();
    let sessionId: string;
    try {
      sessionId = (await mongoSession.withTransaction(async () => {
        const lastSession = (await Session.findOne({ campaignId: data.campaignId })
          .sort({ number: -1 })
          .select('number')
          .session(mongoSession)
          .lean()) as { number: number } | null;
        const number = lastSession ? lastSession.number + 1 : 0;

        const [doc] = (await Session.create(
          [
            {
              campaignId: data.campaignId,
              name: data.name,
              gm: dbUser._id,
              number,
              startDate: new Date(data.startDate),
              status: 'not_started',
            },
          ],
          { session: mongoSession }
        )) as unknown as Array<{ _id: unknown }>;

        return String(doc._id);
      })) as string;
    } finally {
      await mongoSession.endSession();
    }

    serverCaptureEvent(user.id, 'session_created', {
      campaign_id: data.campaignId,
      session_id: sessionId,
      session_name: data.name,
    });

    return { success: true, sessionId };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'createSession',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

export const updateSession = async ({ data }: { data: z.infer<typeof updateSessionSchema> }) => {
  try {
    const { user } = await requireGM(data.campaignId);

    const session = await Session.findOne({
      _id: data.sessionId,
      campaignId: data.campaignId,
    });
    if (!session) throw new Error('Session not found');

    const setFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) setFields.name = data.name;
    if (data.startDate !== undefined) setFields.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) setFields.endDate = new Date(data.endDate);
    if (data.summary !== undefined) setFields.summary = data.summary;

    await Session.updateOne(
      { _id: data.sessionId, campaignId: data.campaignId },
      {
        $set: setFields,
      }
    );

    serverCaptureEvent(user.id, 'session_updated', {
      campaign_id: data.campaignId,
      session_id: data.sessionId,
    });

    return { success: true };
  } catch (e) {
    serverCaptureException(e, undefined, {
      action: 'updateSession',
      campaignId: data.campaignId,
      sessionId: data.sessionId,
    });
    throw e;
  }
};
