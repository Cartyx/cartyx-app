import { z } from 'zod';

export const TOKEN_SOURCES = ['player', 'character', 'monster'] as const;
export type TokenSource = (typeof TOKEN_SOURCES)[number];

export const listMapTokensSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
});

export const createMapTokenSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  sourceCollection: z.enum(TOKEN_SOURCES),
  sourceDocumentId: z.string().trim().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  // Optional — when omitted the server derives the footprint from the source
  // entity (monsters scale up by size; players/characters default to 1).
  sizeSquares: z.number().positive().max(20).optional(),
});

/** Place N instances of a monster at random positions (ctrl/cmd-drag). */
export const createMapTokensBatchSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  sourceCollection: z.literal('monster'),
  sourceDocumentId: z.string().trim().min(1),
  count: z.number().int().min(1).max(20),
});

export const moveMapTokenSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  tokenId: z.string().trim().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const updateMapTokenSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  tokenId: z.string().trim().min(1),
  labelVisible: z.boolean().optional(),
  hiddenFromPlayers: z.boolean().optional(),
  sizeSquares: z.number().positive().max(20).optional(),
  color: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
    .optional(),
  label: z.string().max(60).optional(),
});

export const deleteMapTokenSchema = z.object({
  campaignId: z.string().trim().min(1),
  mapId: z.string().trim().min(1),
  tokenId: z.string().trim().min(1),
});
