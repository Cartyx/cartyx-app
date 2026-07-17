import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp } from './ActiveMapStage.geometry';
import { feetToPixels, type AoeInput } from './aoeGeometry';
import type { AoeShape } from '~/types/mapAoe';

interface Options {
  aoeActive: boolean;
  shape: AoeShape;
  sizeFt: number;
  widthFt: number;
  color: string;
  domToImage: (clientX: number, clientY: number) => { x: number; y: number } | null;
  pixelsPerSquare: number;
  feetPerSquare: number;
  imageWidth: number;
  imageHeight: number;
  onCommit: (aoe: AoeInput & { color: string }) => void;
}

const RADIAL: AoeShape[] = ['sphere', 'cube', 'cylinder'];

/**
 * The AoE placement tool — a ruler-style state machine for dropping a spell
 * area-of-effect template on the map. Radial shapes (sphere/cube/cylinder)
 * commit on the first click at the clicked origin. Directional shapes
 * (cone/line) set their origin on the first click, aim live as the cursor
 * moves, and commit on the second click with the rotation implied by the
 * origin→cursor vector. Extracted alongside useRulerTool; the tool
 * short-circuits the stage's pointer handlers while active.
 */
export function useAoeTool(o: Options) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setOrigin(null);
    setCursor(null);
  }, []);

  useEffect(() => {
    if (!o.aoeActive) reset();
  }, [o.aoeActive, reset]);

  // Switching shape mid-placement abandons the in-progress origin — otherwise a
  // directional placement started as one shape could commit at that stale origin
  // with a different shape's size (mismatched template).
  useEffect(() => {
    reset();
  }, [o.shape, reset]);

  // Esc cancels an in-progress directional placement.
  useEffect(() => {
    if (!o.aoeActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !origin) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      e.preventDefault();
      reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [o.aoeActive, origin, reset]);

  const sizePx = feetToPixels(o.sizeFt, o);
  const widthPx = o.shape === 'line' ? feetToPixels(o.widthFt, o) : undefined;

  const build = useCallback(
    (ox: number, oy: number, rotation: number): AoeInput & { color: string } => ({
      shape: o.shape,
      originX: ox,
      originY: oy,
      sizePx,
      widthPx,
      rotation,
      color: o.color,
    }),
    [o.shape, o.color, sizePx, widthPx]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const img = o.domToImage(e.clientX, e.clientY);
      if (!img) return;
      const p = { x: clamp(img.x, 0, o.imageWidth), y: clamp(img.y, 0, o.imageHeight) };
      if (RADIAL.includes(o.shape)) {
        o.onCommit(build(p.x, p.y, 0));
        reset();
        return;
      }
      if (!origin) {
        setOrigin(p);
        setCursor(p);
      } else {
        const rotation = Math.atan2(p.y - origin.y, p.x - origin.x);
        o.onCommit(build(origin.x, origin.y, rotation));
        reset();
      }
    },
    [o, origin, build, reset]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!origin) return;
      const img = o.domToImage(e.clientX, e.clientY);
      if (img) setCursor(img);
    },
    [o, origin]
  );

  const preview: (AoeInput & { color: string }) | null = origin
    ? build(origin.x, origin.y, cursor ? Math.atan2(cursor.y - origin.y, cursor.x - origin.x) : 0)
    : null;

  return { preview, onPointerDown, onPointerMove, reset };
}
