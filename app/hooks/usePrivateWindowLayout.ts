import { useCallback, useEffect, useRef } from 'react';
import type { ManagedWindow } from '~/components/mainview/FloatingWindowManager';
import type { PrivateWindowData } from '~/types/tabletop';
import { useTabletopPlayerState } from '~/hooks/useTabletopPlayerState';

const DEBOUNCE_MS = 500;

type LayoutPayload = {
  privateWindowId: string;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  zIndex: number;
  state: 'open' | 'minimized';
};

/** FloatingWindow states collapse to the two the private-window schema stores. */
function toStoredState(state: ManagedWindow['state']): 'open' | 'minimized' {
  return state === 'minimized' ? 'minimized' : 'open';
}

/**
 * Debounced persistence for a private window's own geometry.
 *
 * Private windows store x/y/width/height/zIndex/state, and before this they were
 * written once at creation and never updated — so a drag or resize survived
 * until the next reload and then snapped back. This mirrors the shared-window
 * debounce in GMScreensView: one timer per window, flushed on unmount so a
 * gesture right before navigating away is not lost.
 *
 * Used by BOTH surfaces (tabletop and GM screens) so the two behave the same.
 */
export function usePrivateWindowLayout(campaignId: string) {
  const { updatePrivateWindow } = useTabletopPlayerState(campaignId);

  // Read the mutate fn through a ref so the unmount-only flush effect below
  // does not need it in its dep array — useMutation returns a fresh object each
  // render, and a dep on it would run the cleanup (and flush) every render.
  const mutateRef = useRef(updatePrivateWindow.mutate);
  mutateRef.current = updatePrivateWindow.mutate;

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRef = useRef<Map<string, LayoutPayload>>(new Map());
  // What we last SENT for each window. Needed because this mutation deliberately
  // does not invalidate the player-state query, so `current` keeps reporting the
  // geometry the window had when the page loaded. Comparing only against
  // `current` would mark every already-moved window as "changed" on every
  // re-emit — and FloatingWindowManager re-emits the WHOLE list on any
  // interaction, so dragging one window would fire a POST for all of them.
  const lastSentRef = useRef<Map<string, LayoutPayload>>(new Map());

  const schedule = useCallback((next: ManagedWindow, current: PrivateWindowData) => {
    const payload: LayoutPayload = {
      privateWindowId: current.id,
      x: next.position?.x ?? null,
      y: next.position?.y ?? null,
      width: next.size?.width ?? null,
      height: next.size?.height ?? null,
      zIndex: next.zIndex,
      state: toStoredState(next.state),
    };

    // Compare against the last value we sent if there is one, else against the
    // server's copy. Skips windows that did not actually move.
    const baseline: LayoutPayload = lastSentRef.current.get(current.id) ?? {
      privateWindowId: current.id,
      x: current.x ?? null,
      y: current.y ?? null,
      width: current.width ?? null,
      height: current.height ?? null,
      zIndex: current.zIndex,
      state: current.state === 'minimized' ? 'minimized' : 'open',
    };
    const unchanged =
      payload.x === baseline.x &&
      payload.y === baseline.y &&
      payload.width === baseline.width &&
      payload.height === baseline.height &&
      payload.zIndex === baseline.zIndex &&
      payload.state === baseline.state;
    if (unchanged) return;

    pendingRef.current.set(current.id, payload);

    const existing = timersRef.current.get(current.id);
    if (existing) clearTimeout(existing);
    timersRef.current.set(
      current.id,
      setTimeout(() => {
        timersRef.current.delete(current.id);
        pendingRef.current.delete(current.id);
        lastSentRef.current.set(current.id, payload);
        mutateRef.current(payload);
      }, DEBOUNCE_MS)
    );
  }, []);

  /** Drop any pending write for a window — used when it is being closed. */
  const cancel = useCallback((privateWindowId: string) => {
    const timer = timersRef.current.get(privateWindowId);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(privateWindowId);
    pendingRef.current.delete(privateWindowId);
    // Forget the baseline too: a re-opened window gets a fresh subdocument id,
    // but leaving stale entries here would grow the map for the page's lifetime.
    lastSentRef.current.delete(privateWindowId);
  }, []);

  // Unmount-only: flush what is still pending rather than discarding it.
  useEffect(() => {
    const timers = timersRef.current;
    const pending = pendingRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const payload of pending.values()) mutateRef.current(payload);
      pending.clear();
    };
  }, []);

  return { schedulePrivateLayout: schedule, cancelPrivateLayout: cancel };
}
