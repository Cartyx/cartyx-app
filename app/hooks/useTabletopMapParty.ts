import { useCallback, useRef } from 'react';
import usePartySocket from 'partysocket/react';

const PARTYKIT_HOST = import.meta.env.VITE_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

/**
 * Message shape sent on the `tabletop-map` party channel.
 *
 * Phase 1 only emits `map:active-changed`. Phase 2 will add token events
 * (`token:added`, `token:moved`, `token:removed`, `token:updated`).
 */
export type TabletopMapMessage = {
  type: 'map:active-changed';
  mapId: string | null;
  byUserId?: string;
};

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
