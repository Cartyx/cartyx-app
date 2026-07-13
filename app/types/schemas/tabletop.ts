import { z } from 'zod';
import { GRID_STYLES, TABLETOP_MODES, SESSION_EVENT_TYPES } from '~/types/tabletop';

// ---------------------------------------------------------------------------
// Screen CRUD
// ---------------------------------------------------------------------------

export const listTabletopScreensSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const createTabletopScreenSchema = z.object({
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Tab name is required'),
});

export const getTabletopScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const renameTabletopScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Tab name is required'),
});

export const deleteTabletopScreenSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
});

export const updateTabletopScreenSettingsSchema = z.object({
  id: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  gridStyle: z.enum(GRID_STYLES).optional(),
  gridSize: z.number().min(20).max(200).optional(),
  gridVisible: z.boolean().optional(),
  gridScale: z.number().min(1).max(1000).optional(),
  mode: z.enum(TABLETOP_MODES).optional(),
});

// ---------------------------------------------------------------------------
// Windows (on tabletop screens)
// ---------------------------------------------------------------------------

const TABLETOP_COLLECTIONS: [string, ...string[]] = [
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
];

export const openTabletopWindowSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  collection: z.enum(TABLETOP_COLLECTIONS),
  documentId: z.string().trim().min(1),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
});

export const closeTabletopWindowSchema = z.object({
  screenId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  windowId: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// Player State
// ---------------------------------------------------------------------------

export const getPlayerStateSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const updatePlayerStateSchema = z.object({
  campaignId: z.string().trim().min(1),
  activeScreenId: z.string().nullable().optional(),
  viewport: z
    .object({
      screenId: z.string().trim().min(1),
      zoom: z.number(),
      panX: z.number(),
      panY: z.number(),
    })
    .optional(),
  windowOverride: z
    .object({
      windowId: z.string().trim().min(1),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      state: z.enum(['open', 'minimized', 'hidden']),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Session Events
// ---------------------------------------------------------------------------

export const createSessionEventSchema = z.object({
  campaignId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  eventType: z.enum(SESSION_EVENT_TYPES),
  documentId: z.string().trim().min(1),
  collection: z.string().trim().min(1),
  tabletopScreenId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
});

export const listSessionEventsSchema = z.object({
  campaignId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
});
