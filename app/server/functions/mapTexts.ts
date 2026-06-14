import { createServerFn } from '@tanstack/react-start';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Map as MapModel } from '../db/models/Map';
import { MapText } from '../db/models/MapText';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import type { MapTextData } from '~/types/mapText';
import {
  listMapTextsSchema,
  createMapTextSchema,
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
// Auth helper (mirrors mapTokens.ts)
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
// Server functions
// ---------------------------------------------------------------------------

/** List every text on a map. All members see all text (it's shared). */
export const listMapTexts = createServerFn({ method: 'GET' })
  .inputValidator(listMapTextsSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const docs = await MapText.find({ mapId: data.mapId, campaignId: data.campaignId })
        .sort({ createdAt: 1 })
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
  });

/** Create a text on a map. Any member (player or GM) may write text. */
export const createMapText = createServerFn({ method: 'POST' })
  .inputValidator(createMapTextSchema)
  .handler(async ({ data }) => {
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
  });

/**
 * Delete a text. A player may delete only their own text; a GM may delete
 * anyone's. This permission check is the authoritative one.
 */
export const deleteMapText = createServerFn({ method: 'POST' })
  .inputValidator(deleteMapTextSchema)
  .handler(async ({ data }) => {
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
  });
