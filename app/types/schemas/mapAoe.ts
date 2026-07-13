import { z } from 'zod';

export const AOE_SHAPES = ['sphere', 'cone', 'cube', 'line', 'cylinder'] as const;

export const createMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  shape: z.enum(AOE_SHAPES),
  originX: z.number(),
  originY: z.number(),
  sizePx: z.number().positive(),
  widthPx: z.number().positive().optional(),
  rotation: z.number(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const listMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});
export const removeMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  id: z.string().trim().min(1),
});
export const clearMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});
