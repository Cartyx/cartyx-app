import { z } from 'zod';
import type { TabletopMapMessage } from '~/hooks/useTabletopMapParty';

/**
 * Runtime validation for inbound `tabletop-map` party messages. Peers can put
 * arbitrary bytes on the socket, so every frame is validated before it touches
 * the query cache. Nested entity payloads (token/text/drawing) are validated
 * loosely — they must be an object carrying a string `id` — because the server
 * is the authority for their contents; the goal here is to drop malformed or
 * forged-shape frames, not to re-derive the full DB schema on the client.
 */
const id = z.string().min(1);
const entity = z.object({ id }).passthrough();

const messageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('map:active-changed'),
    mapId: id.nullable(),
    screenId: id.nullable().optional(),
  }),
  z.object({ type: z.literal('token:added'), mapId: id, token: entity }),
  z.object({
    type: z.literal('token:moved'),
    mapId: id,
    tokenId: id,
    x: z.number().finite(),
    y: z.number().finite(),
    final: z.boolean().optional(),
  }),
  z.object({ type: z.literal('token:removed'), mapId: id, tokenId: id }),
  z.object({ type: z.literal('token:updated'), mapId: id, token: entity }),
  z.object({ type: z.literal('text:added'), mapId: id, text: entity }),
  z.object({
    type: z.literal('text:moved'),
    mapId: id,
    textId: id,
    x: z.number().finite(),
    y: z.number().finite(),
    final: z.boolean().optional(),
  }),
  z.object({ type: z.literal('text:updated'), mapId: id, text: entity }),
  z.object({ type: z.literal('text:removed'), mapId: id, textId: id }),
  z.object({ type: z.literal('drawing:added'), mapId: id, drawing: entity }),
  z.object({ type: z.literal('drawing:updated'), mapId: id, drawing: entity }),
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
