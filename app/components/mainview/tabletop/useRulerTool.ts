import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { MapTokenData } from '~/types/mapToken';
import { useRulerColor } from '~/hooks/useUserPreferences';
import { clamp } from './ActiveMapStage.geometry';

/** A measurement endpoint: a fixed image-space point, or a live token center. */
export type MeasurePoint =
  { kind: 'point'; x: number; y: number } | { kind: 'token'; tokenId: string };

interface DomPoint {
  x: number;
  y: number;
}

/** The polyline measurement resolved to DOM coordinates (what RulerOverlay renders). */
export interface RulerMeasurement {
  anchor: DomPoint;
  waypoints: DomPoint[];
  end: DomPoint;
  segments: Array<{ a: DomPoint; b: DomPoint; feet: number; mid: DomPoint }>;
}

interface UseRulerToolOptions {
  rulerActive: boolean;
  tokens: MapTokenData[];
  domToImage: (clientX: number, clientY: number) => { x: number; y: number } | null;
  imageOffsetX: number;
  imageOffsetY: number;
  effectiveScale: number;
  pixelsPerSquare: number;
  feetPerSquare: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * The measurement (ruler) tool — a client-only polyline measurement. `points`
 * are the committed vertices (fixed map points or live token centers). When
 * `cursor` is non-null the in-progress segment runs from the last committed
 * point to the cursor (live); a completed token→token measurement freezes it to
 * null. Shift+click adds a waypoint; a plain click (re)starts a single anchor;
 * double-click clears everything. All coordinates are image space until the
 * `measurement` memo resolves them to DOM. Extracted from ActiveMapStage; the
 * tool short-circuits the stage's pointer handlers and never touches its dragRef.
 */
export function useRulerTool({
  rulerActive,
  tokens,
  domToImage,
  imageOffsetX,
  imageOffsetY,
  effectiveScale,
  pixelsPerSquare,
  feetPerSquare,
  imageWidth,
  imageHeight,
}: UseRulerToolOptions) {
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measureCursor, setMeasureCursor] = useState<DomPoint | null>(null);

  // Per-user measurement line color (persisted on the user record).
  const { color: rulerColor, setColor: setRulerColor } = useRulerColor();

  // Clear the measurement whenever the ruler tool is deselected.
  useEffect(() => {
    if (!rulerActive) {
      setMeasurePoints([]);
      setMeasureCursor(null);
    }
  }, [rulerActive]);

  // Reset the whole measurement — the tool stops drawing until the next click.
  const resetMeasurement = useCallback(() => {
    setMeasurePoints([]);
    setMeasureCursor(null);
  }, []);

  // Picking a token while measuring. Shift adds it as a waypoint and keeps the
  // line live; a plain pick with an existing line completes the measurement at
  // the token (token→token, frozen); with no line yet it begins a fresh one.
  const pickTokenForMeasure = useCallback((token: MapTokenData, shiftKey: boolean) => {
    const tp: MeasurePoint = { kind: 'token', tokenId: token.id };
    setMeasurePoints((pts) => {
      if (pts.length === 0) {
        setMeasureCursor({ x: token.x, y: token.y });
        return [tp];
      }
      if (shiftKey) {
        setMeasureCursor({ x: token.x, y: token.y });
        return [...pts, tp];
      }
      setMeasureCursor(null);
      return [...pts, tp];
    });
  }, []);

  // A background click drops/relocates the measurement anchor (clicks on tokens
  // are handled by MapToken). Shift+click appends a waypoint.
  const onBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const img = domToImage(e.clientX, e.clientY);
      if (!img) return;
      const p = { x: clamp(img.x, 0, imageWidth), y: clamp(img.y, 0, imageHeight) };
      const shift = e.shiftKey;
      setMeasurePoints((pts) => {
        if (shift && pts.length > 0) {
          setMeasureCursor(p);
          return [...pts, { kind: 'point', ...p }];
        }
        setMeasureCursor(p);
        return [{ kind: 'point', ...p }];
      });
    },
    [domToImage, imageWidth, imageHeight]
  );

  // The live endpoint follows the cursor while a segment is open (cursor
  // non-null); a completed token→token measurement is frozen (cursor null).
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (measurePoints.length > 0 && measureCursor !== null) {
        const img = domToImage(e.clientX, e.clientY);
        if (img) setMeasureCursor({ x: img.x, y: img.y });
      }
    },
    [measurePoints.length, measureCursor, domToImage]
  );

  // Resolve the polyline measurement to DOM coordinates. Each segment carries
  // its own feet distance derived from the map's calibrated scale.
  const measurement = useMemo<RulerMeasurement | null>(() => {
    if (!rulerActive || measurePoints.length === 0) return null;
    const resolve = (p: MeasurePoint): DomPoint | null => {
      if (p.kind === 'point') return { x: p.x, y: p.y };
      const t = tokens.find((tk) => tk.id === p.tokenId);
      return t ? { x: t.x, y: t.y } : null;
    };
    const committedImg = measurePoints.map(resolve).filter((p): p is DomPoint => p !== null);
    if (committedImg.length === 0) return null;

    const toDom = (p: DomPoint) => ({
      x: imageOffsetX + p.x * effectiveScale,
      y: imageOffsetY + p.y * effectiveScale,
    });
    const committed = committedImg.map(toDom);
    const imgVerts = measureCursor ? [...committedImg, measureCursor] : committedImg;
    const domVerts = imgVerts.map(toDom);

    const perSquare = pixelsPerSquare || 1;
    const segments: RulerMeasurement['segments'] = [];
    for (let i = 0; i < imgVerts.length - 1; i++) {
      const a = imgVerts[i]!;
      const b = imgVerts[i + 1]!;
      const pixelDist = Math.hypot(b.x - a.x, b.y - a.y);
      const feet = Math.round((pixelDist / perSquare) * feetPerSquare);
      const da = domVerts[i]!;
      const db = domVerts[i + 1]!;
      segments.push({ a: da, b: db, feet, mid: { x: (da.x + db.x) / 2, y: (da.y + db.y) / 2 } });
    }
    return {
      anchor: committed[0]!,
      waypoints: committed.slice(1),
      end: domVerts[domVerts.length - 1]!,
      segments,
    };
  }, [
    rulerActive,
    measurePoints,
    measureCursor,
    tokens,
    pixelsPerSquare,
    feetPerSquare,
    imageOffsetX,
    imageOffsetY,
    effectiveScale,
  ]);

  return {
    measurement,
    rulerColor,
    setRulerColor,
    resetMeasurement,
    pickTokenForMeasure,
    onBackgroundPointerDown,
    onPointerMove,
  };
}
