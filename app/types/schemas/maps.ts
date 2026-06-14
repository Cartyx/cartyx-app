import { z } from 'zod';

export const GRID_TYPES = ['square', 'hex', 'gridless'] as const;
export type GridType = (typeof GRID_TYPES)[number];

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Invalid color');

export const listMapsSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const getMapSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const createMapSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Map name is required').max(120),
  imageKey: z.string().trim().min(1),
  imageUrl: z.string().url(),
  imageWidth: z.number().int().positive().max(20_000),
  imageHeight: z.number().int().positive().max(20_000),
  locationId: z.string().trim().min(1).nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
});

export const updateMapScaleSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  gridType: z.enum(GRID_TYPES),
  pixelsPerSquare: z.number().positive().max(2000),
  feetPerSquare: z.number().positive().max(1000).optional().default(5),
});

export const updateMapSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  locationId: z.string().trim().min(1).nullable().optional(),
  tags: z.array(z.string()).optional(),
  gridOverlay: z
    .object({
      enabled: z.boolean(),
      color: hexColor.optional(),
    })
    .optional(),
});

export const deleteMapSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const setActiveMapSchema = z.object({
  campaignId: z.string().trim().min(1),
  // The tab (TabletopScreen) to set the map on — active map is per-tab.
  screenId: z.string().trim().min(1),
  mapId: z.string().trim().min(1).nullable(),
});

export const getActiveMapSchema = z.object({
  campaignId: z.string().trim().min(1),
  screenId: z.string().trim().min(1),
});
