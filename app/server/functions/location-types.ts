import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
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
// listLocationTypes
// ---------------------------------------------------------------------------

export { listLocationTypesSchema };

export const listLocationTypes = async ({
  data,
}: {
  data: z.infer<typeof listLocationTypesSchema>;
}) => {
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
};

// ---------------------------------------------------------------------------
// createLocationType
// ---------------------------------------------------------------------------

export { createLocationTypeSchema };

export const createLocationType = async ({
  data,
}: {
  data: z.infer<typeof createLocationTypeSchema>;
}) => {
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
};

// ---------------------------------------------------------------------------
// deleteLocationType
// ---------------------------------------------------------------------------

export { deleteLocationTypeSchema };

export const deleteLocationType = async ({
  data,
}: {
  data: z.infer<typeof deleteLocationTypeSchema>;
}) => {
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
};
