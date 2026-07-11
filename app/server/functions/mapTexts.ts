import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Map as MapModel } from '../db/models/Map';
import { MapText } from '../db/models/MapText';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import type { MapTextData } from '~/types/mapText';
import {
  listMapTextsSchema,
  createMapTextSchema,
  updateMapTextSchema,
  deleteMapTextSchema,
} from '~/types/schemas/mapTexts';

// ---------------------------------------------------------------------------
// Serialiser
// ---------------------------------------------------------------------------

type TextDoc = {
  _id: unknown;
  mapId: unknown;
  campaignId: unknown;
  x?: number;
  y?: number;
  text?: string;
  color?: string;
  fontSize?: number;
  createdBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

function serializeText(t: TextDoc): MapTextData {
  return {
    id: String(t._id),
    mapId: String(t.mapId),
    campaignId: String(t.campaignId),
    x: t.x ?? 0,
    y: t.y ?? 0,
    text: t.text ?? '',
    color: t.color ?? '#fbbf24',
    fontSize: typeof t.fontSize === 'number' ? t.fontSize : 16,
    createdBy: t.createdBy ? String(t.createdBy) : '',
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : '',
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : '',
  };
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/** List every text on a map. All members see all text (it's shared). */
export const listMapTexts = async ({ data }: { data: z.infer<typeof listMapTextsSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const docs = await MapText.find({ mapId: data.mapId, campaignId: data.campaignId })
      .sort({ createdAt: 1 })
      // Bound the result set.
      .limit(2000)
      .lean();
    return { texts: docs.map((d) => serializeText(d as TextDoc)) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'listMapTexts',
      campaignId: data.campaignId,
      mapId: data.mapId,
    });
    throw e;
  }
};

/** Create a text on a map. Any member (player or GM) may write text. */
export const createMapText = async ({ data }: { data: z.infer<typeof createMapTextSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const map = await MapModel.findOne(
      { _id: data.mapId, campaignId: data.campaignId },
      'imageWidth imageHeight'
    ).lean();
    if (!map) throw new Error('Map not found');
    const mDoc = map as { imageWidth?: number; imageHeight?: number };

    // Clamp into the image bounds.
    const w = mDoc.imageWidth ?? Number.POSITIVE_INFINITY;
    const h = mDoc.imageHeight ?? Number.POSITIVE_INFINITY;
    const x = Math.max(0, Math.min(w, data.x));
    const y = Math.max(0, Math.min(h, data.y));

    const doc = await MapText.create({
      mapId: data.mapId,
      campaignId: data.campaignId,
      x,
      y,
      text: data.text,
      color: data.color,
      fontSize: data.fontSize,
      createdBy: member.userId,
    });

    serverCaptureEvent(sessionUserId, 'map_text_created', {
      campaign_id: data.campaignId,
      map_id: data.mapId,
    });
    return { text: serializeText(doc.toObject() as TextDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'createMapText',
      campaignId: data.campaignId,
      mapId: data.mapId,
    });
    throw e;
  }
};

/**
 * Update a text's position and/or content/style. A player may update only
 * their own text; a GM may update anyone's. Authoritative permission check.
 */
export const updateMapText = async ({ data }: { data: z.infer<typeof updateMapTextSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const text = await MapText.findOne({
      _id: data.textId,
      mapId: data.mapId,
      campaignId: data.campaignId,
    });
    if (!text) throw new Error('Text not found');

    const canModify = member.isGM || String(text.createdBy) === member.userId;
    if (!canModify) throw new Error('Forbidden');

    if (data.x !== undefined || data.y !== undefined) {
      const map = await MapModel.findOne(
        { _id: data.mapId, campaignId: data.campaignId },
        'imageWidth imageHeight'
      ).lean();
      const mDoc = (map ?? {}) as { imageWidth?: number; imageHeight?: number };
      const w = mDoc.imageWidth ?? Number.POSITIVE_INFINITY;
      const h = mDoc.imageHeight ?? Number.POSITIVE_INFINITY;
      if (data.x !== undefined) text.x = Math.max(0, Math.min(w, data.x));
      if (data.y !== undefined) text.y = Math.max(0, Math.min(h, data.y));
    }
    if (data.text !== undefined) text.text = data.text;
    if (data.color !== undefined) text.color = data.color;
    if (data.fontSize !== undefined) text.fontSize = data.fontSize;
    text.updatedAt = new Date();
    await text.save();

    return { text: serializeText(text.toObject() as TextDoc) };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'updateMapText',
      campaignId: data.campaignId,
      textId: data.textId,
    });
    throw e;
  }
};

/**
 * Delete a text. A player may delete only their own text; a GM may delete
 * anyone's. This permission check is the authoritative one.
 */
export const deleteMapText = async ({ data }: { data: z.infer<typeof deleteMapTextSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const text = await MapText.findOne({
      _id: data.textId,
      mapId: data.mapId,
      campaignId: data.campaignId,
    });
    if (!text) throw new Error('Text not found');

    const canDelete = member.isGM || String(text.createdBy) === member.userId;
    if (!canDelete) throw new Error('Forbidden');

    await MapText.deleteOne({ _id: data.textId });
    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, {
      action: 'deleteMapText',
      campaignId: data.campaignId,
      textId: data.textId,
    });
    throw e;
  }
};
