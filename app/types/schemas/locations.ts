import { z } from 'zod';

// ---------------------------------------------------------------------------
// Location CRUD
// ---------------------------------------------------------------------------

export const listLocationsSchema = z.object({
  campaignId: z.string().trim().min(1),
  search: z.string().optional(),
  visibility: z.enum(['all', 'public', 'private']).optional().default('all'),
  locationType: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const getLocationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const createLocationSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Location name is required'),
  locationType: z.string().trim().min(1, 'Location type is required'),
  description: z.string().optional().default(''),
  gmNotes: z.string().optional().default(''),
  isPublic: z.boolean().optional().default(true),
  parentLocations: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

export const updateLocationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Location name is required'),
  locationType: z.string().trim().min(1, 'Location type is required'),
  description: z.string().optional().default(''),
  gmNotes: z.string().optional().default(''),
  isPublic: z.boolean().optional(),
  parentLocations: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

export const deleteLocationSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// LocationType CRUD
// ---------------------------------------------------------------------------

export const listLocationTypesSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const createLocationTypeSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Type name is required'),
});

export const deleteLocationTypeSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// Location Images
// ---------------------------------------------------------------------------

export const addLocationImageSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  imageKey: z.string().trim().min(1),
  url: z.string().url(),
  title: z.string().trim().min(1, 'Image title is required'),
});

export const deleteLocationImageSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  imageKey: z.string().trim().min(1),
});
