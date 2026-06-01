import usePartySocket from 'partysocket/react';
import { useCallback, useRef } from 'react';
import type { TabletopMessage } from '~/types/tabletop';

const PARTYKIT_HOST = import.meta.env.VITE_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

export function useTabletopParty(
  campaignId: string | null,
  getToken: () => Promise<string>,
  onMessage: (msg: TabletopMessage) => void
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const stableOnMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as TabletopMessage;
      onMessageRef.current(data);
    } catch (err) {
      console.error('[TabletopParty] Failed to parse message', err);
    }
  }, []);

  const roomId = campaignId ? `tabletop-${campaignId}` : '__disabled__';

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    party: 'tabletop',
    query: campaignId ? async () => ({ token: await getToken() }) : () => ({ token: '' }),
    onOpen() {
      console.info(`[TabletopParty] Connected to room ${roomId}`);
    },
    onClose(event) {
      if (campaignId && event.code !== 1000) {
        console.warn(`[TabletopParty] Disconnected code=${event.code}`);
      }
    },
    onMessage: stableOnMessage,
    startClosed: !campaignId,
    maxRetries: campaignId ? undefined : 0,
  });

  const send = useCallback(
    (msg: TabletopMessage) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [socket]
  );

  return { socket, send };
}
