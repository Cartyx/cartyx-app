import { z } from 'zod';
import mongoose from 'mongoose';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Player } from '../db/models/Player';
import { Session } from '../db/models/Session';
import { GMScreen } from '../db/models/GMScreen';
import {
  generateInviteCode,
  parseMaxPlayers,
  saveUploadedFile,
  MAX_IMAGE_BASE64_LENGTH,
} from '../utils/helpers';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { formatSchedule } from '~/utils/date';
import type { CampaignData } from '~/types/campaign';
import {
  campaignInputSchema,
  updateCampaignInputSchema,
  getCampaignSchema,
  joinCampaignSchema,
  activateSessionSchema,
} from '~/types/schemas/campaigns';

export function buildScheduleText(
  schedule: {
    frequency?: string | null;
    dayOfWeek?: string | null;
    time?: string | null;
    timezone?: string | null;
  } | null
): string {
  return formatSchedule(schedule);
}

function serializeCampaign(
  c: {
    _id: unknown;
    name?: string;
    description?: string;
    status?: string;
    inviteCode?: string;
    imagePath?: string | null;
    links?: Array<{ name?: string; url?: string }> | null;
    maxPlayers?: number;
    schedule?: {
      frequency?: string | null;
      dayOfWeek?: string | null;
      time?: string | null;
      timezone?: string | null;
    } | null;
    gameMasterId?: unknown;
    members?: Array<{ userId: unknown; role?: string }>;
  },
  gmId?: string,
  userId?: string,
  partyMembers: Array<{
    id: string;
    characterName: string;
    characterClass: string;
    avatar: string | null;
    userId: string;
  }> = [],
  sessions: CampaignData['sessions'] = [],
  gmScreens?: CampaignData['gmScreens']
): CampaignData {
  const schedule = c.schedule ?? null;
  const members = c.members ?? [];
  const playerCount = members.filter((m) => m.role === 'player').length;
  // Treat GM as implicit member for legacy campaigns (no members array)
  const isMember = userId
    ? members.some((m) => String(m.userId) === userId) || String(c.gameMasterId) === userId
    : false;
  return {
    id: String(c._id),
    name: c.name ?? 'Untitled Campaign',
    description: c.description ?? '',
    status: c.status ?? 'active',
    inviteCode: c.inviteCode ?? '',
    imagePath: c.imagePath ?? null,
    links: (c.links ?? []).map((l) => ({ name: l.name ?? '', url: l.url ?? '' })),
    maxPlayers: c.maxPlayers ?? 4,
    schedule: {
      frequency: schedule?.frequency ?? null,
      dayOfWeek: schedule?.dayOfWeek ?? null,
      time: schedule?.time ?? null,
      timezone: schedule?.timezone ?? null,
    },
    players: { current: playerCount, max: c.maxPlayers ?? 4 },
    partyMembers,
    nextSession: schedule?.dayOfWeek
      ? { day: schedule.dayOfWeek, time: schedule.time ?? 'TBD' }
      : null,
    sessions,
    ...(gmScreens ? { gmScreens } : {}),
    isOwner: !!gmId && String(c.gameMasterId) === gmId,
    isGM:
      !!gmId &&
      (String(c.gameMasterId) === gmId ||
        (c.members ?? []).some(
          (m: { userId: unknown; role?: string }) => String(m.userId) === gmId && m.role === 'gm'
        )),
    isMember,
    // Contract: the viewer's User._id when they are a member, else null.
    currentUserId: isMember ? (gmId ?? null) : null,
    scheduleText: buildScheduleText(schedule),
  };
}

export const listCampaigns = async () => {
  try {
    const user = await getSession();
    if (!user) return [];

    await connectDB();
    if (!isDBConnected()) return [];

    const dbUser = await User.findOne({ providerId: user.id });
    if (!dbUser) return [];

    // Include legacy campaigns (pre-members migration) where user is the GM
    const raw = await Campaign.find({
      $or: [
        { 'members.userId': dbUser._id },
        { gameMasterId: dbUser._id, members: { $in: [null, []] } },
        // Ensure the GM always sees their campaigns, even if members is non-empty and missing the GM
        { gameMasterId: dbUser._id },
      ],
    }).sort({ createdAt: -1 });

    const campaignIds = raw.map((c) => c._id);
    let playersByCampaignId: Record<
      string,
      Array<{
        id: string;
        characterName: string;
        characterClass: string;
        avatar: string | null;
        userId: string;
      }>
    > = {};

    if (campaignIds.length > 0) {
      const allPlayers = await Player.find(
        { campaignId: { $in: campaignIds } },
        '_id campaignId userId characterName characterClass avatar'
      ).lean();
      playersByCampaignId = allPlayers.reduce(
        (acc, p) => {
          const key = String(p.campaignId);
          if (!acc[key]) acc[key] = [];
          acc[key].push({
            id: String(p._id),
            characterName: p.characterName as string,
            characterClass: p.characterClass as string,
            avatar: (p.avatar as string | undefined) ?? null,
            userId: String(p.userId),
          });
          return acc;
        },
        {} as Record<
          string,
          Array<{
            id: string;
            characterName: string;
            characterClass: string;
            avatar: string | null;
            userId: string;
          }>
        >
      );
    }

    const userId = String(dbUser._id);
    return raw.map((c) => {
      const partyMembers = playersByCampaignId[String(c._id)] ?? [];
      const serialized = serializeCampaign(
        c as Parameters<typeof serializeCampaign>[0],
        userId,
        userId,
        partyMembers
      );
      // Redact invite code for non-owners
      if (!serialized.isOwner) {
        return { ...serialized, inviteCode: '' };
      }
      return serialized;
    });
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'listCampaigns' });
    throw e;
  }
};

export const getCampaign = async ({ data }: { data: z.infer<typeof getCampaignSchema> }) => {
  try {
    const user = await getSession();
    if (!user) throw new Error('Not authenticated');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');

    const dbUser = await User.findOne({ providerId: user.id });
    const c = await Campaign.findById(data.id);
    if (!c) return null;

    const userId = dbUser ? String(dbUser._id) : undefined;

    // Only members can see campaigns; treat gameMasterId as implicit member for legacy campaigns
    const members = c.members ?? [];
    const isMember = userId
      ? members.some((m: { userId: unknown }) => String(m.userId) === userId) ||
        (members.length === 0 && c.gameMasterId != null && String(c.gameMasterId) === userId)
      : false;
    if (!isMember) return null;

    const isOwner = !!userId && c.gameMasterId != null && String(c.gameMasterId) === userId;

    // Load players and sessions in parallel; GM also gets gmscreen docs.
    // The active session's summary is fetched separately to avoid including
    // potentially large catch-up markdown in every session row.
    const queries: [
      ReturnType<typeof Player.find>,
      ReturnType<typeof Session.find>,
      ReturnType<typeof GMScreen.find> | null,
      ReturnType<typeof Session.findOne>,
    ] = [
      Player.find(
        { campaignId: c._id },
        '_id campaignId userId characterName characterClass avatar'
      ).lean(),
      Session.find({ campaignId: c._id }, '_id name number startDate endDate status')
        .sort({ number: 1 })
        .lean(),
      isOwner ? GMScreen.find({ campaignId: c._id }, '_id name').lean() : null,
      Session.findOne({ campaignId: c._id, status: 'active' }, '_id summary').lean(),
    ];

    const [playerDocs, sessionDocs, gmScreenDocs, activeSessionDoc] = await Promise.all(queries);

    const partyMembers = (
      playerDocs as Array<{
        _id: unknown;
        characterName: unknown;
        characterClass: unknown;
        avatar: unknown;
        userId: unknown;
      }>
    ).map((p) => ({
      id: String(p._id),
      characterName: p.characterName as string,
      characterClass: p.characterClass as string,
      avatar: (p.avatar as string | undefined) ?? null,
      userId: String(p.userId),
    }));

    const activeDoc = activeSessionDoc as { _id: unknown; summary?: string } | null;
    const activeId = activeDoc ? String(activeDoc._id) : null;
    const activeCatchUp = activeDoc?.summary ?? null;

    const sessions = (
      sessionDocs as Array<{
        _id: unknown;
        name: unknown;
        number: unknown;
        startDate: unknown;
        endDate: unknown;
        status: unknown;
      }>
    ).map((s) => ({
      id: String(s._id),
      name: s.name as string,
      number: s.number as number,
      startDate: (s.startDate as Date).toISOString(),
      endDate: s.endDate ? (s.endDate as Date).toISOString() : null,
      status: ((s.status as string) ?? 'not_started') as 'not_started' | 'active' | 'completed',
      catchUp: String(s._id) === activeId ? activeCatchUp : null,
    }));

    const gmScreens = gmScreenDocs
      ? (gmScreenDocs as Array<{ _id: unknown; name: unknown }>).map((g) => ({
          id: String(g._id),
          name: g.name as string,
        }))
      : undefined;

    const serialized = serializeCampaign(
      c as Parameters<typeof serializeCampaign>[0],
      userId,
      userId,
      partyMembers,
      sessions,
      gmScreens
    );

    // Redact invite code for non-owners
    if (!isOwner) {
      return { ...serialized, inviteCode: '' };
    }

    return serialized;
  } catch (e) {
    serverCaptureException(e, undefined, { action: 'getCampaign', campaignId: data.id });
    throw e;
  }
};

export { campaignInputSchema };

export const createCampaign = async ({ data }: { data: z.infer<typeof campaignInputSchema> }) => {
  const user = await getSession();
  try {
    if (!user) throw new Error('Not authenticated');
    if (user.role !== 'gm') throw new Error('Only GMs can create campaigns');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');

    const {
      name,
      description,
      schedFreq,
      schedDay,
      schedTime,
      schedTz,
      links,
      maxPlayers,
      imageData,
      imageMime,
      imageName,
      imagePath: imagePathInput,
    } = data;

    if (!name.trim()) throw new Error('Campaign name is required');

    const dbUser = await User.findOne({ providerId: user.id });
    if (!dbUser) throw new Error('User not found');

    let imagePath: string | null = null;
    if (imagePathInput) {
      // Direct upload path: validate the URL origin matches our CDN
      const cdnUrl = process.env.CDN_URL;
      if (!cdnUrl) throw new Error('Invalid image path');
      try {
        const cdnOrigin = new URL(cdnUrl);
        const imageUrl = new URL(imagePathInput);
        if (imageUrl.origin !== cdnOrigin.origin) throw new Error('Invalid image path');
        if (!imageUrl.pathname.startsWith('/uploads/')) throw new Error('Invalid image path');
      } catch {
        throw new Error('Invalid image path');
      }
      imagePath = imagePathInput;
    } else if (imageData && imageMime && imageName) {
      // Local dev fallback: base64 → save via server
      if (imageData.length > MAX_IMAGE_BASE64_LENGTH) {
        throw new Error('Image must be under 3MB after compression');
      }
      const buffer = Buffer.from(imageData, 'base64');
      const file = new File([buffer], imageName, { type: imageMime });
      imagePath = await saveUploadedFile(file, 'uploads/campaigns');
    }

    interface CampaignResult {
      _id: mongoose.Types.ObjectId;
      name: string;
      inviteCode: string;
    }
    const mongoSession = await mongoose.startSession();
    let result: CampaignResult;
    try {
      result = (await mongoSession.withTransaction(async () => {
        let campaign: CampaignResult | null = null;
        let attempts = 0;
        while (attempts < 10 && !campaign) {
          const inviteCode = generateInviteCode();
          const inUse = await Campaign.exists({ inviteCode }).session(mongoSession);
          attempts++;
          if (inUse) continue;
          try {
            const created = (await Campaign.create(
              [
                {
                  gameMasterId: dbUser._id,
                  name: name.trim(),
                  description: description.trim(),
                  imagePath,
                  schedule: {
                    frequency: schedFreq ?? null,
                    dayOfWeek: schedDay ?? null,
                    time: schedTime ?? null,
                    timezone: schedTz ?? null,
                  },
                  links: links ?? [],
                  maxPlayers: parseMaxPlayers(maxPlayers),
                  inviteCode,
                  members: [{ userId: dbUser._id, role: 'gm', joinedAt: new Date() }],
                },
              ],
              { session: mongoSession }
            )) as unknown as CampaignResult[];
            campaign = created[0] as CampaignResult;
          } catch (e: unknown) {
            if ((e as { code?: number })?.code === 11000) {
              campaign = null;
              continue;
            }
            throw e;
          }
        }

        if (!campaign) throw new Error('Could not generate unique invite code');

        // Create default Session 0 and GM Screen for new campaign
        const now = new Date();
        await Promise.all([
          Session.create(
            [
              {
                campaignId: campaign._id,
                name: 'Session 0',
                gm: dbUser._id,
                number: 0,
                startDate: now,
                endDate: null,
                status: 'active',
                summary: `## Welcome to Your Campaign!

This is the **Catch Up** section. Your players will see this on their Dashboard to stay up to date on the story.

**Update this after each session** with a summary of what happened so everyone is caught up before the next game.

---

### Getting started

- **Create a new session:** Go to the Sessions page and click "New Session"
- **Update catch-up info:** Click on any session to edit it and fill in the Catch Up field
- **Session notes:** Use the session editor to keep notes during and after each session

*Replace this text with your Session 0 recap once you're ready!*`,
              },
            ],
            { session: mongoSession }
          ),
          GMScreen.create(
            [
              {
                campaignId: campaign._id,
                name: 'General',
                tabOrder: 0,
                createdBy: dbUser._id,
              },
            ],
            { session: mongoSession }
          ),
        ]);

        // Sync User.campaigns array
        await User.updateOne(
          { _id: dbUser._id },
          {
            $push: {
              campaigns: { campaignId: campaign._id, joinedAt: new Date(), status: 'active' },
            },
          },
          { session: mongoSession }
        );

        return campaign;
      })) as CampaignResult;
    } finally {
      await mongoSession.endSession();
    }

    serverCaptureEvent(user.id, 'campaign_created', {
      campaign_id: String(result._id),
      campaign_name: result.name,
      has_image: imagePath !== null,
      has_schedule: !!(schedFreq || schedDay || schedTime || schedTz),
    });

    return {
      success: true,
      campaignId: String(result._id),
      inviteCode: result.inviteCode,
    };
  } catch (e) {
    serverCaptureException(e, user?.id, { action: 'createCampaign' });
    throw e;
  }
};

export const updateCampaign = async ({
  data,
}: {
  data: z.infer<typeof updateCampaignInputSchema>;
}) => {
  const user = await getSession();
  try {
    if (!user) throw new Error('Not authenticated');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');

    const dbUser = await User.findOne({ providerId: user.id });
    if (!dbUser) throw new Error('User not found');

    const campaign = await Campaign.findById(data.id);
    if (!campaign) throw new Error('Campaign not found');
    if (String(campaign.gameMasterId) !== String(dbUser._id)) throw new Error('Forbidden');

    const {
      name,
      description,
      schedFreq,
      schedDay,
      schedTime,
      schedTz,
      links,
      maxPlayers,
      imageData,
      imageMime,
      imageName,
      imagePath: imagePathInput,
    } = data;

    if (!name.trim()) throw new Error('Campaign name is required');

    campaign.name = name.trim();
    campaign.description = description.trim();
    campaign.schedule = {
      frequency: schedFreq ?? null,
      dayOfWeek: schedDay ?? null,
      time: schedTime ?? null,
      timezone: schedTz ?? null,
    };
    campaign.links = links ?? [];
    campaign.maxPlayers = parseMaxPlayers(maxPlayers);
    campaign.updatedAt = new Date();

    if (imagePathInput) {
      // Direct upload path: validate the URL origin matches our CDN
      const cdnUrl = process.env.CDN_URL;
      if (!cdnUrl) throw new Error('Invalid image path');
      try {
        const cdnOrigin = new URL(cdnUrl);
        const imageUrl = new URL(imagePathInput);
        if (imageUrl.origin !== cdnOrigin.origin) throw new Error('Invalid image path');
        if (!imageUrl.pathname.startsWith('/uploads/')) throw new Error('Invalid image path');
      } catch {
        throw new Error('Invalid image path');
      }
      campaign.imagePath = imagePathInput;
    } else if (imageData && imageMime && imageName) {
      // Local dev fallback: base64 → save via server
      if (imageData.length > MAX_IMAGE_BASE64_LENGTH) {
        throw new Error('Image must be under 3MB after compression');
      }
      const buffer = Buffer.from(imageData, 'base64');
      const file = new File([buffer], imageName, { type: imageMime });
      campaign.imagePath = await saveUploadedFile(file, 'uploads/campaigns');
    }

    await campaign.save();
    serverCaptureEvent(user.id, 'campaign_updated', { campaign_id: data.id });
    return { success: true, campaignId: String(campaign._id) };
  } catch (e) {
    serverCaptureException(e, user?.id, { action: 'updateCampaign', campaignId: data.id });
    throw e;
  }
};

/** @deprecated Use completeJoinWizard in players.ts instead. Kept for backwards compatibility. */
export const joinCampaign = async ({ data }: { data: z.infer<typeof joinCampaignSchema> }) => {
  const user = await getSession();
  try {
    if (!user) throw new Error('Not authenticated');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');

    const dbUser = await User.findOne({ providerId: user.id });
    if (!dbUser) throw new Error('User not found');

    const normalizedInviteCode = data.inviteCode.trim().toUpperCase();
    const campaign = await Campaign.findOne({ inviteCode: normalizedInviteCode });
    if (!campaign) throw new Error('Invalid invite code');
    if (campaign.status !== 'active') throw new Error('Campaign is not active');

    // Treat GM as implicit member (consistent with getCampaign)
    const alreadyMember =
      (campaign.members ?? []).some(
        (m: { userId: unknown }) => String(m.userId) === String(dbUser._id)
      ) || String(campaign.gameMasterId) === String(dbUser._id);
    if (alreadyMember) throw new Error('Already a member of this campaign');

    const now = new Date();

    const updatedCampaign = await Campaign.findOneAndUpdate(
      {
        _id: campaign._id,
        status: 'active',
        'members.userId': { $ne: dbUser._id },
        $expr: {
          $lt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ['$members', []] },
                  as: 'm',
                  cond: { $eq: ['$$m.role', 'player'] },
                },
              },
            },
            { $ifNull: ['$maxPlayers', 4] },
          ],
        },
      },
      {
        $addToSet: { members: { userId: dbUser._id, role: 'player', joinedAt: now } },
      },
      {
        new: true,
      }
    );

    if (!updatedCampaign) {
      throw new Error('Campaign is full');
    }

    await User.updateOne(
      { _id: dbUser._id },
      {
        $addToSet: {
          campaigns: { campaignId: updatedCampaign._id, status: 'active', joinedAt: now },
        },
      }
    );

    // Create placeholder Player document (can be edited later)
    const displayName = [
      dbUser.firstName as string | undefined,
      dbUser.lastName as string | undefined,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    await Player.updateOne(
      {
        campaignId: updatedCampaign._id,
        userId: dbUser._id,
      },
      {
        $setOnInsert: {
          campaignId: updatedCampaign._id,
          userId: dbUser._id,
          characterName: displayName || 'Adventurer',
          characterClass: 'Adventurer',
          joinedAt: now,
        },
      },
      { upsert: true }
    );

    serverCaptureEvent(user.id, 'campaign_joined', { campaign_id: String(updatedCampaign._id) });

    return { success: true, campaignId: String(updatedCampaign._id) };
  } catch (e) {
    serverCaptureException(e, user?.id, { action: 'joinCampaign' });
    throw e;
  }
};

export const activateSession = async ({
  data,
}: {
  data: z.infer<typeof activateSessionSchema>;
}) => {
  const user = await getSession();
  try {
    if (!user) throw new Error('Not authenticated');

    await connectDB();
    if (!isDBConnected()) throw new Error('Database not available');

    const dbUser = await User.findOne({ providerId: user.id });
    if (!dbUser) throw new Error('User not found');

    const campaign = await Campaign.findById(data.campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (String(campaign.gameMasterId) !== String(dbUser._id)) throw new Error('Forbidden');

    const mongoSession = await mongoose.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        const currentActive = await Session.findOne({
          campaignId: data.campaignId,
          status: 'active',
        }).session(mongoSession);

        // If the target is already the active session, no-op
        if (currentActive && String(currentActive._id) === data.sessionId) {
          return;
        }

        // Verify target session exists and belongs to this campaign
        const targetSession = await Session.findOne({
          _id: data.sessionId,
          campaignId: data.campaignId,
        }).session(mongoSession);
        if (!targetSession) throw new Error('Session not found');

        const now = new Date();

        // Deactivate the currently active session
        if (currentActive) {
          const endDate = data.endDate ? new Date(data.endDate) : now;
          await Session.updateOne(
            { _id: currentActive._id },
            { $set: { status: 'completed', endDate, updatedAt: now } },
            { session: mongoSession }
          );
        }

        // Activate the target session
        await Session.updateOne(
          { _id: data.sessionId, campaignId: data.campaignId },
          { $set: { status: 'active', updatedAt: now } },
          { session: mongoSession }
        );
      });
    } finally {
      await mongoSession.endSession();
    }

    return { success: true };
  } catch (e) {
    serverCaptureException(e, user?.id, {
      action: 'activateSession',
      campaignId: data.campaignId,
      sessionId: data.sessionId,
    });
    throw e;
  }
};
