import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeBackendHealth, getBackendHealthSnapshot } from '~/utils/backend-health';

// Server snapshot must be a stable reference for useSyncExternalStore.
const SERVER_SNAPSHOT = { down: false, downSinceMs: null };

/**
 * Persistent connection-status banner driven by the backend circuit breaker.
 * Shown under the top of the viewport while the breaker is open; flashes a
 * brief "Reconnected" confirmation when it closes.
 */
export function ConnectionBanner() {
  const health = useSyncExternalStore(
    subscribeBackendHealth,
    getBackendHealthSnapshot,
    () => SERVER_SNAPSHOT
  );
  const [showReconnected, setShowReconnected] = useState(false);
  const wasDown = useRef(false);

  useEffect(() => {
    const cameBackUp = wasDown.current && !health.down;
    wasDown.current = health.down;
    if (!cameBackUp) return;
    setShowReconnected(true);
    const timer = setTimeout(() => setShowReconnected(false), 2_000);
    return () => clearTimeout(timer);
  }, [health.down]);

  if (health.down) {
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-50 border-b-2 border-red-700 bg-red-900 py-1 text-center text-sm text-red-100"
      >
        Connection lost — reconnecting…
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-50 border-b-2 border-green-700 bg-green-900 py-1 text-center text-sm text-green-100"
      >
        Reconnected
      </div>
    );
  }

  return null;
}
