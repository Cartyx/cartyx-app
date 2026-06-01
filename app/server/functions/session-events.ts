import { createServerFn } from '@tanstack/react-start';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { SessionEvent } from '../db/models/SessionEvent';
import { serverCaptureException } from '../utils/posthog';
import type { SessionEventData } from '~/types/tabletop';
import { createSessionEventSchema, listSessionEventsSchema } from '~/types/schemas/tabletop';

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeEvent(doc: {
  _id: unknown;
  campaignId: unknown;
  sessionId: unknown;
  timestamp?: Date;
  eventType?: string;
  documentId: unknown;
  collection?: string;
  tabletopScreenId: unknown;
  triggeredBy: unknown;
  displayName?: string;
}): SessionEventData {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    sessionId: String(doc.sessionId),
    timestamp: doc.timestamp instanceof Date ? doc.timestamp.toISOString() : '',
    eventType: (doc.eventType as SessionEventData['eventType']) ?? 'reveal_document',
    documentId: String(doc.documentId),
    collection: doc.collection ?? '',
    tabletopScreenId: String(doc.tabletopScreenId),
    triggeredBy: String(doc.triggeredBy),
    displayName: doc.displayName ?? '',
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function requireCampaignGM(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string }> {
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

  const isGM =
    String(campaign.gameMasterId) === userId ||
    members.some(
      (m: { userId: unknown; role?: string }) => String(m.userId) === userId && m.role === 'gm'
    );

  if (!isGM) throw new Error('Forbidden');
  return { userId, sessionUserId: user.id };
}

async function requireAuthenticated(): Promise<{ userId: string; sessionUserId: string }> {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');

  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  return { userId: String(dbUser._id), sessionUserId: user.id };
}

// ---------------------------------------------------------------------------
// createSessionEvent — POST, GM only
// ---------------------------------------------------------------------------

export { createSessionEventSchema };

export const createSessionEvent = createServerFn({ method: 'POST' })
  .inputValidator(createSessionEventSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;

      const doc = await SessionEvent.create({
        campaignId: data.campaignId,
        sessionId: data.sessionId,
        timestamp: new Date(),
        eventType: data.eventType,
        documentId: data.documentId,
        collection: data.collection,
        tabletopScreenId: data.tabletopScreenId,
        triggeredBy: gm.userId,
        displayName: data.displayName,
      });

      return { success: true, event: serializeEvent(doc) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'createSessionEvent',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// listSessionEvents — GET, any authenticated user
// ---------------------------------------------------------------------------

export { listSessionEventsSchema };

export const listSessionEvents = createServerFn({ method: 'GET' })
  .inputValidator(listSessionEventsSchema)
  .handler(async ({ data }): Promise<SessionEventData[]> => {
    let sessionUserId: string | undefined;
    try {
      const authed = await requireAuthenticated();
      sessionUserId = authed.sessionUserId;

      const docs = await SessionEvent.find({
        campaignId: data.campaignId,
        sessionId: data.sessionId,
      })
        .sort({ timestamp: 1 })
        .lean();

      return (
        docs as Array<{
          _id: unknown;
          campaignId: unknown;
          sessionId: unknown;
          timestamp?: Date;
          eventType?: string;
          documentId: unknown;
          collection?: string;
          tabletopScreenId: unknown;
          triggeredBy: unknown;
          displayName?: string;
        }>
      ).map(serializeEvent);
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listSessionEvents',
        campaignId: data.campaignId,
        sessionId: data.sessionId,
      });
      throw e;
    }
  });
