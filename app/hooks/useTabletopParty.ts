import usePartySocket from 'partysocket/react';
import { useCallback, useRef } from 'react';
import type { TabletopMessage } from '~/types/tabletop';
import { captureException } from '~/utils/telemetry-client';

const REALTIME_HOST = import.meta.env.VITE_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

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
      captureException(err, { source: 'useTabletopParty.parse' });
    }
  }, []);

  const roomId = campaignId ? `tabletop-${campaignId}` : '__disabled__';

  const socket = usePartySocket({
    host: REALTIME_HOST,
    room: roomId,
    party: 'tabletop',
    query: campaignId ? async () => ({ token: await getToken() }) : () => ({ token: '' }),
    onClose(event) {
      if (campaignId && event.code !== 1000) {
        captureException(new Error(`TabletopParty disconnected code=${event.code}`), {
          source: 'useTabletopParty.close',
          code: event.code,
        });
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
