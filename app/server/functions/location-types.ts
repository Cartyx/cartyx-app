import { createServerFn } from '@tanstack/react-start';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Location } from '../db/models/Location';
import { LocationType, seedDefaultLocationTypes } from '../db/models/LocationType';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import type { LocationTypeData } from '~/types/location';
import {
  listLocationTypesSchema,
  createLocationTypeSchema,
  deleteLocationTypeSchema,
} from '~/types/schemas/locations';

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeLocationType(d: {
  _id: unknown;
  campaignId: unknown;
  name?: string;
  isDefault?: boolean;
  sortOrder?: number;
}): LocationTypeData {
  return {
    id: String(d._id),
    campaignId: String(d.campaignId),
    name: d.name ?? '',
    isDefault: d.isDefault ?? false,
    sortOrder: d.sortOrder ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function requireCampaignMember(
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
  const member = members.find(
    (m: { userId: unknown; role?: string }) => String(m.userId) === userId
  );
  const isGM = String(campaign.gameMasterId) === userId || member?.role === 'gm';
  const isMember = !!member || isGM;
  if (!isMember) throw new Error('Forbidden');

  return { userId, sessionUserId: user.id, isGM };
}

// ---------------------------------------------------------------------------
// listLocationTypes
// ---------------------------------------------------------------------------

export { listLocationTypesSchema };

export const listLocationTypes = createServerFn({ method: 'GET' })
  .inputValidator(listLocationTypesSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      // Seed defaults on first request for this campaign
      await seedDefaultLocationTypes(data.campaignId);

      const docs = await LocationType.find({ campaignId: data.campaignId })
        .sort({ sortOrder: 1 })
        .lean();

      return (
        docs as Array<{
          _id: unknown;
          campaignId: unknown;
          name?: string;
          isDefault?: boolean;
          sortOrder?: number;
        }>
      ).map(serializeLocationType);
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listLocationTypes',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// createLocationType
// ---------------------------------------------------------------------------

export { createLocationTypeSchema };

export const createLocationType = createServerFn({ method: 'POST' })
  .inputValidator(createLocationTypeSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      // Determine next sortOrder
      const maxDoc = await LocationType.findOne({ campaignId: data.campaignId })
        .sort({ sortOrder: -1 })
        .lean();
      const nextOrder = ((maxDoc as { sortOrder?: number } | null)?.sortOrder ?? -1) + 1;

      const doc = await LocationType.create({
        campaignId: data.campaignId,
        name: data.name.trim(),
        isDefault: false,
        sortOrder: nextOrder,
      });

      serverCaptureEvent(sessionUserId, 'location_type_created', {
        campaign_id: data.campaignId,
        location_type_id: String(doc._id),
      });

      return { success: true, locationType: serializeLocationType(doc) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'createLocationType',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteLocationType
// ---------------------------------------------------------------------------

export { deleteLocationTypeSchema };

export const deleteLocationType = createServerFn({ method: 'POST' })
  .inputValidator(deleteLocationTypeSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      const existing = await LocationType.findById(data.id);
      if (!existing) throw new Error('Location type not found');
      if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');
      if (existing.isDefault) throw new Error('Cannot delete default location types');

      // Check no locations use this type
      const usageCount = await Location.countDocuments({
        campaignId: data.campaignId,
        locationType: existing.name,
      });
      if (usageCount > 0) {
        throw new Error(`Cannot delete: ${usageCount} location(s) use this type`);
      }

      await existing.deleteOne();

      serverCaptureEvent(sessionUserId, 'location_type_deleted', {
        campaign_id: data.campaignId,
        location_type_id: data.id,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'deleteLocationType',
        locationTypeId: data.id,
      });
      throw e;
    }
  });
