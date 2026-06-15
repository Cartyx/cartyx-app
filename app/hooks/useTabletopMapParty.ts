import { useCallback, useRef } from 'react';
import usePartySocket from 'partysocket/react';
import type { MapTokenData } from '~/types/mapToken';
import type { MapTextData } from '~/types/mapText';
import type { MapDrawingData } from '~/types/mapDrawing';
import { parseTabletopMapMessage } from '~/types/schemas/tabletopMessage';

const PARTYKIT_HOST = import.meta.env.VITE_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

/** Message shape sent on the `tabletop-map` party channel. */
export type TabletopMapMessage =
  | {
      type: 'map:active-changed';
      mapId: string | null;
      /** Tab the change applies to; null = unknown/any (e.g. on map delete). */
      screenId?: string | null;
    }
  | { type: 'token:added'; mapId: string; token: MapTokenData }
  | {
      type: 'token:moved';
      mapId: string;
      tokenId: string;
      x: number;
      y: number;
      /** True for the final, persisted broadcast after drag-end; false during drag. */
      final?: boolean;
    }
  | { type: 'token:removed'; mapId: string; tokenId: string }
  | { type: 'token:updated'; mapId: string; token: MapTokenData }
  | { type: 'text:added'; mapId: string; text: MapTextData }
  | {
      type: 'text:moved';
      mapId: string;
      textId: string;
      x: number;
      y: number;
      /** True for the final, persisted broadcast after drag-end; false during drag. */
      final?: boolean;
    }
  | { type: 'text:updated'; mapId: string; text: MapTextData }
  | { type: 'text:removed'; mapId: string; textId: string }
  | { type: 'drawing:added'; mapId: string; drawing: MapDrawingData }
  | { type: 'drawing:updated'; mapId: string; drawing: MapDrawingData }
  // Lightweight live-move (in-drag) update: only the bounding box, so a pencil's
  // full point list isn't re-broadcast every frame. The final commit sends the
  // authoritative `drawing:updated`.
  | {
      type: 'drawing:moved';
      mapId: string;
      drawingId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | { type: 'drawing:removed'; mapId: string; drawingId: string }
  | { type: 'drawing:cleared'; mapId: string };

/**
 * useTabletopMapParty — subscribes to the campaign's map party channel
 * and provides a `send` function. Reuses the same JWT minting as the
 * existing tabletop party (`createPartyToken`).
 */
export function useTabletopMapParty(
  campaignId: string | null,
  getToken: () => Promise<string>,
  onMessage: (msg: TabletopMapMessage) => void
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const stableOnMessage = useCallback((event: MessageEvent) => {
    let raw: unknown;
    try {
      raw = JSON.parse(event.data);
    } catch (err) {
      console.error('[TabletopMapParty] Failed to parse message', err);
      return;
    }
    // Peers can put arbitrary data on the socket — validate before dispatching.
    const msg = parseTabletopMapMessage(raw);
    if (!msg) {
      console.warn('[TabletopMapParty] Dropped invalid message', raw);
      return;
    }
    onMessageRef.current(msg);
  }, []);

  const roomId = campaignId ? `tabletop-map-${campaignId}` : '__disabled__';

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    party: 'tabletop-map',
    query: campaignId ? async () => ({ token: await getToken() }) : () => ({ token: '' }),
    onOpen() {
      console.info(`[TabletopMapParty] Connected to room ${roomId}`);
    },
    onClose(event) {
      if (campaignId && event.code !== 1000) {
        console.warn(`[TabletopMapParty] Disconnected code=${event.code}`);
      }
    },
    onMessage: stableOnMessage,
    startClosed: !campaignId,
    maxRetries: campaignId ? undefined : 0,
  });

  const send = useCallback(
    (msg: TabletopMapMessage) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [socket]
  );

  return { socket, send };
}
