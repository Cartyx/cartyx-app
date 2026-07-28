import { z } from 'zod';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Tag } from '../db/models/Tag';
import { serverCaptureException } from '../utils/telemetry';
import { normalizeTags } from '../utils/helpers';
import type { TagListItem } from '~/types/tag';
import { listTagsSchema, ensureTagsSchema } from '~/types/tag';

async function requireCampaignMember(
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
  const isMember =
    members.some((m) => String(m.userId) === userId) || String(campaign.gameMasterId) === userId;
  if (!isMember) throw new Error('Forbidden');

  return { userId, sessionUserId: user.id };
}

// ---------------------------------------------------------------------------
// listTags
// ---------------------------------------------------------------------------

export { listTagsSchema };

export const listTags = async ({
  data,
}: {
  data: z.infer<typeof listTagsSchema>;
}): Promise<TagListItem[]> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const docs = await Tag.find({ campaignId: data.campaignId })
      .select('name')
      .sort({ name: 1 })
      .lean();

    return docs.map((d: { _id: unknown; name?: string }) => ({
      id: String(d._id),
      name: d.name ?? '',
    }));
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listTags', campaignId: data.campaignId });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// ensureTags
// ---------------------------------------------------------------------------

export { ensureTagsSchema };

export const ensureTags = async ({ data }: { data: z.infer<typeof ensureTagsSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    const userId = member.userId;

    const normalized = normalizeTags(data.tags);
    if (normalized.length === 0) return { success: true };

    const ops = normalized.map((name) => ({
      updateOne: {
        filter: { campaignId: data.campaignId, name },
        update: {
          $setOnInsert: {
            name,
            campaignId: data.campaignId,
            createdBy: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    // campaignId/createdBy are strings here (validated input / session user id);
    // mongoose casts them to ObjectId at the driver level same as any other
    // write. Narrow cast to the real bulkWrite operation type.
    await Tag.bulkWrite(ops as Parameters<typeof Tag.bulkWrite>[0], { ordered: false });
    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'ensureTags',
      campaignId: data.campaignId,
    });
    throw e;
  }
};
