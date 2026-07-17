import usePartySocket from 'partysocket/react';
import { useCallback, useRef } from 'react';
import { captureException } from '~/utils/telemetry-client';

const REALTIME_HOST = import.meta.env.VITE_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999';

export function usePartySession(
  sessionId: string | null,
  getToken: () => Promise<string>,
  onMessage: (msg: unknown) => void
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const stableOnMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onMessageRef.current(data);
    } catch (err) {
      captureException(err, { source: 'usePartySession.parse' });
    }
  }, []);

  const socket = usePartySocket({
    host: REALTIME_HOST,
    room: sessionId ?? '__disabled__',
    party: 'main',
    query: sessionId ? async () => ({ token: await getToken() }) : () => ({ token: '' }),
    onClose(event) {
      if (sessionId && event.code !== 1000) {
        captureException(new Error(`Realtime disconnected code=${event.code}`), {
          source: 'usePartySession.close',
          code: event.code,
        });
      }
    },
    onMessage: stableOnMessage,
    startClosed: !sessionId,
    maxRetries: sessionId ? undefined : 0,
  });

  return socket;
}
