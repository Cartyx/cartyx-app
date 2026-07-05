import { z } from 'zod';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Map as MapModel } from '../db/models/Map';
import { TabletopScreen } from '../db/models/TabletopScreen';
import { Location } from '../db/models/Location';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import type { MapData, MapListItem, MapScale, MapGridOverlay } from '~/types/map';
import {
  listMapsSchema,
  getMapSchema,
  createMapSchema,
  updateMapScaleSchema,
  updateMapSchema,
  deleteMapSchema,
  setActiveMapSchema,
  getActiveMapSchema,
} from '~/types/schemas/maps';

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

type MapDoc = {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  name?: string;
  tags?: string[];
  imageKey?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  locationId?: unknown;
  scale?: { gridType?: string; pixelsPerSquare?: number; feetPerSquare?: number };
  gridOverlay?: { enabled?: boolean; color?: string };
  createdAt?: Date;
  updatedAt?: Date;
};

function serializeScale(s: MapDoc['scale']): MapScale {
  return {
    gridType: (s?.gridType as MapScale['gridType']) ?? 'square',
    pixelsPerSquare: s?.pixelsPerSquare ?? 50,
    feetPerSquare: s?.feetPerSquare ?? 5,
  };
}

function serializeOverlay(o: MapDoc['gridOverlay']): MapGridOverlay {
  return {
    enabled: o?.enabled ?? false,
    color: o?.color ?? '#ffffff66',
  };
}

function serializeMapListItem(r: MapDoc): MapListItem {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    name: r.name ?? '',
    tags: r.tags ?? [],
    imageUrl: r.imageUrl ?? '',
    imageWidth: r.imageWidth ?? 0,
    imageHeight: r.imageHeight ?? 0,
    locationId: r.locationId ? String(r.locationId) : null,
    scale: serializeScale(r.scale),
    gridOverlay: serializeOverlay(r.gridOverlay),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

function serializeMap(r: MapDoc): MapData {
  return { ...serializeMapListItem(r), imageKey: r.imageKey ?? '' };
}

// ---------------------------------------------------------------------------
// Auth + R2
// ---------------------------------------------------------------------------

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

/**
 * Best-effort broadcast of a `map:active-changed` event to the `tabletop-map`
 * PartyKit room so every connected client invalidates/refetches the active map
 * right away, regardless of which UI triggered the mutation. A party outage
 * must never fail the DB write, so all errors are swallowed.
 */
async function broadcastActiveMapChanged(
  campaignId: string,
  mapId: string | null,
  screenId: string | null
): Promise<void> {
  const host = process.env.VITE_PUBLIC_PARTYKIT_HOST;
  if (!host) return;
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const protocol = isLocal ? 'http' : 'https';
  // Mirrors `useTabletopMapParty`: party `tabletop_map` (underscore — the
  // partykit.json key), room `tabletop-map-<campaignId>`.
  const url = `${protocol}://${host}/parties/tabletop_map/tabletop-map-${campaignId}`;
  try {
    const { createPartyBroadcastToken } = await import('../session');
    const broadcastToken = await createPartyBroadcastToken();
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${broadcastToken}`,
      },
      body: JSON.stringify({ type: 'map:active-changed', mapId, screenId }),
    });
  } catch {
    // Best-effort only — clients still refetch on focus/refresh.
  }
}

// ---------------------------------------------------------------------------
// listMaps
// ---------------------------------------------------------------------------

export const listMaps = async ({ data }: { data: z.infer<typeof listMapsSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    // The map listing is GM-only. Players reach the active map via
    // getActiveMap, never the management list.
    if (!member.isGM) throw new Error('Forbidden');

    const docs = await MapModel.find({ campaignId: data.campaignId })
      .sort({ updatedAt: -1 })
      // Bound the result set — a campaign's map library is small in practice.
      .limit(500)
      .lean();

    return { maps: docs.map((d) => serializeMapListItem(d as MapDoc)) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listMaps',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getMap
// ---------------------------------------------------------------------------

export const getMap = async ({ data }: { data: z.infer<typeof getMapSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const doc = await MapModel.findOne({ _id: data.id, campaignId: data.campaignId }).lean();
    if (!doc) throw new Error('Map not found');

    return { map: serializeMap(doc as MapDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'getMap',
      campaignId: data.campaignId,
      mapId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// createMap (GM only) — called after presigned R2 upload completes
// ---------------------------------------------------------------------------

export const createMap = async ({ data }: { data: z.infer<typeof createMapSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    // If a locationId is supplied, verify it belongs to the campaign.
    if (data.locationId) {
      const loc = await Location.findOne(
        { _id: data.locationId, campaignId: data.campaignId },
        '_id'
      ).lean();
      if (!loc) throw new Error('Location not found in this campaign');
    }

    const now = new Date();
    const doc = await MapModel.create({
      campaignId: data.campaignId,
      createdBy: member.userId,
      name: data.name.trim(),
      tags: data.tags ?? [],
      imageKey: data.imageKey,
      imageUrl: data.imageUrl,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
      locationId: data.locationId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    serverCaptureEvent(sessionUserId, 'map_created', {
      campaign_id: data.campaignId,
      map_id: String(doc._id),
    });

    return { map: serializeMap(doc.toObject() as MapDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'createMap',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateMapScale (GM only) — step-2 of the upload modal
// ---------------------------------------------------------------------------

export const updateMapScale = async ({ data }: { data: z.infer<typeof updateMapScaleSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const doc = await MapModel.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      {
        $set: {
          'scale.gridType': data.gridType,
          'scale.pixelsPerSquare': data.pixelsPerSquare,
          'scale.feetPerSquare': data.feetPerSquare,
          updatedAt: new Date(),
        },
      },
      { new: true }
    ).lean();
    if (!doc) throw new Error('Map not found');

    return { map: serializeMap(doc as MapDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updateMapScale',
      campaignId: data.campaignId,
      mapId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// updateMap (GM only)
// ---------------------------------------------------------------------------

export const updateMap = async ({ data }: { data: z.infer<typeof updateMapSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    if (data.locationId) {
      const loc = await Location.findOne(
        { _id: data.locationId, campaignId: data.campaignId },
        '_id'
      ).lean();
      if (!loc) throw new Error('Location not found in this campaign');
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name.trim();
    if (data.locationId !== undefined) update.locationId = data.locationId;
    if (data.tags !== undefined) update.tags = data.tags;
    if (data.gridOverlay !== undefined) {
      update['gridOverlay.enabled'] = data.gridOverlay.enabled;
      if (data.gridOverlay.color !== undefined) {
        update['gridOverlay.color'] = data.gridOverlay.color;
      }
    }

    const doc = await MapModel.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      { $set: update },
      { new: true }
    ).lean();
    if (!doc) throw new Error('Map not found');

    return { map: serializeMap(doc as MapDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updateMap',
      campaignId: data.campaignId,
      mapId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// deleteMap (GM only) — clears the map from any tab (TabletopScreen) that had
// it active, best-effort R2 object delete.
// ---------------------------------------------------------------------------

export const deleteMap = async ({ data }: { data: z.infer<typeof deleteMapSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    const existing = await MapModel.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean();
    if (!existing) throw new Error('Map not found');

    await MapModel.deleteOne({ _id: data.id, campaignId: data.campaignId });

    // Clear this map from any tab that had it active.
    const cleared = await TabletopScreen.updateMany(
      { campaignId: data.campaignId, activeMapId: data.id },
      { $set: { activeMapId: null } }
    );
    const activeCleared = cleared.modifiedCount > 0;
    if (activeCleared) {
      // Notify connected clients to stop rendering the now-deleted map.
      // screenId null → clients invalidate the active-map query for any tab.
      await broadcastActiveMapChanged(data.campaignId, null, null);
    }

    // Best-effort R2 delete.
    const imageKey = (existing as { imageKey?: string }).imageKey;
    if (imageKey) {
      try {
        const r2 = createR2Client();
        if (r2) {
          await r2.client
            .send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: imageKey }))
            .catch(() => {});
        }
      } catch (cleanupError) {
        serverCaptureException(cleanupError, sessionUserId, {
          action: 'deleteMap.r2Cleanup',
          campaignId: data.campaignId,
          mapId: data.id,
        });
      }
    }

    serverCaptureEvent(sessionUserId, 'map_deleted', {
      campaign_id: data.campaignId,
      map_id: data.id,
    });

    return { success: true, activeCleared };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'deleteMap',
      campaignId: data.campaignId,
      mapId: data.id,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// setActiveMap (GM only) — sets the per-tab TabletopScreen.activeMapId. Pass null to clear.
// ---------------------------------------------------------------------------

export const setActiveMap = async ({ data }: { data: z.infer<typeof setActiveMapSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;
    if (!member.isGM) throw new Error('Forbidden');

    if (data.mapId !== null) {
      const exists = await MapModel.findOne(
        { _id: data.mapId, campaignId: data.campaignId },
        '_id'
      ).lean();
      if (!exists) throw new Error('Map not found');
    }

    // Active map is per-tab: set it on the target screen, not the campaign.
    const res = await TabletopScreen.updateOne(
      { _id: data.screenId, campaignId: data.campaignId },
      { $set: { activeMapId: data.mapId, updatedAt: new Date() } }
    );
    if (res.matchedCount === 0) throw new Error('Tab not found');

    await broadcastActiveMapChanged(data.campaignId, data.mapId, data.screenId);

    serverCaptureEvent(sessionUserId, 'map_set_active', {
      campaign_id: data.campaignId,
      screen_id: data.screenId,
      map_id: data.mapId,
    });

    return { success: true, screenId: data.screenId, activeMapId: data.mapId };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'setActiveMap',
      campaignId: data.campaignId,
    });
    throw e;
  }
};

// ---------------------------------------------------------------------------
// getActiveMap (read) — the active map for a specific tab (screen).
// ---------------------------------------------------------------------------

export const getActiveMap = async ({ data }: { data: z.infer<typeof getActiveMapSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const screen = await TabletopScreen.findOne(
      { _id: data.screenId, campaignId: data.campaignId },
      'activeMapId'
    ).lean();
    const activeMapId = (screen as { activeMapId?: unknown } | null)?.activeMapId;
    if (!activeMapId) return { map: null };

    const doc = await MapModel.findOne({
      _id: activeMapId,
      campaignId: data.campaignId,
    }).lean();
    if (!doc) return { map: null };

    return { map: serializeMap(doc as MapDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'getActiveMap',
      campaignId: data.campaignId,
    });
    throw e;
  }
};
