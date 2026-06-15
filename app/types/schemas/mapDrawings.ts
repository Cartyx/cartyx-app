import { z } from 'zod';

/** A full 6-digit hex color, e.g. `#e74c3c`. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex value like #e74c3c');

export const MIN_STROKE_WIDTH = 1;
export const MAX_STROKE_WIDTH = 64;
// Flattened point cap (x,y pairs) for a single pencil stroke — keeps documents
// small; the client throttles capture to stay well under this.
export const MAX_DRAWING_POINT_VALUES = 4000;

const drawingKind = z.enum(['pencil', 'rect', 'ellipse']);
const strokeWidth = z.number().int().min(MIN_STROKE_WIDTH).max(MAX_STROKE_WIDTH);
const points = z.array(z.number().finite()).max(MAX_DRAWING_POINT_VALUES);

export const listMapDrawingsSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});

export const createMapDrawingSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    mapId: z.string().trim().min(1),
    kind: drawingKind,
    color: hexColor,
    strokeWidth,
    filled: z.boolean(),
    points: points.optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().optional(),
    height: z.number().finite().optional(),
  })
  .refine(
    (d) =>
      d.kind === 'pencil'
        ? Array.isArray(d.points) && d.points.length >= 4 && d.points.length % 2 === 0
        : d.x !== undefined && d.y !== undefined && d.width !== undefined && d.height !== undefined,
    {
      message:
        'pencil requires an even points array (≥2 points); rect/ellipse require x, y, width, height',
    }
  );

export const updateMapDrawingSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    mapId: z.string().trim().min(1),
    drawingId: z.string().trim().min(1),
    color: hexColor.optional(),
    strokeWidth: strokeWidth.optional(),
    filled: z.boolean().optional(),
    // When present (pencil resize/move), points must stay a valid even-length
    // [x,y,…] list with at least two points — same invariant as create.
    points: points
      .refine((p) => p.length >= 4 && p.length % 2 === 0, {
        message: 'points must be an even-length array with at least 2 points',
      })
      .optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().optional(),
    height: z.number().finite().optional(),
  })
  .refine(
    (d) =>
      d.color !== undefined ||
      d.strokeWidth !== undefined ||
      d.filled !== undefined ||
      d.points !== undefined ||
      d.x !== undefined ||
      d.y !== undefined ||
      d.width !== undefined ||
      d.height !== undefined,
    { message: 'At least one field to update is required' }
  );

export const deleteMapDrawingSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  drawingId: z.string().trim().min(1),
});

export const clearMapDrawingsSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});
