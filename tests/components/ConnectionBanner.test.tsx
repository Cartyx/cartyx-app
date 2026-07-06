import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BackendHealthSnapshot } from '~/utils/backend-health';

const { store } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot: BackendHealthSnapshot = { down: false, downSinceMs: null };
  return {
    store: {
      listeners,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => snapshot,
      set(next: BackendHealthSnapshot) {
        snapshot = next;
        for (const listener of listeners) listener();
      },
    },
  };
});

vi.mock('~/utils/backend-health', () => ({
  subscribeBackendHealth: store.subscribe,
  getBackendHealthSnapshot: store.getSnapshot,
}));

import { ConnectionBanner } from '~/components/ConnectionBanner';

beforeEach(() => {
  vi.useFakeTimers();
  store.set({ down: false, downSinceMs: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionBanner', () => {
  it('renders nothing while healthy', () => {
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the outage banner while the breaker is open', () => {
    render(<ConnectionBanner />);
    act(() => store.set({ down: true, downSinceMs: 0 }));
    expect(screen.getByRole('status')).toHaveTextContent('Connection lost — reconnecting…');
  });

  it('flashes "Reconnected" for 2s after recovery, then clears', () => {
    render(<ConnectionBanner />);
    act(() => store.set({ down: true, downSinceMs: 0 }));
    act(() => store.set({ down: false, downSinceMs: null }));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnected');
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
