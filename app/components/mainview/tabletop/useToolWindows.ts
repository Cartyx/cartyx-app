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

/**
 * Above the map/overlays (which top out at z-30), below dialogs and the
 * token context-menu backdrop (z-50+). `focus()` re-ranks all open windows
 * from Z_BASE+1 upward on every call, so this band never grows past
 * Z_BASE + openWindows.length regardless of how many times windows are
 * refocused — it can't climb into the dialog band.
 */
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

  // Observe the workspace size (same pattern as useViewport). Unlike
  // useViewport's containerRef — attached by the same component that owns the
  // ref, present from that component's first render — this hook can be
  // instantiated by a parent (TabletopView) before the ref's element exists
  // (e.g. while a "Loading tabletop…" placeholder renders in its place). A
  // dependency of `[containerRef]` alone would never re-run once the real
  // element mounts, since the ref *object* never changes — only `.current`
  // does, and effects don't see that. Poll via rAF until the element shows
  // up, then attach the observer normally.
  useEffect(() => {
    let ro: ResizeObserver | undefined;
    let rafId: number | undefined;
    const update = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    const attach = () => {
      const el = containerRef.current;
      if (!el) {
        rafId = requestAnimationFrame(attach);
        return;
      }
      update(el);
      ro = new ResizeObserver(() => update(el));
      ro.observe(el);
    };
    attach();
    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
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
      let placedAny = false;
      for (const id of unplaced) {
        if (!elsRef.current.get(id)) continue; // not mounted yet (or never will be) — next commit
        const size = sizeOf(id);
        const pos = placeToolWindow(size, placedRects, containerSize);
        zTop += 1;
        next[id] = { ...pos, zIndex: zTop, placed: true };
        placedRects.push({ ...pos, ...size });
        placedAny = true;
      }
      // No id in `unplaced` had a mounted element this pass — e.g. a window
      // id is open but its ToolWindow never renders (no active map). Return
      // `prev` unchanged so this effect doesn't re-fire forever on a new
      // `next` object with identical values.
      return placedAny ? next : prev;
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

  // Re-rank all open windows' z-indexes from Z_BASE+1 upward with the
  // focused one on top (mirrors FloatingWindowManager's normalization) so
  // repeated alternating focuses never push windows past the modal band
  // (Z_BASE + count is always << 50 for the handful of tool windows).
  const focus = useCallback((id: ToolWindowId) => {
    setGeoms((prev) => {
      const g = prev[id];
      if (!g) return prev;
      const zTop = Math.max(Z_BASE, ...Object.values(prev).map((x) => x?.zIndex ?? Z_BASE));
      if (g.zIndex === zTop && Object.values(prev).filter((x) => x?.zIndex === zTop).length === 1) {
        return prev;
      }
      const ids = Object.keys(prev) as ToolWindowId[];
      const others = ids
        .filter((i) => prev[i] && i !== id)
        .sort((a, b) => prev[a]!.zIndex - prev[b]!.zIndex);
      const order = [...others, id];
      const next: typeof prev = { ...prev };
      order.forEach((oid, i) => {
        next[oid] = { ...prev[oid]!, zIndex: Z_BASE + 1 + i };
      });
      return next;
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
