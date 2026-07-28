import { z } from 'zod';
import { WINDOW_STATES } from '~/types/gmscreen';

/**
 * Collection names that can be opened as windows or referenced in stacks.
 * Must stay in sync with COLLECTION_REGISTRY in the server implementation.
 */
export const SUPPORTED_COLLECTIONS: [string, ...string[]] = [
  'note',
  'character',
  'race',
  'rule',
  'player',
  'location',
  'monster',
  'lore',
  'events',
  'organization',
  'quest',
  'spell',
];

// ---------------------------------------------------------------------------
// Screen CRUD
// ---------------------------------------------------------------------------

export const listGMScreensSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const createGMScreenSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Screen name is required'),
});

export const renameGMScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Screen name is required'),
});

export const deleteGMScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const reorderGMScreensSchema = z.object({
  campaignId: z.string().trim().min(1),
  screenIds: z.array(z.string().trim().min(1)).min(1, 'At least one screen ID is required'),
});

export const getGMScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export const openWindowSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  collection: z.enum(SUPPORTED_COLLECTIONS, {
    error: () => `Unsupported collection. Must be one of: ${SUPPORTED_COLLECTIONS.join(', ')}`,
  }),
  documentId: z.string().trim().min(1),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
});

export const updateWindowSchema = z
  .object({
    screenId: z.string().trim().min(1),
    campaignId: z.string().trim().min(1),
    windowId: z.string().trim().min(1),
    x: z.number().nullable().optional(),
    y: z.number().nullable().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    zIndex: z.number().optional(),
    state: z.enum(WINDOW_STATES).optional(),
  })
  .refine(
    (d) =>
      d.x !== undefined ||
      d.y !== undefined ||
      d.width !== undefined ||
      d.height !== undefined ||
      d.zIndex !== undefined ||
      d.state !== undefined,
    { message: 'At least one updatable field (x, y, width, height, zIndex, state) is required' }
  );

export const closeWindowSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  windowId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------

export const createStackSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Stack name is required'),
});

export const renameStackSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  stackId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Stack name is required'),
});

export const moveStackSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  stackId: z.string().trim().min(1),
  x: z.number().nullable(),
  y: z.number().nullable(),
});

export const deleteStackSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  stackId: z.string().trim().min(1),
});

export const addStackItemSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  stackId: z.string().trim().min(1),
  collection: z.enum(SUPPORTED_COLLECTIONS, {
    error: () => `Unsupported collection. Must be one of: ${SUPPORTED_COLLECTIONS.join(', ')}`,
  }),
  documentId: z.string().trim().min(1),
  label: z.string().trim().default(''),
});

export const removeStackItemSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  stackId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
});
