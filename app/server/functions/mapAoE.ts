import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { MapAoE } from '../db/models/MapAoE';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
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
  createdBy?: unknown;
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
    createdBy: a.createdBy ? String(a.createdBy) : '',
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

    const doc = await MapAoE.create({
      mapId: data.mapId,
      campaignId: data.campaignId,
      shape: data.shape,
      originX: data.originX,
      originY: data.originY,
      sizePx: data.sizePx,
      widthPx: data.widthPx,
      rotation: data.rotation,
      color: data.color,
      createdBy: member.userId,
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

    doc.originX = data.originX;
    doc.originY = data.originY;
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
