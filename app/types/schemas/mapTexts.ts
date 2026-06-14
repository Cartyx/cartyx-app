import { z } from 'zod';

/** A full 6-digit hex color, e.g. `#fbbf24`. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex value like #fbbf24');

export const MAX_MAP_TEXT_LENGTH = 500;
export const MIN_MAP_TEXT_FONT_SIZE = 8;
export const MAX_MAP_TEXT_FONT_SIZE = 200;

export const listMapTextsSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});

export const createMapTextSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  text: z.string().trim().min(1, 'Text is required').max(MAX_MAP_TEXT_LENGTH),
  color: hexColor,
  fontSize: z.number().int().min(MIN_MAP_TEXT_FONT_SIZE).max(MAX_MAP_TEXT_FONT_SIZE),
});

export const updateMapTextSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    mapId: z.string().trim().min(1),
    textId: z.string().trim().min(1),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    text: z.string().trim().min(1, 'Text is required').max(MAX_MAP_TEXT_LENGTH).optional(),
    color: hexColor.optional(),
    fontSize: z.number().int().min(MIN_MAP_TEXT_FONT_SIZE).max(MAX_MAP_TEXT_FONT_SIZE).optional(),
  })
  .refine(
    (d) =>
      d.x !== undefined ||
      d.y !== undefined ||
      d.text !== undefined ||
      d.color !== undefined ||
      d.fontSize !== undefined,
    { message: 'At least one field to update (x, y, text, color, fontSize) is required' }
  );

export const deleteMapTextSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  textId: z.string().trim().min(1),
});
