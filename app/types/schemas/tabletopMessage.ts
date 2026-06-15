import { z } from 'zod';
import { TOKEN_SOURCES } from '~/types/schemas/mapTokens';
import type { TabletopMapMessage } from '~/hooks/useTabletopMapParty';

/**
 * Runtime validation for inbound `tabletop-map` party messages. Peers can put
 * arbitrary bytes on the socket, so every frame is validated before it touches
 * the query cache. Nested entity payloads (token/text/drawing) are validated in
 * full against their serialized shapes — a frame with a missing/mistyped field
 * (e.g. no `x`, `hiddenFromPlayers`, or `labelVisible`) is rejected rather than
 * cached, so forged or buggy frames can't seed the cache with an incomplete
 * object that later crashes render/interaction code.
 */
const id = z.string().min(1);
const num = z.number().finite();
const isoDate = z.string();

const tokenData = z.object({
  id,
  mapId: id,
  campaignId: id,
  sourceCollection: z.enum(TOKEN_SOURCES),
  sourceDocumentId: z.string(),
  ownerUserId: z.string().nullable(),
  x: num,
  y: num,
  sizeSquares: num,
  instanceNumber: num.nullable(),
  color: z.string(),
  label: z.string(),
  imageUrl: z.string(),
  labelVisible: z.boolean(),
  hiddenFromPlayers: z.boolean(),
  zIndex: num,
  createdAt: isoDate,
  updatedAt: isoDate,
});

const textData = z.object({
  id,
  mapId: id,
  campaignId: id,
  x: num,
  y: num,
  text: z.string(),
  color: z.string(),
  fontSize: num,
  createdBy: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const drawingData = z.object({
  id,
  mapId: id,
  campaignId: id,
  kind: z.enum(['pencil', 'rect', 'ellipse']),
  color: z.string(),
  strokeWidth: num,
  filled: z.boolean(),
  points: z.array(num),
  x: num,
  y: num,
  width: num,
  height: num,
  createdBy: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const messageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('map:active-changed'),
    mapId: id.nullable(),
    screenId: id.nullable().optional(),
  }),
  z.object({ type: z.literal('token:added'), mapId: id, token: tokenData }),
  z.object({
    type: z.literal('token:moved'),
    mapId: id,
    tokenId: id,
    x: z.number().finite(),
    y: z.number().finite(),
    final: z.boolean().optional(),
  }),
  z.object({ type: z.literal('token:removed'), mapId: id, tokenId: id }),
  z.object({ type: z.literal('token:updated'), mapId: id, token: tokenData }),
  z.object({ type: z.literal('text:added'), mapId: id, text: textData }),
  z.object({
    type: z.literal('text:moved'),
    mapId: id,
    textId: id,
    x: z.number().finite(),
    y: z.number().finite(),
    final: z.boolean().optional(),
  }),
  z.object({ type: z.literal('text:updated'), mapId: id, text: textData }),
  z.object({ type: z.literal('text:removed'), mapId: id, textId: id }),
  z.object({ type: z.literal('drawing:added'), mapId: id, drawing: drawingData }),
  z.object({ type: z.literal('drawing:updated'), mapId: id, drawing: drawingData }),
  z.object({
    type: z.literal('drawing:moved'),
    mapId: id,
    drawingId: id,
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  }),
  z.object({ type: z.literal('drawing:removed'), mapId: id, drawingId: id }),
  z.object({ type: z.literal('drawing:cleared'), mapId: id }),
]);

/** Parse + validate a raw inbound frame. Returns null for malformed messages. */
export function parseTabletopMapMessage(raw: unknown): TabletopMapMessage | null {
  const result = messageSchema.safeParse(raw);
  return result.success ? (result.data as TabletopMapMessage) : null;
}
