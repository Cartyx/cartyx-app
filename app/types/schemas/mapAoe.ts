import { z } from 'zod';

export const AOE_SHAPES = ['sphere', 'cone', 'cube', 'line', 'cylinder'] as const;

/** Sane ceiling so a malicious/buggy client can't persist a map-swallowing template. */
export const MAX_AOE_PX = 20000;

export const createMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  shape: z.enum(AOE_SHAPES),
  originX: z.number().finite(),
  originY: z.number().finite(),
  sizePx: z.number().finite().positive().max(MAX_AOE_PX),
  widthPx: z.number().finite().positive().max(MAX_AOE_PX).optional(),
  rotation: z.number().finite(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  label: z.string().trim().max(60).optional(),
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
export const updateMapAoESchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  id: z.string().trim().min(1),
  originX: z.number().finite(),
  originY: z.number().finite(),
});
