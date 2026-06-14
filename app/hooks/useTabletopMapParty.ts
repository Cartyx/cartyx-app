import { useCallback, useRef } from 'react';
import usePartySocket from 'partysocket/react';
import type { MapTokenData } from '~/types/mapToken';
import type { MapTextData } from '~/types/mapText';

const PARTYKIT_HOST = import.meta.env.VITE_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

/** Message shape sent on the `tabletop-map` party channel. */
export type TabletopMapMessage =
  | {
      type: 'map:active-changed';
      mapId: string | null;
      /** Tab the change applies to; null = unknown/any (e.g. on map delete). */
      screenId?: string | null;
      byUserId?: string;
    }
  | { type: 'token:added'; mapId: string; token: MapTokenData; byUserId?: string }
  | {
      type: 'token:moved';
      mapId: string;
      tokenId: string;
      x: number;
      y: number;
      byUserId?: string;
      /** True for the final, persisted broadcast after drag-end; false during drag. */
      final?: boolean;
    }
  | { type: 'token:removed'; mapId: string; tokenId: string; byUserId?: string }
  | { type: 'token:updated'; mapId: string; token: MapTokenData; byUserId?: string }
  | { type: 'text:added'; mapId: string; text: MapTextData; byUserId?: string }
  | { type: 'text:removed'; mapId: string; textId: string; byUserId?: string };

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
    try {
      const data = JSON.parse(event.data) as TabletopMapMessage;
      onMessageRef.current(data);
    } catch (err) {
      console.error('[TabletopMapParty] Failed to parse message', err);
    }
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
