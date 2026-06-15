import { createServerFn } from '@tanstack/react-start';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { Map as MapModel } from '../db/models/Map';
import { MapDrawing } from '../db/models/MapDrawing';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import type { MapDrawingData, MapDrawingKind } from '~/types/mapDrawing';
import {
  listMapDrawingsSchema,
  createMapDrawingSchema,
  updateMapDrawingSchema,
  deleteMapDrawingSchema,
  clearMapDrawingsSchema,
} from '~/types/schemas/mapDrawings';

// ---------------------------------------------------------------------------
// Serialiser
// ---------------------------------------------------------------------------

type DrawingDoc = {
  _id: unknown;
  mapId: unknown;
  campaignId: unknown;
  kind?: string;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
  points?: number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  createdBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

function serializeDrawing(d: DrawingDoc): MapDrawingData {
  const kind = (d.kind === 'rect' || d.kind === 'ellipse' ? d.kind : 'pencil') as MapDrawingKind;
  return {
    id: String(d._id),
    mapId: String(d.mapId),
    campaignId: String(d.campaignId),
    kind,
    color: d.color ?? '#e74c3c',
    strokeWidth: typeof d.strokeWidth === 'number' ? d.strokeWidth : 4,
    filled: Boolean(d.filled),
    points: Array.isArray(d.points) ? d.points : [],
    x: d.x ?? 0,
    y: d.y ?? 0,
    width: d.width ?? 0,
    height: d.height ?? 0,
    createdBy: d.createdBy ? String(d.createdBy) : '',
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
  };
}

// ---------------------------------------------------------------------------
// Geometry clamping into the image bounds (map-local pixels)
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Clamp a flattened [x,y,…] point list into the image. */
function clampPoints(pts: number[], w: number, h: number): number[] {
  return pts.map((v, i) => (i % 2 === 0 ? clamp(v, 0, w) : clamp(v, 0, h)));
}

/** Normalise a (possibly inverted) box and clamp it inside the image. */
function clampBox(
  x: number,
  y: number,
  width: number,
  height: number,
  w: number,
  h: number
): { x: number; y: number; width: number; height: number } {
  const minX = Math.min(x, x + width);
  const minY = Math.min(y, y + height);
  const maxX = Math.max(x, x + width);
  const maxY = Math.max(y, y + height);
  const nx = clamp(minX, 0, w);
  const ny = clamp(minY, 0, h);
  return {
    x: nx,
    y: ny,
    width: clamp(maxX - minX, 0, w - nx),
    height: clamp(maxY - minY, 0, h - ny),
  };
}

async function mapBounds(
  mapId: string,
  campaignId: string
): Promise<{ w: number; h: number } | null> {
  const map = await MapModel.findOne({ _id: mapId, campaignId }, 'imageWidth imageHeight').lean();
  if (!map) return null;
  const m = map as { imageWidth?: number; imageHeight?: number };
  return {
    w: m.imageWidth ?? Number.POSITIVE_INFINITY,
    h: m.imageHeight ?? Number.POSITIVE_INFINITY,
  };
}

// ---------------------------------------------------------------------------
// Auth helper (mirrors mapTexts.ts)
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

/** List every drawing on a map. All members see all drawings (they're shared). */
export const listMapDrawings = createServerFn({ method: 'GET' })
  .inputValidator(listMapDrawingsSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const docs = await MapDrawing.find({ mapId: data.mapId, campaignId: data.campaignId })
        .sort({ createdAt: 1 })
        .lean();
      return { drawings: docs.map((d) => serializeDrawing(d as DrawingDoc)) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listMapDrawings',
        campaignId: data.campaignId,
        mapId: data.mapId,
      });
      throw e;
    }
  });

/** Create a drawing on a map. Any member (player or GM) may draw. */
export const createMapDrawing = createServerFn({ method: 'POST' })
  .inputValidator(createMapDrawingSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const bounds = await mapBounds(data.mapId, data.campaignId);
      if (!bounds) throw new Error('Map not found');

      const base = {
        mapId: data.mapId,
        campaignId: data.campaignId,
        kind: data.kind,
        color: data.color,
        strokeWidth: data.strokeWidth,
        filled: data.filled,
        createdBy: member.userId,
      };

      let geometry: {
        points: number[];
        x: number;
        y: number;
        width: number;
        height: number;
      };
      if (data.kind === 'pencil') {
        geometry = {
          points: clampPoints(data.points ?? [], bounds.w, bounds.h),
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        };
      } else {
        const box = clampBox(
          data.x ?? 0,
          data.y ?? 0,
          data.width ?? 0,
          data.height ?? 0,
          bounds.w,
          bounds.h
        );
        geometry = { points: [], ...box };
      }

      const doc = await MapDrawing.create({ ...base, ...geometry });

      serverCaptureEvent(sessionUserId, 'map_drawing_created', {
        campaign_id: data.campaignId,
        map_id: data.mapId,
        kind: data.kind,
      });
      return { drawing: serializeDrawing(doc.toObject() as DrawingDoc) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'createMapDrawing',
        campaignId: data.campaignId,
        mapId: data.mapId,
      });
      throw e;
    }
  });

/**
 * Update a drawing's geometry/style. A player may update only their own
 * drawing; a GM may update anyone's. Authoritative permission check.
 */
export const updateMapDrawing = createServerFn({ method: 'POST' })
  .inputValidator(updateMapDrawingSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const drawing = await MapDrawing.findOne({
        _id: data.drawingId,
        mapId: data.mapId,
        campaignId: data.campaignId,
      });
      if (!drawing) throw new Error('Drawing not found');

      const canModify = member.isGM || String(drawing.createdBy) === member.userId;
      if (!canModify) throw new Error('Forbidden');

      if (data.color !== undefined) drawing.color = data.color;
      if (data.strokeWidth !== undefined) drawing.strokeWidth = data.strokeWidth;
      if (data.filled !== undefined) drawing.filled = data.filled;

      // Geometry changes (resize) are clamped into the image bounds.
      const geometryChanged =
        data.points !== undefined ||
        data.x !== undefined ||
        data.y !== undefined ||
        data.width !== undefined ||
        data.height !== undefined;
      if (geometryChanged) {
        const bounds = await mapBounds(data.mapId, data.campaignId);
        const w = bounds?.w ?? Number.POSITIVE_INFINITY;
        const h = bounds?.h ?? Number.POSITIVE_INFINITY;
        if (data.points !== undefined) drawing.points = clampPoints(data.points, w, h);
        if (
          data.x !== undefined ||
          data.y !== undefined ||
          data.width !== undefined ||
          data.height !== undefined
        ) {
          const box = clampBox(
            data.x ?? drawing.x,
            data.y ?? drawing.y,
            data.width ?? drawing.width,
            data.height ?? drawing.height,
            w,
            h
          );
          drawing.x = box.x;
          drawing.y = box.y;
          drawing.width = box.width;
          drawing.height = box.height;
        }
      }

      drawing.updatedAt = new Date();
      await drawing.save();

      return { drawing: serializeDrawing(drawing.toObject() as DrawingDoc) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'updateMapDrawing',
        campaignId: data.campaignId,
        drawingId: data.drawingId,
      });
      throw e;
    }
  });

/**
 * Delete a drawing. A player may delete only their own drawing; a GM may
 * delete anyone's. This permission check is the authoritative one.
 */
export const deleteMapDrawing = createServerFn({ method: 'POST' })
  .inputValidator(deleteMapDrawingSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const drawing = await MapDrawing.findOne({
        _id: data.drawingId,
        mapId: data.mapId,
        campaignId: data.campaignId,
      });
      if (!drawing) throw new Error('Drawing not found');

      const canDelete = member.isGM || String(drawing.createdBy) === member.userId;
      if (!canDelete) throw new Error('Forbidden');

      await MapDrawing.deleteOne({ _id: data.drawingId });
      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'deleteMapDrawing',
        campaignId: data.campaignId,
        drawingId: data.drawingId,
      });
      throw e;
    }
  });

/** Clear every drawing on a map. GM-only. */
export const clearMapDrawings = createServerFn({ method: 'POST' })
  .inputValidator(clearMapDrawingsSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;
      if (!member.isGM) throw new Error('Forbidden');

      await MapDrawing.deleteMany({ mapId: data.mapId, campaignId: data.campaignId });

      serverCaptureEvent(sessionUserId, 'map_drawings_cleared', {
        campaign_id: data.campaignId,
        map_id: data.mapId,
      });
      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'clearMapDrawings',
        campaignId: data.campaignId,
        mapId: data.mapId,
      });
      throw e;
    }
  });
