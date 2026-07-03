import { createServerFn } from '@tanstack/react-start';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Location } from '../db/models/Location';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import { normalizeTags } from '../utils/helpers';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { pruneLoreLinks } from '../utils/pruneLoreLinks';
import { pruneEventLinks } from '../utils/pruneEventLinks';
import { ensureTags as ensureTagsFn } from './tags';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { LocationData, LocationListItem, LocationRef } from '~/types/location';
import {
  createLocationSchema,
  updateLocationSchema,
  deleteLocationSchema,
  listLocationsSchema,
  getLocationSchema,
  addLocationImageSchema,
  deleteLocationImageSchema,
} from '~/types/schemas/locations';

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeLocation(
  r: {
    _id: unknown;
    campaignId: unknown;
    createdBy: unknown;
    name?: string;
    locationType?: string;
    description?: string;
    gmNotes?: string;
    isPublic?: boolean;
    images?: Array<{ imageKey?: string; url?: string; title?: string; uploadedAt?: Date }>;
    mapImage?: string | null;
    tags?: string[];
    createdAt?: Date;
    updatedAt?: Date;
  },
  canEdit: boolean,
  showGmNotes: boolean,
  resolvedParents: LocationRef[],
  resolvedChildren: LocationRef[]
): LocationData {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    name: r.name ?? '',
    locationType: r.locationType ?? '',
    description: r.description ?? '',
    gmNotes: showGmNotes ? (r.gmNotes ?? '') : '',
    isPublic: r.isPublic ?? true,
    parentLocations: resolvedParents,
    childLocations: resolvedChildren,
    images: (r.images ?? []).map((img) => ({
      imageKey: img.imageKey ?? '',
      url: img.url ?? '',
      title: img.title ?? '',
      uploadedAt: img.uploadedAt instanceof Date ? img.uploadedAt.toISOString() : '',
    })),
    mapImage: r.mapImage ?? null,
    tags: r.tags ?? [],
    canEdit,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

/**
 * Resolve an array of location ObjectIds to LocationRef objects.
 */
async function resolveLocationRefs(ids: unknown[], campaignId: string): Promise<LocationRef[]> {
  if (!ids || ids.length === 0) return [];
  const stringIds = ids.map(String);
  const docs = await Location.find(
    { _id: { $in: stringIds }, campaignId },
    '_id name locationType'
  ).lean();
  return docs.map((d) => ({
    id: String(d._id),
    name: (d as { name?: string }).name ?? '',
    locationType: (d as { locationType?: string }).locationType ?? '',
  }));
}

function serializeLocationListItem(
  r: {
    _id: unknown;
    campaignId: unknown;
    createdBy: unknown;
    name?: string;
    locationType?: string;
    isPublic?: boolean;
    parentLocations?: unknown[];
    tags?: string[];
    createdAt?: Date;
    updatedAt?: Date;
  },
  canEdit: boolean
): LocationListItem {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    name: r.name ?? '',
    locationType: r.locationType ?? '',
    isPublic: r.isPublic ?? true,
    parentLocations: (r.parentLocations ?? []).map(String),
    tags: r.tags ?? [],
    canEdit,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Create an R2-compatible S3 client for image deletion.
 * Returns null if R2 is not configured (dev environment).
 */
function createR2Client(): { client: S3Client; bucket: string } | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

// ---------------------------------------------------------------------------
// createLocation
// ---------------------------------------------------------------------------

export { createLocationSchema };

export const createLocation = createServerFn({ method: 'POST' })
  .inputValidator(createLocationSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');
      const userId = member.userId;

      const now = new Date();
      const finalTags = normalizeTags(data.tags ?? []);
      const locationData: Record<string, unknown> = {
        campaignId: data.campaignId,
        createdBy: userId,
        name: data.name.trim(),
        locationType: data.locationType.trim(),
        description: (data.description ?? '').trim(),
        gmNotes: (data.gmNotes ?? '').trim(),
        isPublic: data.isPublic ?? true,
        parentLocations: data.parentLocations ?? [],
        childLocations: [],
        tags: finalTags,
        createdAt: now,
        updatedAt: now,
      };
      const doc = await Location.create(locationData);
      const newId = String(doc._id);

      // Update parent locations' childLocations arrays
      const parents = data.parentLocations ?? [];
      if (parents.length > 0) {
        await Location.updateMany(
          { _id: { $in: parents }, campaignId: data.campaignId },
          { $addToSet: { childLocations: newId } }
        );
      }

      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

      serverCaptureEvent(sessionUserId, 'location_created', {
        campaign_id: data.campaignId,
        location_id: newId,
      });

      const resolvedParents = await resolveLocationRefs(doc.parentLocations ?? [], data.campaignId);
      return { success: true, location: serializeLocation(doc, true, true, resolvedParents, []) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'createLocation',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// updateLocation
// ---------------------------------------------------------------------------

export { updateLocationSchema };

export const updateLocation = createServerFn({ method: 'POST' })
  .inputValidator(updateLocationSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      const userId = member.userId;

      const existing = await Location.findById(data.id);
      if (!existing) throw new Error('Location not found');
      if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

      const isOwner = String(existing.createdBy) === userId;
      if (!isOwner && !member.isGM) throw new Error('Forbidden');

      // Sync parent/child relationships
      const oldParents = (existing.parentLocations ?? []).map(String) as string[];
      const newParents = data.parentLocations ?? [];
      const removedParents = oldParents.filter((p) => !newParents.includes(p));
      const addedParents = newParents.filter((p) => !oldParents.includes(p));

      if (removedParents.length > 0) {
        await Location.updateMany(
          { _id: { $in: removedParents }, campaignId: data.campaignId },
          { $pull: { childLocations: data.id } }
        );
      }
      if (addedParents.length > 0) {
        await Location.updateMany(
          { _id: { $in: addedParents }, campaignId: data.campaignId },
          { $addToSet: { childLocations: data.id } }
        );
      }

      const finalTags = normalizeTags(data.tags ?? []);
      existing.name = data.name.trim();
      existing.locationType = data.locationType.trim();
      existing.description = (data.description ?? '').trim();
      existing.gmNotes = (data.gmNotes ?? '').trim();
      existing.parentLocations = newParents;
      existing.tags = finalTags;
      if (data.isPublic !== undefined) {
        existing.isPublic = data.isPublic;
      }
      existing.updatedAt = new Date();
      await existing.save();

      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

      serverCaptureEvent(sessionUserId, 'location_updated', {
        campaign_id: data.campaignId,
        location_id: data.id,
        updated_by: userId,
      });

      const resolvedParents = await resolveLocationRefs(
        existing.parentLocations ?? [],
        data.campaignId
      );
      const resolvedChildren = await resolveLocationRefs(
        existing.childLocations ?? [],
        data.campaignId
      );
      return {
        success: true,
        location: serializeLocation(existing, true, true, resolvedParents, resolvedChildren),
      };
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'updateLocation', locationId: data.id });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteLocation
// ---------------------------------------------------------------------------

export { deleteLocationSchema };

export const deleteLocation = createServerFn({ method: 'POST' })
  .inputValidator(deleteLocationSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      const userId = member.userId;

      const existing = await Location.findById(data.id);
      if (!existing) throw new Error('Location not found');
      if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

      const isOwner = String(existing.createdBy) === userId;
      if (!isOwner && !member.isGM) throw new Error('Forbidden');

      // Clean up parent/child references
      const parents = (existing.parentLocations ?? []).map(String) as string[];
      const children = (existing.childLocations ?? []).map(String) as string[];

      if (parents.length > 0) {
        await Location.updateMany(
          { _id: { $in: parents }, campaignId: data.campaignId },
          { $pull: { childLocations: data.id } }
        );
      }
      if (children.length > 0) {
        await Location.updateMany(
          { _id: { $in: children }, campaignId: data.campaignId },
          { $pull: { parentLocations: data.id } }
        );
      }

      // Best-effort delete all R2 images for this location
      const images = (existing.images ?? []) as Array<{ imageKey?: string }>;
      if (images.length > 0) {
        try {
          const r2Client = createR2Client();
          if (r2Client) {
            await Promise.all(
              images
                .filter((img) => img.imageKey)
                .map((img) =>
                  r2Client.client
                    .send(new DeleteObjectCommand({ Bucket: r2Client.bucket, Key: img.imageKey! }))
                    .catch(() => {})
                )
            );
          }
        } catch (cleanupError) {
          serverCaptureException(cleanupError, sessionUserId, {
            action: 'deleteLocation.imageCleanup',
            campaignId: data.campaignId,
            locationId: data.id,
          });
        }
      }

      await existing.deleteOne();

      // Clean up GM Screen / Tabletop references
      try {
        await removeDocumentRefsFromScreens(data.campaignId, 'location', data.id);
      } catch (cleanupError) {
        serverCaptureException(cleanupError, sessionUserId, {
          action: 'deleteLocation.cleanup',
          campaignId: data.campaignId,
          locationId: data.id,
        });
      }

      await pruneLoreLinks('location', data.id, data.campaignId);
      await pruneEventLinks('location', data.id, data.campaignId);

      serverCaptureEvent(sessionUserId, 'location_deleted', {
        campaign_id: data.campaignId,
        location_id: data.id,
        deleted_by: userId,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'deleteLocation', locationId: data.id });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// listLocations
// ---------------------------------------------------------------------------

export { listLocationsSchema };

export const listLocations = createServerFn({ method: 'GET' })
  .inputValidator(listLocationsSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const filter: Record<string, unknown> = { campaignId: data.campaignId };

      if (member.isGM) {
        if (data.visibility === 'public') {
          filter.isPublic = true;
        } else if (data.visibility === 'private') {
          filter.isPublic = false;
        }
      } else {
        // Players see public locations + their own private ones
        filter.$or = [{ isPublic: true }, { createdBy: member.userId }];
      }

      if (data.locationType && data.locationType.trim()) {
        filter.locationType = data.locationType.trim();
      }

      if (data.search && data.search.trim()) {
        filter.$text = { $search: data.search.trim() };
      }

      if (data.tags && data.tags.length > 0) {
        const normalizedTags = [...new Set(normalizeTags(data.tags))];
        if (normalizedTags.length > 0) {
          filter.tags = { $all: normalizedTags };
        }
      }

      const docs = await Location.find(filter)
        .select('-description -gmNotes -childLocations -images -mapImage -mapBounds')
        .sort({ updatedAt: -1 })
        .lean();

      return (
        docs as Array<{
          _id: unknown;
          campaignId: unknown;
          createdBy: unknown;
          name?: string;
          locationType?: string;
          isPublic?: boolean;
          parentLocations?: unknown[];
          tags?: string[];
          createdAt?: Date;
          updatedAt?: Date;
        }>
      ).map((d) => {
        const isOwner = String(d.createdBy) === member.userId;
        const canEdit = isOwner || member.isGM;
        return serializeLocationListItem(d, canEdit);
      });
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listLocations',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getLocation
// ---------------------------------------------------------------------------

export { getLocationSchema };

export const getLocation = createServerFn({ method: 'GET' })
  .inputValidator(getLocationSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const doc = await Location.findById(data.id);
      if (!doc) return null;
      if (String(doc.campaignId) !== data.campaignId) return null;

      const isOwner = String(doc.createdBy) === member.userId;
      if (!doc.isPublic && !member.isGM && !isOwner) {
        return null;
      }

      const canEdit = isOwner || member.isGM;
      const showGmNotes = member.isGM || isOwner;

      const resolvedParents = await resolveLocationRefs(doc.parentLocations ?? [], data.campaignId);
      const resolvedChildren = await resolveLocationRefs(doc.childLocations ?? [], data.campaignId);

      return serializeLocation(doc, canEdit, showGmNotes, resolvedParents, resolvedChildren);
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'getLocation', locationId: data.id });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// addLocationImage
// ---------------------------------------------------------------------------

export { addLocationImageSchema };

export const addLocationImage = createServerFn({ method: 'POST' })
  .inputValidator(addLocationImageSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const existing = await Location.findById(data.id);
      if (!existing) throw new Error('Location not found');
      if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

      const isOwner = String(existing.createdBy) === member.userId;
      if (!isOwner && !member.isGM) throw new Error('Forbidden');

      await Location.updateOne(
        { _id: data.id },
        {
          $push: {
            images: {
              imageKey: data.imageKey,
              url: data.url,
              title: data.title.trim(),
              uploadedAt: new Date(),
            },
          },
          $set: { updatedAt: new Date() },
        }
      );

      serverCaptureEvent(sessionUserId, 'location_image_added', {
        campaign_id: data.campaignId,
        location_id: data.id,
        image_key: data.imageKey,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'addLocationImage',
        locationId: data.id,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteLocationImage
// ---------------------------------------------------------------------------

export { deleteLocationImageSchema };

export const deleteLocationImage = createServerFn({ method: 'POST' })
  .inputValidator(deleteLocationImageSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const existing = await Location.findById(data.id);
      if (!existing) throw new Error('Location not found');
      if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

      const isOwner = String(existing.createdBy) === member.userId;
      if (!isOwner && !member.isGM) throw new Error('Forbidden');

      const images = (existing.images ?? []) as Array<{ imageKey?: string }>;
      const imageExists = images.some((img) => img.imageKey === data.imageKey);
      if (!imageExists) throw new Error('Image not found');

      // Delete from R2
      const r2Client = createR2Client();
      if (r2Client) {
        await r2Client.client.send(
          new DeleteObjectCommand({ Bucket: r2Client.bucket, Key: data.imageKey })
        );
      }

      // Remove from MongoDB
      await Location.updateOne(
        { _id: data.id },
        {
          $pull: { images: { imageKey: data.imageKey } },
          $set: { updatedAt: new Date() },
        }
      );

      serverCaptureEvent(sessionUserId, 'location_image_deleted', {
        campaign_id: data.campaignId,
        location_id: data.id,
        image_key: data.imageKey,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'deleteLocationImage',
        locationId: data.id,
      });
      throw e;
    }
  });
