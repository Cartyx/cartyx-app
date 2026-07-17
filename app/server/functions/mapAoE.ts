import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { MapAoE } from '../db/models/MapAoE';
import { Map as MapModel } from '../db/models/Map';
import { User } from '../db/models/User';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';

/**
 * Max AoE templates per map. Any member can create, only a GM can clear-all, so
 * cap growth to protect Mongo and every client's SVG render from a runaway
 * client. Well above any realistic encounter's needs.
 */
const MAX_AOE_PER_MAP = 200;

/** Load a map's image bounds (for clamping an origin server-side). */
async function mapBounds(campaignId: string, mapId: string): Promise<{ w: number; h: number }> {
  const map = await MapModel.findOne({ _id: mapId, campaignId }, 'imageWidth imageHeight').lean();
  if (!map) throw new Error('Map not found');
  const m = map as { imageWidth?: number; imageHeight?: number };
  return {
    w: m.imageWidth ?? Number.POSITIVE_INFINITY,
    h: m.imageHeight ?? Number.POSITIVE_INFINITY,
  };
}

const clampTo = (v: number, max: number) => Math.max(0, Math.min(max, v));
import type { MapAoEData, AoeShape } from '~/types/mapAoe';
import {
  createMapAoESchema,
  listMapAoESchema,
  removeMapAoESchema,
  clearMapAoESchema,
  updateMapAoESchema,
} from '~/types/schemas/mapAoe';

// ---------------------------------------------------------------------------
// Serialiser
// ---------------------------------------------------------------------------

type AoEDoc = {
  _id: unknown;
  mapId: unknown;
  campaignId: unknown;
  shape?: string;
  originX?: number;
  originY?: number;
  sizePx?: number;
  widthPx?: number;
  rotation?: number;
  color?: string;
  label?: string;
  createdBy?: unknown;
  createdByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function serializeAoE(a: AoEDoc): MapAoEData {
  return {
    id: String(a._id),
    mapId: String(a.mapId),
    campaignId: String(a.campaignId),
    shape: (a.shape ?? 'sphere') as AoeShape,
    originX: a.originX ?? 0,
    originY: a.originY ?? 0,
    sizePx: a.sizePx ?? 0,
    widthPx: typeof a.widthPx === 'number' ? a.widthPx : undefined,
    rotation: a.rotation ?? 0,
    color: a.color ?? '#fbbf24',
    label: a.label ?? undefined,
    createdBy: a.createdBy ? String(a.createdBy) : '',
    createdByName: a.createdByName ?? '',
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : '',
    updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : '',
  };
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/** List every AoE on a map. All members see all AoEs (it's shared, not GM-gated). */
export const listMapAoE = async ({ data }: { data: z.infer<typeof listMapAoESchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const docs = await MapAoE.find({ mapId: data.mapId, campaignId: data.campaignId })
      .sort({ createdAt: 1 })
      // Bound the result set.
      .limit(2000)
      .lean();
    return { aoes: docs.map((d) => serializeAoE(d as AoEDoc)) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listMapAoE',
      campaignId: data.campaignId,
      mapId: data.mapId,
    });
    throw e;
  }
};

/** Create an AoE template on a map. Any member (player or GM) may create one. */
export const createMapAoE = async ({ data }: { data: z.infer<typeof createMapAoESchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    // Enforce a per-map cap (any member can create; only a GM clears all).
    const count = await MapAoE.countDocuments({
      campaignId: data.campaignId,
      mapId: data.mapId,
    });
    if (count >= MAX_AOE_PER_MAP) {
      throw new Error(`This map already has the maximum of ${MAX_AOE_PER_MAP} AoE templates`);
    }

    // Clamp the origin into the map's image bounds (the client clamps too, but
    // the server is the source of truth for a direct RPC).
    const { w, h } = await mapBounds(data.campaignId, data.mapId);

    const u = await User.findById(member.userId).select('firstName lastName email').lean();
    const uDoc = u as { firstName?: string; lastName?: string; email?: string } | null;
    const createdByName =
      [uDoc?.firstName, uDoc?.lastName].filter(Boolean).join(' ') || uDoc?.email || 'Unknown';

    const doc = await MapAoE.create({
      mapId: data.mapId,
      campaignId: data.campaignId,
      shape: data.shape,
      originX: clampTo(data.originX, w),
      originY: clampTo(data.originY, h),
      sizePx: data.sizePx,
      widthPx: data.widthPx,
      rotation: data.rotation,
      color: data.color,
      // Never persist a blank/whitespace-only label (UI already omits it; this
      // guards direct server-fn callers).
      label: data.label?.trim() || undefined,
      createdBy: member.userId,
      createdByName,
    });

    serverCaptureEvent(sessionUserId, 'map_aoe_created', {
      campaign_id: data.campaignId,
      map_id: data.mapId,
    });
    return { aoe: serializeAoE(doc.toObject() as AoEDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'createMapAoE',
      campaignId: data.campaignId,
      mapId: data.mapId,
    });
    throw e;
  }
};

/**
 * Remove an AoE. A player may remove only their own AoE; a GM may remove
 * anyone's. This permission check is the authoritative one.
 */
export const removeMapAoE = async ({ data }: { data: z.infer<typeof removeMapAoESchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const doc = await MapAoE.findOne({
      _id: data.id,
      mapId: data.mapId,
      campaignId: data.campaignId,
    });
    if (!doc) throw new Error('AoE not found');

    const canRemove = String(doc.createdBy) === member.userId || member.isGM;
    if (!canRemove) throw new Error('Forbidden');

    await doc.deleteOne();
    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'removeMapAoE',
      campaignId: data.campaignId,
      mapId: data.mapId,
      id: data.id,
    });
    throw e;
  }
};

/**
 * Move an AoE's origin. A player may move only their own AoE; a GM may move
 * anyone's. This permission check is the authoritative one.
 */
export const moveMapAoE = async ({ data }: { data: z.infer<typeof updateMapAoESchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const doc = await MapAoE.findOne({
      _id: data.id,
      mapId: data.mapId,
      campaignId: data.campaignId,
    });
    if (!doc) throw new Error('AoE not found');

    const canMove = String(doc.createdBy) === member.userId || member.isGM;
    if (!canMove) throw new Error('Forbidden');

    // Clamp into the map's image bounds (server is source of truth).
    const { w, h } = await mapBounds(data.campaignId, data.mapId);
    doc.originX = clampTo(data.originX, w);
    doc.originY = clampTo(data.originY, h);
    await doc.save();

    return { aoe: serializeAoE(doc.toObject() as AoEDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'moveMapAoE',
      campaignId: data.campaignId,
      mapId: data.mapId,
      id: data.id,
    });
    throw e;
  }
};

/** Clear every AoE on a map. GM-only. */
export const clearMapAoE = async ({ data }: { data: z.infer<typeof clearMapAoESchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    if (!member.isGM) throw new Error('Forbidden');

    await MapAoE.deleteMany({ campaignId: data.campaignId, mapId: data.mapId });
    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'clearMapAoE',
      campaignId: data.campaignId,
      mapId: data.mapId,
    });
    throw e;
  }
};

export {
  createMapAoESchema,
  listMapAoESchema,
  removeMapAoESchema,
  clearMapAoESchema,
  updateMapAoESchema,
};
