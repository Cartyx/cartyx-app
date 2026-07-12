import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { placeToolWindow, TOOL_WINDOW_MARGIN, type Rect } from './placeToolWindow';
import type { ToolWindowId } from './toolWindowState';

interface WindowGeom {
  x: number;
  y: number;
  zIndex: number;
  /** false while waiting for first measure — ToolWindow renders hidden. */
  placed: boolean;
}

/** Above the map/overlays (which top out at z-30), below modals (z-50). */
const Z_BASE = 40;
const FALLBACK_SIZE = 240;

export type ToolWindowManager = ReturnType<typeof useToolWindows>;

/**
 * Owns geometry for the per-user tool windows: auto-placement on open
 * (top-left, flow down then right), drag with clamping, and z-order.
 * Open/closed state itself lives upstream (play route via toolWindowState);
 * this hook only maps ids → positions. Ephemeral by design.
 */
export function useToolWindows(
  openWindows: ToolWindowId[],
  containerRef: RefObject<HTMLElement | null>,
  onCloseWindow: (id: ToolWindowId) => void
) {
  const [geoms, setGeoms] = useState<Partial<Record<ToolWindowId, WindowGeom>>>({});
  const elsRef = useRef(new Map<ToolWindowId, HTMLDivElement>());
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Observe the workspace size (same pattern as useViewport).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Sync geometry entries with the open set: new ids start unplaced; closed
  // ids are dropped so a reopened window is re-placed fresh.
  useEffect(() => {
    setGeoms((prev) => {
      const next: typeof prev = {};
      let changed = Object.keys(prev).length !== openWindows.length;
      for (const id of openWindows) {
        if (prev[id]) {
          next[id] = prev[id];
        } else {
          next[id] = {
            x: TOOL_WINDOW_MARGIN,
            y: TOOL_WINDOW_MARGIN,
            zIndex: Z_BASE,
            placed: false,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [openWindows]);

  const sizeOf = useCallback((id: ToolWindowId) => {
    const el = elsRef.current.get(id);
    return {
      width: el?.offsetWidth || FALLBACK_SIZE,
      height: el?.offsetHeight || FALLBACK_SIZE,
    };
  }, []);

  // Measure + place unplaced windows (they rendered hidden this commit).
  useEffect(() => {
    const unplaced = openWindows.filter((id) => geoms[id] && !geoms[id]!.placed);
    if (unplaced.length === 0) return;
    setGeoms((prev) => {
      const next = { ...prev };
      const placedRects: Rect[] = openWindows
        .filter((id) => next[id]?.placed)
        .map((id) => ({ x: next[id]!.x, y: next[id]!.y, ...sizeOf(id) }));
      let zTop = Math.max(Z_BASE, ...Object.values(next).map((g) => g?.zIndex ?? Z_BASE));
      for (const id of unplaced) {
        if (!elsRef.current.get(id)) continue; // not mounted yet — next commit
        const size = sizeOf(id);
        const pos = placeToolWindow(size, placedRects, containerSize);
        zTop += 1;
        next[id] = { ...pos, zIndex: zTop, placed: true };
        placedRects.push({ ...pos, ...size });
      }
      return next;
    });
  }, [openWindows, geoms, containerSize, sizeOf]);

  const clampPos = useCallback(
    (id: ToolWindowId, pos: { x: number; y: number }) => {
      const { width, height } = sizeOf(id);
      return {
        x: Math.min(Math.max(pos.x, 0), Math.max(0, containerSize.width - width)),
        y: Math.min(Math.max(pos.y, 0), Math.max(0, containerSize.height - height)),
      };
    },
    [containerSize, sizeOf]
  );

  // Re-clamp open windows when the workspace shrinks (inspector, resize).
  useEffect(() => {
    if (containerSize.width === 0) return;
    setGeoms((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next) as ToolWindowId[]) {
        const g = next[id];
        if (!g?.placed) continue;
        const c = clampPos(id, g);
        if (c.x !== g.x || c.y !== g.y) {
          next[id] = { ...g, ...c };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [containerSize, clampPos]);

  const focus = useCallback((id: ToolWindowId) => {
    setGeoms((prev) => {
      const g = prev[id];
      if (!g) return prev;
      const zTop = Math.max(Z_BASE, ...Object.values(prev).map((x) => x?.zIndex ?? Z_BASE));
      if (g.zIndex === zTop && Object.values(prev).filter((x) => x?.zIndex === zTop).length === 1) {
        return prev;
      }
      return { ...prev, [id]: { ...g, zIndex: zTop + 1 } };
    });
  }, []);

  // Header drag — window-level listeners so the drag keeps tracking outside
  // the window/stage (the stage's own drag machine is never involved).
  const beginDrag = useCallback(
    (id: ToolWindowId, e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Let the close button (child) handle its own pointerdown.
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      e.stopPropagation();
      focus(id);
      const start = geoms[id];
      if (!start) return;
      const sx = e.clientX;
      const sy = e.clientY;
      const onMove = (ev: PointerEvent) => {
        setGeoms((prev) => {
          const g = prev[id];
          if (!g) return prev;
          const c = clampPos(id, { x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
          return { ...prev, [id]: { ...g, ...c } };
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [geoms, focus, clampPos]
  );

  const getWindowProps = useCallback(
    (id: ToolWindowId) => ({
      id,
      position: { x: geoms[id]?.x ?? TOOL_WINDOW_MARGIN, y: geoms[id]?.y ?? TOOL_WINDOW_MARGIN },
      zIndex: geoms[id]?.zIndex ?? Z_BASE,
      placed: geoms[id]?.placed ?? false,
      onClose: () => onCloseWindow(id),
      onFocus: () => focus(id),
      onHeaderPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => beginDrag(id, e),
      rootRef: (el: HTMLDivElement | null) => {
        if (el) elsRef.current.set(id, el);
        else elsRef.current.delete(id);
      },
    }),
    [geoms, onCloseWindow, focus, beginDrag]
  );

  return { getWindowProps };
}
