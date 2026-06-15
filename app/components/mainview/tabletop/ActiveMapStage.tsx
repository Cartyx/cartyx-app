import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
  Eye,
  EyeOff,
  Type,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapData } from '~/types/map';
import type { MapTokenData } from '~/types/mapToken';
import type { MapTextData } from '~/types/mapText';
import type { MapDrawingData } from '~/types/mapDrawing';
import {
  useMapTokens,
  useMapTokenMutations,
  applyTokenMoveToCache,
  applyTokenRemoveFromCache,
  applyTokenUpdateToCache,
} from '~/hooks/useMapTokens';
import {
  useMapTexts,
  useMapTextMutations,
  applyTextAddToCache,
  applyTextRemoveFromCache,
  applyTextMoveToCache,
  applyTextUpdateToCache,
} from '~/hooks/useMapTexts';
import {
  useMapDrawings,
  useMapDrawingMutations,
  applyDrawingAddToCache,
  applyDrawingUpdateToCache,
  applyDrawingRemoveFromCache,
  applyDrawingsClearToCache,
} from '~/hooks/useMapDrawings';
import { MapToken } from './MapToken';
import { LayersPanel } from './LayersPanel';
import { RulerSettingsPanel } from './RulerSettingsPanel';
import { TextSettingsPanel } from './TextSettingsPanel';
import { DrawingSettingsPanel, type DrawShape } from './DrawingSettingsPanel';
import { MAX_DRAWING_POINT_VALUES } from '~/types/schemas/mapDrawings';
import { useRulerColor } from '~/hooks/useUserPreferences';
import {
  tokenLayerId,
  tokenLayerRenderOrder,
  type MapLayerId,
  type TokenLayerId,
} from '~/types/mapLayer';
import type { TabletopMapMessage } from '~/hooks/useTabletopMapParty';

interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

interface ActiveMapStageProps {
  map: MapData;
  campaignId: string;
  isGM: boolean;
  /** Database user id of the current viewer — used to gate per-token moves. */
  currentUserId: string | null;
  /** Broadcaster for the tabletop-map party. */
  onBroadcast: (msg: TabletopMapMessage) => void;
  /** Whether the GM's Layers panel (toolbar Layer tool) is open. */
  layerPanelOpen?: boolean;
  /** Close the Layers panel (resets the toolbar tool). */
  onCloseLayerPanel?: () => void;
  /** Whether the measurement (ruler) tool is active. */
  rulerActive?: boolean;
  /** Whether the text tool is active (click to write, click text to select). */
  textActive?: boolean;
  /** Whether the drawing tool is active (draw shapes / erase on the map). */
  drawingActive?: boolean;
  /** Whether the pointer tool is active (select/resize/delete drawings). */
  pointerActive?: boolean;
}

/** A measurement endpoint: a fixed image-space point, or a live token center. */
type MeasurePoint = { kind: 'point'; x: number; y: number } | { kind: 'token'; tokenId: string };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const MOVE_BROADCAST_HZ = 30;
const MOVE_BROADCAST_INTERVAL_MS = 1000 / MOVE_BROADCAST_HZ;

/**
 * ActiveMapStage — renders the currently active map for the whole tabletop.
 *
 * Coordinate system: tokens and the gizmo all live in IMAGE-PIXEL space;
 * the viewport transform (fit-scale × zoom + pan) converts to DOM pixels
 * at render time. Same model as the upload-modal scale gizmo, so what you
 * calibrated in the upload flow is what you see here.
 *
 * Controls:
 *   - Wheel / pinch       → zoom around cursor
 *   - Drag background     → pan
 *   - Drag token (GM or owner) → move that token
 *   - Drop player/character from a wiki list → create a token
 *
 * Realtime: token writes go through mutations + a peer broadcast on the
 * tabletop-map party. The parent's inbound message handler invokes the
 * functions exposed via `inboundRef` to apply remote changes optimistically.
 */
export function ActiveMapStage({
  map,
  campaignId,
  isGM,
  currentUserId,
  onBroadcast,
  layerPanelOpen = false,
  onCloseLayerPanel,
  rulerActive = false,
  textActive = false,
  drawingActive = false,
  pointerActive = false,
}: ActiveMapStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const qc = useQueryClient();
  const { data: tokens = [] } = useMapTokens(campaignId, map.id);
  const mutations = useMapTokenMutations(campaignId, map.id);

  // Grid overlay — initialized from the map's saved preference, toggled
  // locally from the toolbar. Drawn only for square grids (gridless maps
  // have no grid; hex rendering is a future addition).
  const [showGrid, setShowGrid] = useState<boolean>(map.gridOverlay.enabled);
  const hasGrid = map.scale.gridType === 'square' && map.scale.pixelsPerSquare > 0;

  // Map text (freeform labels) — shared, persisted, multiplayer. Any member can
  // write; deletion is gated to the author or a GM (enforced server-side).
  const { data: texts = [] } = useMapTexts(campaignId, map.id);
  const textMutations = useMapTextMutations(campaignId, map.id);
  // Local view toggle (per-viewer declutter), like the grid toggle.
  const [showText, setShowText] = useState(true);
  // Text-tool settings (the brush) — local to this client.
  const [textColor, setTextColor] = useState('#fbbf24');
  const [textFontSize, setTextFontSize] = useState(16);
  // Draggable position of the settings panel (workspace px), clamped on drag
  // AND on workspace resize so it can never be lost behind the toolbar /
  // off-screen (where the stage's overflow-hidden would clip it away). Shared
  // by the text + drawing tools (only one panel is shown at a time).
  const [panelPos, setPanelPos] = useState({ x: 12, y: 12 });
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The in-progress text being typed (image-space anchor + value), and the
  // currently selected text (for deletion).
  const [textDraft, setTextDraft] = useState<{
    x: number;
    y: number;
    /** Set when editing an existing text (vs. creating a new one). */
    editingId?: string;
  } | null>(null);
  const [textDraftValue, setTextDraftValue] = useState('');
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);

  // Map drawings (freeform shapes) — shared, persisted, multiplayer. Any member
  // can draw; modification (resize/delete) is gated to the author or a GM
  // (enforced server-side). Local view toggle declutters per-viewer.
  const { data: drawings = [] } = useMapDrawings(campaignId, map.id);
  const drawingMutations = useMapDrawingMutations(campaignId, map.id);
  const [showDrawings, setShowDrawings] = useState(true);
  // Drawing-tool brush settings (local to this client).
  const [drawShape, setDrawShape] = useState<DrawShape>('pencil');
  const [drawColor, setDrawColor] = useState('#e74c3c');
  const [drawStrokeWidth, setDrawStrokeWidth] = useState(4);
  const [drawFilled, setDrawFilled] = useState(false);
  // Selected drawing (pointer tool) + the GM "clear all" confirm.
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawingsPendingClear, setDrawingsPendingClear] = useState(false);
  // Live in-progress geometry while drawing (rendered as a preview overlay).
  const [drawPreview, setDrawPreview] = useState<{
    kind: 'pencil' | 'rect' | 'ellipse';
    color: string;
    strokeWidth: number;
    filled: boolean;
    points: number[];
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Token selection — click selects (shift/cmd-click toggles), background
  // click deselects, Delete/Backspace confirms removal (GM only), right-click
  // opens a layer-move menu.
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(() => new Set());
  const [tokensPendingDelete, setTokensPendingDelete] = useState<MapTokenData[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Layers — GM-local working layer + per-layer visibility (GM's own view;
  // players never gain this panel so it stays empty for them).
  const [activeLayer, setActiveLayer] = useState<MapLayerId>('public');
  const [hiddenLayers, setHiddenLayers] = useState<Set<MapLayerId>>(() => new Set());

  // Measurement (ruler) tool — a client-only polyline measurement. `points`
  // are the committed vertices (fixed map points or live token centers). When
  // `cursor` is non-null the in-progress segment runs from the last committed
  // point to the cursor (live); a completed token→token measurement freezes it
  // to null. Shift+click adds a waypoint; a plain click (re)starts a single
  // anchor; double-click clears everything. All coordinates are image space.
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measureCursor, setMeasureCursor] = useState<{ x: number; y: number } | null>(null);

  // Per-user measurement line color (persisted on the user record).
  const { color: rulerColor, setColor: setRulerColor } = useRulerColor();

  // The ruler settings popup is shown while the tool is active; closing it
  // hides just the popup (the ruler stays usable). Re-opens when re-selected.
  const [rulerPanelOpen, setRulerPanelOpen] = useState(false);

  // Clear the measurement whenever the ruler tool is deselected; (re)open the
  // settings popup whenever it's selected.
  useEffect(() => {
    if (!rulerActive) {
      setMeasurePoints([]);
      setMeasureCursor(null);
    } else {
      setRulerPanelOpen(true);
    }
  }, [rulerActive]);

  // Reset the whole measurement — the tool stops drawing until the next click.
  // Bound to a double-click on the stage.
  const resetMeasurement = useCallback(() => {
    setMeasurePoints([]);
    setMeasureCursor(null);
  }, []);

  // --- Text tool ----------------------------------------------------------
  // Guards against a double-commit (Enter then unmount-blur) of the same draft.
  const draftActiveRef = useRef(false);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  // Clear text editing/selection when the text tool is deselected. (The
  // settings panel is always shown while the tool is active — see render.)
  useEffect(() => {
    if (!textActive) {
      draftActiveRef.current = false;
      setTextDraft(null);
      setTextDraftValue('');
      setSelectedTextId(null);
    }
  }, [textActive]);

  const openTextDraft = useCallback((p: { x: number; y: number }) => {
    draftActiveRef.current = true;
    setTextDraft(p);
    setTextDraftValue('');
    setSelectedTextId(null);
  }, []);

  // Open the editor over an existing text (double-click to edit), prefilled.
  // Sync the brush to the text so the editor renders at its size/color and a
  // size/color change made while editing applies to it on commit.
  const openTextEdit = useCallback((t: MapTextData) => {
    draftActiveRef.current = true;
    setSelectedTextId(null);
    setTextColor(t.color);
    setTextFontSize(t.fontSize);
    setTextDraft({ x: t.x, y: t.y, editingId: t.id });
    setTextDraftValue(t.text);
  }, []);

  // Focus the draft input on the next frame — focusing synchronously during the
  // opening pointerdown gets clobbered by the browser's default mousedown focus
  // handling, which would immediately blur (and commit-empty) the input. When
  // editing existing text, select it all so typing replaces it.
  useEffect(() => {
    if (!textDraft) return;
    const editing = textDraft.editingId != null;
    const id = requestAnimationFrame(() => {
      const el = textInputRef.current;
      if (!el) return;
      el.focus();
      if (editing) el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [textDraft]);

  const cancelTextDraft = useCallback(() => {
    draftActiveRef.current = false;
    setTextDraft(null);
    setTextDraftValue('');
  }, []);

  // A player may modify (move/edit/delete) only their own text; a GM may modify
  // anyone's. The server enforces this; the client mirrors it for affordances.
  const canModifyText = useCallback(
    (t: MapTextData) => isGM || (currentUserId != null && t.createdBy === currentUserId),
    [isGM, currentUserId]
  );

  // --- Drawing tool -------------------------------------------------------
  // A player may modify (resize/delete) only their own drawing; a GM may modify
  // anyone's. The server enforces this; the client mirrors it for affordances.
  const canModifyDrawing = useCallback(
    (d: MapDrawingData) => isGM || (currentUserId != null && d.createdBy === currentUserId),
    [isGM, currentUserId]
  );

  // Clear the drawing preview + selection when the drawing tool is deselected.
  useEffect(() => {
    if (!drawingActive) setDrawPreview(null);
  }, [drawingActive]);

  // Selection lives in the pointer tool; clear it when leaving the pointer tool.
  useEffect(() => {
    if (!pointerActive) setSelectedDrawingId(null);
  }, [pointerActive]);

  const removeDrawing = useCallback(
    (drawingId: string) => {
      applyDrawingRemoveFromCache(qc, campaignId, map.id, drawingId);
      drawingMutations.remove.mutate(drawingId, {
        onSuccess: () => onBroadcast({ type: 'drawing:removed', mapId: map.id, drawingId }),
      });
      setSelectedDrawingId((cur) => (cur === drawingId ? null : cur));
    },
    [qc, campaignId, map.id, drawingMutations.remove, onBroadcast]
  );

  // Whole-stroke erase: delete every modifiable drawing within (eraser size) of
  // the cursor. `erased` tracks ids removed during the current drag so each is
  // removed at most once.
  const eraseAt = useCallback(
    (ix: number, iy: number, erased: Set<string>) => {
      const radius = drawStrokeWidth;
      for (const dr of drawings) {
        if (erased.has(dr.id)) continue;
        if (!canModifyDrawing(dr)) continue;
        if (eraserHits(dr, ix, iy, radius)) {
          erased.add(dr.id);
          removeDrawing(dr.id);
        }
      }
    },
    [drawings, drawStrokeWidth, canModifyDrawing, removeDrawing]
  );

  const clearAllDrawings = useCallback(() => {
    if (!isGM) return;
    applyDrawingsClearToCache(qc, campaignId, map.id);
    setSelectedDrawingId(null);
    drawingMutations.clear.mutate(undefined, {
      onSuccess: () => onBroadcast({ type: 'drawing:cleared', mapId: map.id }),
    });
    setDrawingsPendingClear(false);
  }, [isGM, qc, campaignId, map.id, drawingMutations.clear, onBroadcast]);

  // Keyboard: Delete/Backspace removes the selected drawing (permission-gated);
  // Esc clears the selection. Not GM-gated — players can delete their own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt) {
        const tag = tgt.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tgt.isContentEditable)
          return;
      }
      if (e.key === 'Escape') {
        if (selectedDrawingId) {
          e.preventDefault();
          setSelectedDrawingId(null);
        }
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedDrawingId) return;
      const d = drawings.find((x) => x.id === selectedDrawingId);
      if (!d || !canModifyDrawing(d)) return;
      e.preventDefault();
      removeDrawing(d.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedDrawingId, drawings, canModifyDrawing, removeDrawing]);

  // Commit the in-progress text. Creates a new text, or — when editing — saves
  // the edited content of an existing one.
  const commitTextDraft = useCallback(
    (rawValue: string) => {
      if (!draftActiveRef.current) return;
      draftActiveRef.current = false;
      const draft = textDraft;
      setTextDraft(null);
      setTextDraftValue('');
      const value = rawValue.trim();
      if (!draft) return;

      if (draft.editingId) {
        // Empty edit → leave the original unchanged.
        if (!value) return;
        const existing = texts.find((t) => t.id === draft.editingId);
        if (existing)
          applyTextUpdateToCache(qc, campaignId, map.id, {
            ...existing,
            text: value,
            color: textColor,
            fontSize: textFontSize,
          });
        textMutations.update.mutate(
          { textId: draft.editingId, text: value, color: textColor, fontSize: textFontSize },
          {
            onSuccess: (res) => {
              applyTextUpdateToCache(qc, campaignId, map.id, res.text);
              onBroadcast({ type: 'text:updated', mapId: map.id, text: res.text });
            },
          }
        );
        return;
      }

      if (!value) return;
      textMutations.create.mutate(
        { x: draft.x, y: draft.y, text: value, color: textColor, fontSize: textFontSize },
        {
          onSuccess: (res) => {
            applyTextAddToCache(qc, campaignId, map.id, res.text);
            onBroadcast({ type: 'text:added', mapId: map.id, text: res.text });
          },
        }
      );
    },
    [
      textDraft,
      texts,
      textColor,
      textFontSize,
      textMutations.create,
      textMutations.update,
      qc,
      campaignId,
      map.id,
      onBroadcast,
    ]
  );

  const removeText = useCallback(
    (textId: string) => {
      applyTextRemoveFromCache(qc, campaignId, map.id, textId);
      textMutations.remove.mutate(textId, {
        onSuccess: () => onBroadcast({ type: 'text:removed', mapId: map.id, textId }),
      });
      setSelectedTextId((cur) => (cur === textId ? null : cur));
    },
    [qc, campaignId, map.id, textMutations.remove, onBroadcast]
  );

  // Keyboard: Delete/Backspace removes the selected text (permission-gated);
  // Esc clears the selection. Not GM-gated — players can delete their own text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt) {
        const tag = tgt.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tgt.isContentEditable)
          return;
      }
      if (e.key === 'Escape') {
        if (selectedTextId) {
          e.preventDefault();
          setSelectedTextId(null);
        }
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedTextId) return;
      const t = texts.find((x) => x.id === selectedTextId);
      if (!t || !canModifyText(t)) return;
      e.preventDefault();
      removeText(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTextId, texts, canModifyText, removeText]);

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

  const clearSelection = useCallback(() => {
    setSelectedTokenIds((cur) => (cur.size === 0 ? cur : new Set()));
    setContextMenu(null);
  }, []);

  const selectToken = useCallback((id: string, additive: boolean) => {
    setContextMenu(null);
    setSelectedTokenIds((cur) => {
      if (!additive) return new Set([id]);
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleLayerVisibility = useCallback((id: MapLayerId) => {
    setHiddenLayers((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Observe container size.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Transform math.
  const fitScale =
    containerSize.width === 0 || map.imageWidth === 0
      ? 1
      : Math.min(containerSize.width / map.imageWidth, containerSize.height / map.imageHeight);
  const effectiveScale = fitScale * viewport.zoom;
  const displayedImageWidth = map.imageWidth * effectiveScale;
  const displayedImageHeight = map.imageHeight * effectiveScale;
  const imageOffsetX = (containerSize.width - displayedImageWidth) / 2 + viewport.panX;
  const imageOffsetY = (containerSize.height - displayedImageHeight) / 2 + viewport.panY;

  const domToImage = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!containerRef.current || effectiveScale <= 0) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      return {
        x: (localX - imageOffsetX) / effectiveScale,
        y: (localY - imageOffsetY) / effectiveScale,
      };
    },
    [effectiveScale, imageOffsetX, imageOffsetY]
  );

  // -------------------------------------------------------------------------
  // Zoom + pan
  // -------------------------------------------------------------------------

  const zoomAround = useCallback(
    (focalX: number, focalY: number, nextZoom: number) => {
      setViewport((vp) => {
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
        if (clampedZoom === vp.zoom) return vp;
        const oldEffective = fitScale * vp.zoom;
        const oldOffsetX = (containerSize.width - map.imageWidth * oldEffective) / 2 + vp.panX;
        const oldOffsetY = (containerSize.height - map.imageHeight * oldEffective) / 2 + vp.panY;
        const imgX = (focalX - oldOffsetX) / oldEffective;
        const imgY = (focalY - oldOffsetY) / oldEffective;
        const newEffective = fitScale * clampedZoom;
        const newOffsetX = focalX - imgX * newEffective;
        const newOffsetY = focalY - imgY * newEffective;
        const newPanX = newOffsetX - (containerSize.width - map.imageWidth * newEffective) / 2;
        const newPanY = newOffsetY - (containerSize.height - map.imageHeight * newEffective) / 2;
        return { zoom: clampedZoom, panX: newPanX, panY: newPanY };
      });
    },
    [fitScale, containerSize.width, containerSize.height, map.imageWidth, map.imageHeight]
  );

  // Non-passive wheel listener so we can preventDefault and stop the modal/
  // page from scrolling under the cursor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;
      const px =
        e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
      const factor = Math.exp(-px * 0.0017);
      zoomAround(focalX, focalY, viewportRef.current.zoom * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // -------------------------------------------------------------------------
  // Pointer drag — either pans the viewport (drag on background) or moves a
  // token (drag started on a token). The MapToken component reports drag
  // intent via `onBeginTokenDrag`.
  // -------------------------------------------------------------------------

  type DragState =
    | { mode: 'idle' }
    | { mode: 'pan'; startClientX: number; startClientY: number; startVp: Viewport }
    | {
        mode: 'token';
        tokenId: string;
        startClientX: number;
        startClientY: number;
        startTokenX: number;
        startTokenY: number;
        lastBroadcastAt: number;
      }
    | {
        mode: 'text';
        textId: string;
        startClientX: number;
        startClientY: number;
        startX: number;
        startY: number;
        lastBroadcastAt: number;
        moved: boolean;
      }
    | {
        mode: 'panel';
        startClientX: number;
        startClientY: number;
        startX: number;
        startY: number;
      }
    | {
        mode: 'draw';
        kind: 'pencil';
        /** Flattened map-local points captured so far. */
        points: number[];
        lastX: number;
        lastY: number;
      }
    | {
        mode: 'draw';
        kind: 'rect' | 'ellipse';
        startX: number;
        startY: number;
        curX: number;
        curY: number;
      }
    | { mode: 'erase'; erased: Set<string> }
    | {
        mode: 'resize';
        drawingId: string;
        kind: 'pencil' | 'rect' | 'ellipse';
        startClientX: number;
        startClientY: number;
        /** Original bounding box (map-local pixels). */
        bx: number;
        by: number;
        bw: number;
        bh: number;
        /** Original pencil points, for proportional scaling. */
        startPoints: number[];
      };
  const dragRef = useRef<DragState>({ mode: 'idle' });
  const [dragMode, setDragMode] = useState<
    'idle' | 'pan' | 'token' | 'text' | 'panel' | 'draw' | 'erase' | 'resize'
  >('idle');

  const onPanPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Ruler tool: a background click drops/relocates the measurement anchor
    // (clicks on tokens are handled by MapToken). No pan/select while measuring.
    if (rulerActive) {
      const img = domToImage(e.clientX, e.clientY);
      if (img) {
        const p = { x: clamp(img.x, 0, map.imageWidth), y: clamp(img.y, 0, map.imageHeight) };
        const shift = e.shiftKey;
        setMeasurePoints((pts) => {
          // Shift+click appends a waypoint and keeps drawing; a plain click
          // starts (or restarts) a single-anchor measurement.
          if (shift && pts.length > 0) {
            setMeasureCursor(p);
            return [...pts, { kind: 'point', ...p }];
          }
          setMeasureCursor(p);
          return [{ kind: 'point', ...p }];
        });
      }
      return;
    }
    // Text tool: a background click writes text. If a draft is already open,
    // this click just commits it (via the input's blur) and opens nothing new;
    // clicking an existing text (handled there) selects it instead.
    if (textActive) {
      if (textDraft) return;
      const img = domToImage(e.clientX, e.clientY);
      if (img) {
        openTextDraft({ x: clamp(img.x, 0, map.imageWidth), y: clamp(img.y, 0, map.imageHeight) });
      }
      return;
    }
    // Drawing tool: a press on the map begins a stroke / shape / erase.
    if (drawingActive) {
      const img = domToImage(e.clientX, e.clientY);
      if (!img) return;
      const ix = clamp(img.x, 0, map.imageWidth);
      const iy = clamp(img.y, 0, map.imageHeight);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (drawShape === 'eraser') {
        const erased = new Set<string>();
        dragRef.current = { mode: 'erase', erased };
        setDragMode('erase');
        eraseAt(ix, iy, erased);
        return;
      }
      if (drawShape === 'pencil') {
        dragRef.current = { mode: 'draw', kind: 'pencil', points: [ix, iy], lastX: ix, lastY: iy };
        setDrawPreview({
          kind: 'pencil',
          color: drawColor,
          strokeWidth: drawStrokeWidth,
          filled: false,
          points: [ix, iy],
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });
        setDragMode('draw');
        return;
      }
      const kind = drawShape === 'square' ? 'rect' : 'ellipse';
      dragRef.current = { mode: 'draw', kind, startX: ix, startY: iy, curX: ix, curY: iy };
      setDrawPreview({
        kind,
        color: drawColor,
        strokeWidth: drawStrokeWidth,
        filled: drawFilled,
        points: [],
        x: ix,
        y: iy,
        width: 0,
        height: 0,
      });
      setDragMode('draw');
      return;
    }
    // Background click deselects any selected token/drawing + closes menus.
    setSelectedDrawingId(null);
    clearSelection();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startVp: viewport,
    };
    setDragMode('pan');
  };

  const beginTokenDrag = useCallback(
    (token: MapTokenData, e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode: 'token',
        tokenId: token.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTokenX: token.x,
        startTokenY: token.y,
        lastBroadcastAt: 0,
      };
      setDragMode('token');
    },
    []
  );

  // Begin dragging a text (text tool, own/GM only). A press that doesn't move
  // is just a selection; movement past a small threshold relocates the text.
  const beginTextDrag = useCallback(
    (t: MapTextData, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      // Note: no preventDefault — it can suppress the click/dblclick used for
      // editing. The container's `select-none` already blocks text selection.
      e.stopPropagation();
      cancelTextDraft();
      clearSelection();
      setSelectedTextId(t.id);
      // Sync the panel (brush) to the selected text so its size/color show and
      // any change made while it's selected applies to it.
      setTextColor(t.color);
      setTextFontSize(t.fontSize);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode: 'text',
        textId: t.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: t.x,
        startY: t.y,
        lastBroadcastAt: 0,
        moved: false,
      };
      setDragMode('text');
    },
    [cancelTextDraft, clearSelection]
  );

  // Begin dragging the settings panel by its header (clamped on move).
  const beginPanelDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode: 'panel',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: panelPos.x,
        startY: panelPos.y,
      };
      setDragMode('panel');
    },
    [panelPos]
  );

  // Begin resizing the selected drawing from its corner handle (own/GM only).
  const beginDrawingResize = useCallback(
    (d: MapDrawingData, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      if (!canModifyDrawing(d)) return;
      e.preventDefault();
      e.stopPropagation();
      const bbox = drawingBBox(d);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode: 'resize',
        drawingId: d.id,
        kind: d.kind,
        startClientX: e.clientX,
        startClientY: e.clientY,
        bx: bbox.x,
        by: bbox.y,
        bw: bbox.width,
        bh: bbox.height,
        startPoints: d.kind === 'pencil' ? [...d.points] : [],
      };
      setDragMode('resize');
    },
    [canModifyDrawing]
  );

  // Clamp a panel position so the whole panel stays inside the workspace,
  // using its real measured size (its height varies with content).
  const clampPanelPos = useCallback(
    (pos: { x: number; y: number }) => {
      const pw = panelRef.current?.offsetWidth ?? 240;
      const ph = panelRef.current?.offsetHeight ?? 240;
      const maxX = Math.max(0, containerSize.width - pw);
      const maxY = Math.max(0, containerSize.height - ph);
      return { x: clamp(pos.x, 0, maxX), y: clamp(pos.y, 0, maxY) };
    },
    [containerSize.width, containerSize.height]
  );

  // Keep the panel on-screen when the workspace resizes (inspector toggles,
  // window resize, etc.) — otherwise a panel dragged toward an edge would be
  // clipped away and look "lost".
  useEffect(() => {
    if (!textActive && !drawingActive) return;
    setPanelPos((pos) => {
      const c = clampPanelPos(pos);
      return c.x === pos.x && c.y === pos.y ? pos : c;
    });
  }, [textActive, drawingActive, containerSize.width, containerSize.height, clampPanelPos]);

  // Update both the brush and (if a text is selected) that text on the map, so
  // changing size/color visibly resizes/recolors the selected text. Persists +
  // broadcasts. The server is the authority on whether the change is allowed.
  const applyTextColor = useCallback(
    (next: string) => {
      setTextColor(next);
      const t = selectedTextId ? texts.find((x) => x.id === selectedTextId) : undefined;
      if (!t || !canModifyText(t)) return;
      applyTextUpdateToCache(qc, campaignId, map.id, { ...t, color: next });
      textMutations.update.mutate(
        { textId: t.id, color: next },
        {
          onSuccess: (res) => {
            applyTextUpdateToCache(qc, campaignId, map.id, res.text);
            onBroadcast({ type: 'text:updated', mapId: map.id, text: res.text });
          },
        }
      );
    },
    [
      selectedTextId,
      texts,
      canModifyText,
      qc,
      campaignId,
      map.id,
      textMutations.update,
      onBroadcast,
    ]
  );

  const applyTextFontSize = useCallback(
    (next: number) => {
      setTextFontSize(next);
      const t = selectedTextId ? texts.find((x) => x.id === selectedTextId) : undefined;
      if (!t || !canModifyText(t)) return;
      applyTextUpdateToCache(qc, campaignId, map.id, { ...t, fontSize: next });
      textMutations.update.mutate(
        { textId: t.id, fontSize: next },
        {
          onSuccess: (res) => {
            applyTextUpdateToCache(qc, campaignId, map.id, res.text);
            onBroadcast({ type: 'text:updated', mapId: map.id, text: res.text });
          },
        }
      );
    },
    [
      selectedTextId,
      texts,
      canModifyText,
      qc,
      campaignId,
      map.id,
      textMutations.update,
      onBroadcast,
    ]
  );

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Ruler tool: the live endpoint follows the cursor until a fixed end is set.
    if (rulerActive) {
      // The live endpoint follows the cursor while a segment is open (cursor
      // non-null); a completed token→token measurement is frozen (cursor null).
      if (measurePoints.length > 0 && measureCursor !== null) {
        const img = domToImage(e.clientX, e.clientY);
        if (img) setMeasureCursor({ x: img.x, y: img.y });
      }
      return;
    }
    const d = dragRef.current;
    if (d.mode === 'idle') return;
    if (d.mode === 'pan') {
      setViewport({
        ...d.startVp,
        panX: d.startVp.panX + (e.clientX - d.startClientX),
        panY: d.startVp.panY + (e.clientY - d.startClientY),
      });
    } else if (d.mode === 'token') {
      const dxImage = (e.clientX - d.startClientX) / effectiveScale;
      const dyImage = (e.clientY - d.startClientY) / effectiveScale;
      const nx = clamp(d.startTokenX + dxImage, 0, map.imageWidth);
      const ny = clamp(d.startTokenY + dyImage, 0, map.imageHeight);
      // Optimistic local update.
      applyTokenMoveToCache(qc, campaignId, map.id, d.tokenId, nx, ny);
      // Throttled broadcast for smooth remote views.
      const now = Date.now();
      if (now - d.lastBroadcastAt >= MOVE_BROADCAST_INTERVAL_MS) {
        d.lastBroadcastAt = now;
        onBroadcast({
          type: 'token:moved',
          mapId: map.id,
          tokenId: d.tokenId,
          x: nx,
          y: ny,
        });
      }
    } else if (d.mode === 'text') {
      const dxImage = (e.clientX - d.startClientX) / effectiveScale;
      const dyImage = (e.clientY - d.startClientY) / effectiveScale;
      const nx = clamp(d.startX + dxImage, 0, map.imageWidth);
      const ny = clamp(d.startY + dyImage, 0, map.imageHeight);
      if (Math.abs(dxImage) > 1 || Math.abs(dyImage) > 1) d.moved = true;
      applyTextMoveToCache(qc, campaignId, map.id, d.textId, nx, ny);
      const now = Date.now();
      if (now - d.lastBroadcastAt >= MOVE_BROADCAST_INTERVAL_MS) {
        d.lastBroadcastAt = now;
        onBroadcast({ type: 'text:moved', mapId: map.id, textId: d.textId, x: nx, y: ny });
      }
    } else if (d.mode === 'panel') {
      // Clamp within the workspace so the panel stays fully visible.
      setPanelPos(
        clampPanelPos({
          x: d.startX + (e.clientX - d.startClientX),
          y: d.startY + (e.clientY - d.startClientY),
        })
      );
    } else if (d.mode === 'draw' && d.kind === 'pencil') {
      const img = domToImage(e.clientX, e.clientY);
      if (!img) return;
      const ix = clamp(img.x, 0, map.imageWidth);
      const iy = clamp(img.y, 0, map.imageHeight);
      // Throttle capture (only on meaningful movement) and cap the point count.
      if (
        Math.hypot(ix - d.lastX, iy - d.lastY) >= 2 &&
        d.points.length < MAX_DRAWING_POINT_VALUES
      ) {
        d.points.push(ix, iy);
        d.lastX = ix;
        d.lastY = iy;
        setDrawPreview((prev) => (prev ? { ...prev, points: [...d.points] } : prev));
      }
    } else if (d.mode === 'draw') {
      // rect / ellipse — the drag sets the bounding box.
      const img = domToImage(e.clientX, e.clientY);
      if (!img) return;
      d.curX = clamp(img.x, 0, map.imageWidth);
      d.curY = clamp(img.y, 0, map.imageHeight);
      setDrawPreview((prev) =>
        prev
          ? {
              ...prev,
              x: Math.min(d.startX, d.curX),
              y: Math.min(d.startY, d.curY),
              width: Math.abs(d.curX - d.startX),
              height: Math.abs(d.curY - d.startY),
            }
          : prev
      );
    } else if (d.mode === 'erase') {
      const img = domToImage(e.clientX, e.clientY);
      if (img) eraseAt(clamp(img.x, 0, map.imageWidth), clamp(img.y, 0, map.imageHeight), d.erased);
    } else if (d.mode === 'resize') {
      const existing = drawings.find((x) => x.id === d.drawingId);
      if (!existing) return;
      const { points, x, y, width, height } = resizedGeometry(
        d,
        e.clientX,
        e.clientY,
        effectiveScale
      );
      applyDrawingUpdateToCache(qc, campaignId, map.id, {
        ...existing,
        points,
        x,
        y,
        width,
        height,
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d.mode === 'token') {
      const dxImage = (e.clientX - d.startClientX) / effectiveScale;
      const dyImage = (e.clientY - d.startClientY) / effectiveScale;
      const nx = clamp(d.startTokenX + dxImage, 0, map.imageWidth);
      const ny = clamp(d.startTokenY + dyImage, 0, map.imageHeight);
      // Persist and broadcast the final position.
      mutations.move.mutate(
        { tokenId: d.tokenId, x: nx, y: ny },
        {
          onSuccess: () => {
            onBroadcast({
              type: 'token:moved',
              mapId: map.id,
              tokenId: d.tokenId,
              x: nx,
              y: ny,
              final: true,
            });
          },
        }
      );
    } else if (d.mode === 'text') {
      if (d.moved) {
        const dxImage = (e.clientX - d.startClientX) / effectiveScale;
        const dyImage = (e.clientY - d.startClientY) / effectiveScale;
        const nx = clamp(d.startX + dxImage, 0, map.imageWidth);
        const ny = clamp(d.startY + dyImage, 0, map.imageHeight);
        applyTextMoveToCache(qc, campaignId, map.id, d.textId, nx, ny);
        textMutations.update.mutate(
          { textId: d.textId, x: nx, y: ny },
          {
            onSuccess: () =>
              onBroadcast({
                type: 'text:moved',
                mapId: map.id,
                textId: d.textId,
                x: nx,
                y: ny,
                final: true,
              }),
          }
        );
      }
    } else if (d.mode === 'draw' && d.kind === 'pencil') {
      const pts = d.points;
      setDrawPreview(null);
      if (pts.length >= 4) {
        drawingMutations.create.mutate(
          {
            kind: 'pencil',
            color: drawColor,
            strokeWidth: drawStrokeWidth,
            filled: false,
            points: pts,
          },
          {
            onSuccess: (res) => {
              applyDrawingAddToCache(qc, campaignId, map.id, res.drawing);
              onBroadcast({ type: 'drawing:added', mapId: map.id, drawing: res.drawing });
            },
          }
        );
      }
    } else if (d.mode === 'draw') {
      const x = Math.min(d.startX, d.curX);
      const y = Math.min(d.startY, d.curY);
      const width = Math.abs(d.curX - d.startX);
      const height = Math.abs(d.curY - d.startY);
      setDrawPreview(null);
      if (width >= MIN_DRAW_SIZE && height >= MIN_DRAW_SIZE) {
        drawingMutations.create.mutate(
          {
            kind: d.kind,
            color: drawColor,
            strokeWidth: drawStrokeWidth,
            filled: drawFilled,
            x,
            y,
            width,
            height,
          },
          {
            onSuccess: (res) => {
              applyDrawingAddToCache(qc, campaignId, map.id, res.drawing);
              onBroadcast({ type: 'drawing:added', mapId: map.id, drawing: res.drawing });
            },
          }
        );
      }
    } else if (d.mode === 'resize') {
      const existing = drawings.find((x) => x.id === d.drawingId);
      const geom = resizedGeometry(d, e.clientX, e.clientY, effectiveScale);
      if (existing) applyDrawingUpdateToCache(qc, campaignId, map.id, { ...existing, ...geom });
      const update =
        d.kind === 'pencil'
          ? { drawingId: d.drawingId, points: geom.points }
          : {
              drawingId: d.drawingId,
              x: geom.x,
              y: geom.y,
              width: geom.width,
              height: geom.height,
            };
      drawingMutations.update.mutate(update, {
        onSuccess: (res) => {
          applyDrawingUpdateToCache(qc, campaignId, map.id, res.drawing);
          onBroadcast({ type: 'drawing:updated', mapId: map.id, drawing: res.drawing });
        },
      });
    }
    dragRef.current = { mode: 'idle' };
    setDragMode('idle');
  };

  // -------------------------------------------------------------------------
  // Drag-and-drop from wiki lists → create a token
  // -------------------------------------------------------------------------

  const [isDragOverMap, setIsDragOverMap] = useState(false);
  // Latest Shift state seen during a drag-over (see handleDragOver/handleDrop).
  const dragShiftRef = useRef(false);
  // Shift-drag of a monster → "place how many?" dialog.
  const [batchPlacement, setBatchPlacement] = useState<{
    sourceDocumentId: string;
    name: string;
  } | null>(null);

  const handleBatchPlace = useCallback(
    (count: number) => {
      if (!isGM || !batchPlacement) return;
      mutations.createBatch.mutate(
        { sourceDocumentId: batchPlacement.sourceDocumentId, count },
        {
          onSuccess: (res) => {
            for (const token of res.tokens) {
              onBroadcast({ type: 'token:added', mapId: map.id, token });
            }
          },
        }
      );
      setBatchPlacement(null);
    },
    [isGM, batchPlacement, mutations.createBatch, onBroadcast, map.id]
  );

  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!isGM) return;
    if (!e.dataTransfer.types.includes('application/x-cartyx-document')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    // Track the Shift state from the continuously-firing dragover (the drop
    // event's modifier flags are unreliable mid-DnD); read it on drop.
    dragShiftRef.current = e.shiftKey;
    setIsDragOverMap(true);
  };

  const handleDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverMap(false);
  };

  const handleDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    setIsDragOverMap(false);
    if (!isGM) return;
    const raw = e.dataTransfer.getData('application/x-cartyx-document');
    if (!raw) return;
    let payload: { collection: string; documentId: string; title?: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      payload.collection !== 'player' &&
      payload.collection !== 'character' &&
      payload.collection !== 'monster'
    )
      return;

    e.preventDefault();
    e.stopPropagation();

    // Shift-dragging a monster opens a "how many?" dialog and scatters that
    // many instances randomly across the map. Shift is used (not Ctrl/Cmd)
    // because macOS treats Control-drag as a secondary click, so its modifier
    // never reaches the web drop event.
    if (payload.collection === 'monster' && (dragShiftRef.current || e.shiftKey)) {
      setBatchPlacement({ sourceDocumentId: payload.documentId, name: payload.title ?? 'monster' });
      return;
    }

    const imageCoord = domToImage(e.clientX, e.clientY);
    if (!imageCoord) return;
    const x = clamp(imageCoord.x, 0, map.imageWidth);
    const y = clamp(imageCoord.y, 0, map.imageHeight);

    mutations.create.mutate(
      {
        sourceCollection: payload.collection as 'player' | 'character' | 'monster',
        sourceDocumentId: payload.documentId,
        x,
        y,
      },
      {
        onSuccess: (res) => {
          if (!res.existed) {
            onBroadcast({ type: 'token:added', mapId: map.id, token: res.token });
          }
        },
      }
    );
  };

  // -------------------------------------------------------------------------
  // Token actions (GM only) — handled inline by passing callbacks.
  // -------------------------------------------------------------------------

  const handleToggleLabel = useCallback(
    (token: MapTokenData) => {
      if (!isGM) return;
      const nextVisible = !token.labelVisible;
      const optimistic: MapTokenData = { ...token, labelVisible: nextVisible };
      applyTokenUpdateToCache(qc, campaignId, map.id, optimistic);
      mutations.update.mutate(
        { tokenId: token.id, labelVisible: nextVisible },
        {
          onSuccess: (res) => {
            onBroadcast({ type: 'token:updated', mapId: map.id, token: res.token });
          },
        }
      );
    },
    [isGM, qc, campaignId, map.id, mutations.update, onBroadcast]
  );

  const handleRemove = useCallback(
    (token: MapTokenData) => {
      if (!isGM) return;
      applyTokenRemoveFromCache(qc, campaignId, map.id, token.id);
      mutations.remove.mutate(token.id, {
        onSuccess: () => {
          onBroadcast({ type: 'token:removed', mapId: map.id, tokenId: token.id });
        },
      });
      setSelectedTokenIds((cur) => {
        if (!cur.has(token.id)) return cur;
        const next = new Set(cur);
        next.delete(token.id);
        return next;
      });
    },
    [isGM, qc, campaignId, map.id, mutations.remove, onBroadcast]
  );

  // Move every selected token to a layer. Public ⇔ GM-private is encoded by
  // `hiddenFromPlayers`, so the move is a plain token update (optimistic +
  // broadcast). No-ops for tokens already on the target layer.
  const moveSelectionToLayer = useCallback(
    (layer: TokenLayerId) => {
      if (!isGM) return;
      const hidden = layer === 'gm-private';
      for (const id of selectedTokenIds) {
        const token = tokens.find((t) => t.id === id);
        if (!token || token.hiddenFromPlayers === hidden) continue;
        const optimistic: MapTokenData = { ...token, hiddenFromPlayers: hidden };
        applyTokenUpdateToCache(qc, campaignId, map.id, optimistic);
        mutations.update.mutate(
          { tokenId: id, hiddenFromPlayers: hidden },
          {
            onSuccess: (res) => {
              onBroadcast({ type: 'token:updated', mapId: map.id, token: res.token });
            },
          }
        );
      }
      setContextMenu(null);
    },
    [isGM, selectedTokenIds, tokens, qc, campaignId, map.id, mutations.update, onBroadcast]
  );

  const handleTokenContextMenu = useCallback(
    (token: MapTokenData, e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isGM) return;
      e.preventDefault();
      e.stopPropagation();
      // Right-clicking a token outside the current selection selects just it.
      setSelectedTokenIds((cur) => (cur.has(token.id) ? cur : new Set([token.id])));
      const rect = containerRef.current?.getBoundingClientRect();
      setContextMenu({
        x: rect ? e.clientX - rect.left : e.clientX,
        y: rect ? e.clientY - rect.top : e.clientY,
      });
    },
    [isGM]
  );

  // Keyboard: Delete/Backspace on a selected token opens confirm; Esc
  // dismisses the confirm or clears the selection.
  // GM-only: players can move their own tokens but can't delete them.
  useEffect(() => {
    if (!isGM) return;
    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in an input/textarea/contenteditable.
      const tgt = e.target as HTMLElement | null;
      if (tgt) {
        const tag = tgt.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tgt.isContentEditable)
          return;
      }
      if (e.key === 'Escape') {
        if (contextMenu) {
          e.preventDefault();
          setContextMenu(null);
        } else if (tokensPendingDelete) {
          e.preventDefault();
          setTokensPendingDelete(null);
        } else if (selectedTokenIds.size > 0) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (tokensPendingDelete) return; // already confirming
      if (selectedTokenIds.size === 0) return;
      const pending = tokens.filter((t) => selectedTokenIds.has(t.id));
      if (pending.length === 0) return;
      e.preventDefault();
      setTokensPendingDelete(pending);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isGM, selectedTokenIds, tokens, tokensPendingDelete, contextMenu, clearSelection]);

  const visibleTokens = useMemo(() => {
    const base = isGM ? tokens : tokens.filter((t) => !t.hiddenFromPlayers);
    // Hide layers the GM has toggled off (no-op for players: empty set), then
    // stack by layer so public tokens render above GM-private ones.
    return base
      .filter((t) => !hiddenLayers.has(tokenLayerId(t)))
      .sort((a, b) => tokenLayerRenderOrder(a) - tokenLayerRenderOrder(b));
  }, [tokens, isGM, hiddenLayers]);

  const tokenCounts = useMemo<Record<TokenLayerId, number>>(() => {
    let publicCount = 0;
    let privateCount = 0;
    for (const t of tokens) {
      if (t.hiddenFromPlayers) privateCount++;
      else publicCount++;
    }
    return { public: publicCount, 'gm-private': privateCount };
  }, [tokens]);

  const canMoveToken = useCallback(
    (token: MapTokenData) =>
      isGM || (token.ownerUserId != null && token.ownerUserId === currentUserId),
    [isGM, currentUserId]
  );

  // Resolve the polyline measurement to DOM coordinates. Each segment carries
  // its own feet distance derived from the map's calibrated scale (never
  // hard-coded). The live cursor, when set, is the final (open) vertex.
  const measurement = useMemo(() => {
    if (!rulerActive || measurePoints.length === 0) return null;
    const resolve = (p: MeasurePoint): { x: number; y: number } | null => {
      if (p.kind === 'point') return { x: p.x, y: p.y };
      const t = tokens.find((tk) => tk.id === p.tokenId);
      return t ? { x: t.x, y: t.y } : null;
    };
    const committedImg = measurePoints
      .map(resolve)
      .filter((p): p is { x: number; y: number } => p !== null);
    if (committedImg.length === 0) return null;

    const toDom = (p: { x: number; y: number }) => ({
      x: imageOffsetX + p.x * effectiveScale,
      y: imageOffsetY + p.y * effectiveScale,
    });
    const committed = committedImg.map(toDom);
    // The full vertex list adds the live cursor as the last point when open.
    const imgVerts = measureCursor ? [...committedImg, measureCursor] : committedImg;
    const domVerts = imgVerts.map(toDom);

    const perSquare = map.scale.pixelsPerSquare || 1;
    const segments = [];
    for (let i = 0; i < imgVerts.length - 1; i++) {
      const a = imgVerts[i]!;
      const b = imgVerts[i + 1]!;
      const pixelDist = Math.hypot(b.x - a.x, b.y - a.y);
      const feet = Math.round((pixelDist / perSquare) * map.scale.feetPerSquare);
      const da = domVerts[i]!;
      const db = domVerts[i + 1]!;
      segments.push({
        a: da,
        b: db,
        feet,
        mid: { x: (da.x + db.x) / 2, y: (da.y + db.y) / 2 },
      });
    }
    return {
      // Anchor (first committed vertex) and the intermediate waypoints.
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
    map.scale.pixelsPerSquare,
    map.scale.feetPerSquare,
    imageOffsetX,
    imageOffsetY,
    effectiveScale,
  ]);

  const cursorClass =
    rulerActive || drawingActive
      ? 'cursor-crosshair'
      : textActive
        ? 'cursor-text'
        : dragMode === 'pan'
          ? 'cursor-grabbing'
          : 'cursor-grab';

  // The selected drawing (pointer tool) + its DOM bounding box, for the
  // selection outline + corner resize handle.
  const selectedDrawing =
    pointerActive && selectedDrawingId
      ? (drawings.find((d) => d.id === selectedDrawingId) ?? null)
      : null;
  const selectionBox = selectedDrawing
    ? (() => {
        const b = drawingBBox(selectedDrawing);
        return {
          left: imageOffsetX + b.x * effectiveScale,
          top: imageOffsetY + b.y * effectiveScale,
          width: b.width * effectiveScale,
          height: b.height * effectiveScale,
        };
      })()
    : null;

  // Render one drawing (committed or live preview) as an SVG element. Geometry
  // is map-local; convert to DOM here at *effectiveScale.
  const renderDrawing = (
    d: {
      id?: string;
      kind: 'pencil' | 'rect' | 'ellipse';
      color: string;
      strokeWidth: number;
      filled: boolean;
      points: number[];
      x: number;
      y: number;
      width: number;
      height: number;
    },
    opts: { interactive: boolean; isPreview?: boolean }
  ) => {
    const sw = Math.max(1, d.strokeWidth * effectiveScale);
    const fill = d.filled ? d.color : 'none';
    const stroke = d.filled ? 'none' : d.color;
    const pointerEvents = opts.interactive ? (d.kind === 'pencil' ? 'stroke' : 'all') : 'none';
    const common = {
      'data-testid': opts.isPreview ? undefined : 'map-drawing',
      'data-drawing-id': d.id,
      'data-drawing-kind': d.kind,
      'data-filled': String(d.filled),
      onPointerDown: opts.interactive
        ? (e: ReactPointerEvent<SVGElement>) => {
            e.stopPropagation();
            if (d.id) setSelectedDrawingId(d.id);
          }
        : undefined,
      style: { pointerEvents } as const,
    };
    if (d.kind === 'pencil') {
      const pts: string[] = [];
      for (let i = 0; i + 1 < d.points.length; i += 2) {
        pts.push(
          `${imageOffsetX + d.points[i]! * effectiveScale},${imageOffsetY + d.points[i + 1]! * effectiveScale}`
        );
      }
      return (
        <polyline
          key={d.id ?? 'preview'}
          {...common}
          points={pts.join(' ')}
          fill="none"
          stroke={d.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    const dx = imageOffsetX + d.x * effectiveScale;
    const dy = imageOffsetY + d.y * effectiveScale;
    const dw = d.width * effectiveScale;
    const dh = d.height * effectiveScale;
    if (d.kind === 'rect') {
      return (
        <rect
          key={d.id ?? 'preview'}
          {...common}
          x={dx}
          y={dy}
          width={dw}
          height={dh}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    }
    return (
      <ellipse
        key={d.id ?? 'preview'}
        {...common}
        cx={dx + dw / 2}
        cy={dy + dh / 2}
        rx={dw / 2}
        ry={dh / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPanPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        // Ruler tool: a double-click resets the measurement — the tool stops
        // drawing until the next click (also clears a multi-point polyline).
        if (!rulerActive) return;
        e.preventDefault();
        resetMeasurement();
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        'absolute inset-0 touch-none select-none overflow-hidden bg-black/60',
        cursorClass,
        isDragOverMap ? 'ring-2 ring-inset ring-emerald-500/50' : '',
      ].join(' ')}
      data-testid="active-map-stage"
      data-map-id={map.id}
    >
      {!hiddenLayers.has('map') && (
        <img
          src={map.imageUrl}
          alt={map.name}
          draggable={false}
          className="pointer-events-none absolute"
          style={{
            width: displayedImageWidth,
            height: displayedImageHeight,
            maxWidth: 'none',
            maxHeight: 'none',
            left: imageOffsetX,
            top: imageOffsetY,
            imageRendering: viewport.zoom > 2 ? 'pixelated' : 'auto',
          }}
        />
      )}

      {/* Grid overlay — aligned to the map's calibrated square size. */}
      {showGrid && hasGrid && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: imageOffsetX,
            top: imageOffsetY,
            width: displayedImageWidth,
            height: displayedImageHeight,
            backgroundImage: `linear-gradient(to right, ${map.gridOverlay.color} 1px, transparent 1px), linear-gradient(to bottom, ${map.gridOverlay.color} 1px, transparent 1px)`,
            backgroundSize: `${map.scale.pixelsPerSquare * effectiveScale}px ${map.scale.pixelsPerSquare * effectiveScale}px`,
          }}
          data-testid="map-grid-overlay"
        />
      )}

      {/* Drawing layer (shared). One SVG overlay above the map/grid. The SVG
          itself never captures events; individual shapes are interactive only
          while the pointer tool is active (for selection), so tokens are never
          blocked. New strokes are drawn on the stage background (drawing tool)
          and erasing is hit-tested against geometry. */}
      {showDrawings && (
        <svg
          className="pointer-events-none absolute inset-0 z-20 h-full w-full"
          data-testid="map-drawing-layer"
          aria-hidden="true"
        >
          {drawings.map((d) => renderDrawing(d, { interactive: pointerActive }))}
          {drawPreview && renderDrawing(drawPreview, { interactive: false, isPreview: true })}
        </svg>
      )}

      {/* Selected drawing — bounding box + corner resize handle (own/GM only). */}
      {selectedDrawing && selectionBox && (
        <>
          <div
            aria-hidden="true"
            data-testid="drawing-selection"
            className="pointer-events-none absolute z-30 rounded-sm outline outline-2 outline-offset-2 outline-[#60A5FA]"
            style={{
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
          {canModifyDrawing(selectedDrawing) && (
            <button
              type="button"
              aria-label="Resize drawing"
              data-testid="drawing-resize-handle"
              onPointerDown={(e) => beginDrawingResize(selectedDrawing, e)}
              className="absolute z-40 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border border-white bg-[#60A5FA]"
              style={{
                left: selectionBox.left + selectionBox.width,
                top: selectionBox.top + selectionBox.height,
              }}
            />
          )}
        </>
      )}

      {/* Tokens */}
      {visibleTokens.map((token) => (
        <MapToken
          key={token.id}
          token={token}
          imageOffsetX={imageOffsetX}
          imageOffsetY={imageOffsetY}
          effectiveScale={effectiveScale}
          pixelsPerSquare={map.scale.pixelsPerSquare}
          canMove={canMoveToken(token)}
          isGM={isGM}
          isSelected={selectedTokenIds.has(token.id)}
          rulerActive={rulerActive}
          onMeasure={(shiftKey) => pickTokenForMeasure(token, shiftKey)}
          onSelect={(additive) => selectToken(token.id, additive)}
          onBeginDrag={(e) => beginTokenDrag(token, e)}
          onContextMenu={(e) => handleTokenContextMenu(token, e)}
          onToggleLabel={() => handleToggleLabel(token)}
          onRemove={() => handleRemove(token)}
        />
      ))}

      {/* Map text layer (shared). Interactive (hover-highlight, drag to move,
          double-click to edit, select + Delete) only while the text tool is
          active AND the viewer may modify that text; otherwise display-only so
          it never blocks panning/tokens. The text being edited is hidden behind
          its editor. */}
      {showText &&
        texts.map((t) => {
          if (textDraft?.editingId === t.id) return null;
          const selected = selectedTextId === t.id;
          const interactive = textActive && canModifyText(t);
          return (
            <button
              key={t.id}
              type="button"
              data-testid="map-text"
              data-text-id={t.id}
              onPointerDown={(e) => {
                if (!interactive) return;
                beginTextDrag(t, e);
              }}
              onDoubleClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                e.preventDefault();
                openTextEdit(t);
              }}
              className={[
                'absolute z-30 m-0 max-w-[40vw] whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-left font-sans font-semibold leading-tight',
                interactive
                  ? 'cursor-move outline-offset-2 hover:outline hover:outline-2 hover:outline-[#60A5FA]/70'
                  : 'pointer-events-none',
                selected ? 'rounded outline outline-2 outline-offset-2 outline-[#60A5FA]' : '',
              ].join(' ')}
              style={{
                left: imageOffsetX + t.x * effectiveScale,
                top: imageOffsetY + t.y * effectiveScale,
                color: t.color,
                fontSize: t.fontSize * effectiveScale,
                textShadow:
                  '0 1px 2px rgba(0,0,0,0.9), 0 -1px 2px rgba(0,0,0,0.9), 1px 0 2px rgba(0,0,0,0.9), -1px 0 2px rgba(0,0,0,0.9)',
              }}
            >
              {t.text}
            </button>
          );
        })}

      {/* In-progress text editor (text tool). */}
      {textActive && textDraft && (
        <input
          ref={textInputRef}
          data-testid="map-text-input"
          value={textDraftValue}
          onChange={(e) => setTextDraftValue(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTextDraft(textDraftValue);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelTextDraft();
            }
          }}
          onBlur={(e) => commitTextDraft(e.currentTarget.value)}
          placeholder="Type…"
          className="absolute z-40 rounded border border-[#60A5FA] bg-black/70 px-1 font-sans font-semibold outline-none"
          style={{
            left: imageOffsetX + textDraft.x * effectiveScale,
            top: imageOffsetY + textDraft.y * effectiveScale,
            color: textColor,
            fontSize: textFontSize * effectiveScale,
            minWidth: 90,
          }}
        />
      )}

      {/* Measurement (ruler) overlay — polyline + endpoints + per-segment feet. */}
      {measurement && (
        <>
          <svg
            className="pointer-events-none absolute inset-0 z-30 h-full w-full"
            data-testid="ruler-line"
            aria-hidden="true"
          >
            {measurement.segments.map((seg) => {
              const key = `${seg.a.x},${seg.a.y}-${seg.b.x},${seg.b.y}`;
              return (
                <g key={key}>
                  {/* Dark halo underlay so the line reads on any map background. */}
                  <line
                    x1={seg.a.x}
                    y1={seg.a.y}
                    x2={seg.b.x}
                    y2={seg.b.y}
                    stroke="#000000"
                    strokeOpacity={0.6}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray="6 4"
                  />
                  <line
                    x1={seg.a.x}
                    y1={seg.a.y}
                    x2={seg.b.x}
                    y2={seg.b.y}
                    stroke={rulerColor}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray="6 4"
                    data-testid="ruler-line-stroke"
                  />
                </g>
              );
            })}
            {/* Intermediate waypoints. */}
            {measurement.waypoints.map((wp) => (
              <circle
                key={`${wp.x},${wp.y}`}
                cx={wp.x}
                cy={wp.y}
                r={5}
                fill={rulerColor}
                stroke="#000000"
                strokeOpacity={0.7}
                strokeWidth={2}
                data-testid="ruler-waypoint"
              />
            ))}
            {/* Live / final endpoint. */}
            <circle
              cx={measurement.end.x}
              cy={measurement.end.y}
              r={5}
              fill={rulerColor}
              stroke="#000000"
              strokeOpacity={0.7}
              strokeWidth={2}
            />
            {/* Anchor (drawn last so it sits above an overlapping waypoint). */}
            <circle
              cx={measurement.anchor.x}
              cy={measurement.anchor.y}
              r={7}
              fill={rulerColor}
              fillOpacity={0.95}
              stroke="#000000"
              strokeOpacity={0.7}
              strokeWidth={2}
              data-testid="ruler-anchor"
            />
          </svg>
          {measurement.segments.map((seg) => (
            <div
              key={`${seg.mid.x},${seg.mid.y}`}
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border-2 bg-black/90 px-2.5 py-1 font-mono text-base font-bold text-white shadow-lg"
              style={{
                left: seg.mid.x,
                top: seg.mid.y,
                borderColor: rulerColor,
              }}
              data-testid="ruler-distance"
            >
              {seg.feet} ft
            </div>
          ))}
        </>
      )}

      {/* Delete-confirmation dialog */}
      {tokensPendingDelete && tokensPendingDelete.length > 0 && (
        <div
          role="presentation"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
        >
          <div
            role="alertdialog"
            aria-labelledby="token-delete-title"
            className="w-full max-w-sm rounded-lg border border-white/10 bg-[#0D1117] p-4 shadow-2xl"
          >
            <h2
              id="token-delete-title"
              className="font-sans text-sm font-bold uppercase tracking-widest text-rose-400"
            >
              {tokensPendingDelete.length === 1 ? 'Remove token?' : 'Remove tokens?'}
            </h2>
            <p className="font-sans mt-2 text-xs text-slate-300">
              Remove{' '}
              <span className="font-semibold text-white">
                {tokensPendingDelete.length === 1
                  ? tokensPendingDelete[0].label || 'this token'
                  : `${tokensPendingDelete.length} tokens`}
              </span>{' '}
              from the map? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTokensPendingDelete(null)}
                className="rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 font-sans text-xs font-semibold text-slate-300 hover:bg-white/[0.07]"
              >
                Cancel
              </button>
              <button
                type="button"
                ref={(el) => {
                  // Focus the destructive primary so Enter immediately
                  // confirms removal; the no-autofocus lint rule doesn't
                  // catch ref-based focus, and a modal that pops up in
                  // direct response to Delete needs keyboard continuity.
                  if (el) el.focus();
                }}
                onClick={() => {
                  for (const t of tokensPendingDelete) handleRemove(t);
                  setTokensPendingDelete(null);
                }}
                className="rounded bg-rose-500 px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-rose-400"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Token right-click context menu — move selection between token layers. */}
      {contextMenu && isGM && selectedTokenIds.size > 0 && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onPointerDown={(e) => {
              e.stopPropagation();
              setContextMenu(null);
            }}
          />
          <div
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-50 w-52 overflow-hidden rounded border border-white/10 bg-[#080A12] shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="border-b border-white/[0.07] px-3 py-1.5 font-sans text-[10px] uppercase tracking-widest text-slate-500">
              Move {selectedTokenIds.size} {selectedTokenIds.size === 1 ? 'token' : 'tokens'} to
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => moveSelectionToLayer('public')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-xs text-slate-200 transition-colors hover:bg-white/[0.05]"
            >
              <Eye className="h-3.5 w-3.5 text-emerald-400" />
              Public Tokens
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => moveSelectionToLayer('gm-private')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-xs text-slate-200 transition-colors hover:bg-white/[0.05]"
            >
              <EyeOff className="h-3.5 w-3.5 text-amber-400" />
              GM-Private Tokens
            </button>
          </div>
        </>
      )}

      {/* Batch-placement dialog (ctrl/cmd-drag of a monster) */}
      {batchPlacement && (
        <MonsterBatchDialog
          name={batchPlacement.name}
          onCancel={() => setBatchPlacement(null)}
          onConfirm={handleBatchPlace}
        />
      )}

      {/* Layers panel (GM only, toggled by the toolbar's Layer tool) */}
      {isGM && layerPanelOpen && (
        <LayersPanel
          activeLayer={activeLayer}
          hiddenLayers={hiddenLayers}
          tokenCounts={tokenCounts}
          onSelectLayer={setActiveLayer}
          onToggleLayer={toggleLayerVisibility}
          onClose={() => onCloseLayerPanel?.()}
        />
      )}

      {/* Measurement settings popup (shown while the ruler tool is active) */}
      {rulerActive && rulerPanelOpen && (
        <RulerSettingsPanel
          color={rulerColor}
          onChangeColor={setRulerColor}
          onClose={() => setRulerPanelOpen(false)}
        />
      )}

      {/* Text settings popup — always open while the text tool is active, so the
          size/color controls are available whenever text can be written/edited. */}
      {textActive && (
        <TextSettingsPanel
          color={textColor}
          onChangeColor={applyTextColor}
          fontSize={textFontSize}
          onChangeFontSize={applyTextFontSize}
          position={panelPos}
          onHeaderPointerDown={beginPanelDrag}
          rootRef={panelRef}
        />
      )}

      {/* Drawing settings popup — always open while the drawing tool is active. */}
      {drawingActive && (
        <DrawingSettingsPanel
          shape={drawShape}
          onChangeShape={setDrawShape}
          color={drawColor}
          onChangeColor={setDrawColor}
          strokeWidth={drawStrokeWidth}
          onChangeStrokeWidth={setDrawStrokeWidth}
          filled={drawFilled}
          onToggleFilled={() => setDrawFilled((v) => !v)}
          position={panelPos}
          onHeaderPointerDown={beginPanelDrag}
          rootRef={panelRef}
        />
      )}

      {/* GM "clear all drawings" confirmation dialog. */}
      {drawingsPendingClear && (
        <div
          role="presentation"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
        >
          <div
            role="alertdialog"
            aria-labelledby="drawings-clear-title"
            className="w-full max-w-sm rounded-lg border border-white/10 bg-[#0D1117] p-4 shadow-2xl"
          >
            <h2
              id="drawings-clear-title"
              className="font-sans text-sm font-bold uppercase tracking-widest text-rose-400"
            >
              Clear all drawings?
            </h2>
            <p className="font-sans mt-2 text-xs text-slate-300">
              Remove <span className="font-semibold text-white">every drawing</span> on this map?
              This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDrawingsPendingClear(false)}
                className="rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 font-sans text-xs font-semibold text-slate-300 hover:bg-white/[0.07]"
              >
                Cancel
              </button>
              <button
                type="button"
                ref={(el) => {
                  if (el) el.focus();
                }}
                onClick={clearAllDrawings}
                data-testid="map-clear-drawings-confirm"
                className="rounded bg-rose-500 px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-rose-400"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom toolbar */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded bg-black/70 p-1 backdrop-blur-sm">
        <button
          type="button"
          aria-label={showText ? 'Hide text' : 'Show text'}
          aria-pressed={showText}
          title={showText ? 'Hide text' : 'Show text'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setShowText((v) => !v)}
          className={[
            'flex h-7 w-7 items-center justify-center rounded transition-colors',
            showText ? 'bg-white/15 text-[#60A5FA]' : 'text-slate-200 hover:bg-white/10',
          ].join(' ')}
          data-testid="map-text-toggle"
        >
          <Type className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-white/15" aria-hidden="true" />
        <button
          type="button"
          aria-label={showDrawings ? 'Hide drawings' : 'Show drawings'}
          aria-pressed={showDrawings}
          title={showDrawings ? 'Hide drawings' : 'Show drawings'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setShowDrawings((v) => !v)}
          className={[
            'flex h-7 w-7 items-center justify-center rounded transition-colors',
            showDrawings ? 'bg-white/15 text-[#60A5FA]' : 'text-slate-200 hover:bg-white/10',
          ].join(' ')}
          data-testid="map-drawings-toggle"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {isGM && (
          <button
            type="button"
            aria-label="Clear all drawings"
            title="Clear all drawings"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setDrawingsPendingClear(true)}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-200 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
            data-testid="map-clear-drawings"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="mx-0.5 h-4 w-px bg-white/15" aria-hidden="true" />
        {hasGrid && (
          <>
            <button
              type="button"
              aria-label={showGrid ? 'Hide grid' : 'Show grid'}
              aria-pressed={showGrid}
              title={showGrid ? 'Hide grid' : 'Show grid'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setShowGrid((v) => !v)}
              className={[
                'flex h-7 w-7 items-center justify-center rounded transition-colors',
                showGrid ? 'bg-white/15 text-[#60A5FA]' : 'text-slate-200 hover:bg-white/10',
              ].join(' ')}
              data-testid="map-grid-toggle"
            >
              <Grid3x3 className="h-3.5 w-3.5" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-white/15" aria-hidden="true" />
          </>
        )}
        <button
          type="button"
          aria-label="Zoom out"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            zoomAround(containerSize.width / 2, containerSize.height / 2, viewport.zoom / 1.25)
          }
          className="flex h-7 w-7 items-center justify-center rounded text-slate-200 hover:bg-white/10"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="px-1 font-mono text-[11px] text-slate-200 tabular-nums">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            zoomAround(containerSize.width / 2, containerSize.height / 2, viewport.zoom * 1.25)
          }
          className="flex h-7 w-7 items-center justify-center rounded text-slate-200 hover:bg-white/10"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-200 hover:bg-white/10"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Minimum committed size for a rect/ellipse / resize (map-local pixels). */
const MIN_DRAW_SIZE = 2;

/** Axis-aligned bounding box of a drawing, in map-local pixels. */
function drawingBBox(d: {
  kind: 'pencil' | 'rect' | 'ellipse';
  points: number[];
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  if (d.kind !== 'pencil') return { x: d.x, y: d.y, width: d.width, height: d.height };
  if (d.points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < d.points.length; i += 2) {
    const x = d.points[i]!;
    const y = d.points[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Shortest distance from point (px,py) to the segment a→b. */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether the eraser at (cx,cy) with the given radius touches a drawing. */
function eraserHits(
  d: {
    kind: 'pencil' | 'rect' | 'ellipse';
    strokeWidth: number;
    points: number[];
    x: number;
    y: number;
    width: number;
    height: number;
  },
  cx: number,
  cy: number,
  radius: number
): boolean {
  if (d.kind === 'pencil') {
    const r = radius + d.strokeWidth / 2;
    if (d.points.length === 2) return Math.hypot(cx - d.points[0]!, cy - d.points[1]!) <= r;
    for (let i = 0; i + 3 < d.points.length; i += 2) {
      if (
        distToSegment(cx, cy, d.points[i]!, d.points[i + 1]!, d.points[i + 2]!, d.points[i + 3]!) <=
        r
      )
        return true;
    }
    return false;
  }
  return (
    cx >= d.x - radius &&
    cx <= d.x + d.width + radius &&
    cy >= d.y - radius &&
    cy <= d.y + d.height + radius
  );
}

/** New geometry while resizing a drawing from its corner handle. */
function resizedGeometry(
  d: {
    kind: 'pencil' | 'rect' | 'ellipse';
    startClientX: number;
    startClientY: number;
    bx: number;
    by: number;
    bw: number;
    bh: number;
    startPoints: number[];
  },
  clientX: number,
  clientY: number,
  effectiveScale: number
): { points: number[]; x: number; y: number; width: number; height: number } {
  const dxImage = (clientX - d.startClientX) / effectiveScale;
  const dyImage = (clientY - d.startClientY) / effectiveScale;
  const newW = Math.max(MIN_DRAW_SIZE, d.bw + dxImage);
  const newH = Math.max(MIN_DRAW_SIZE, d.bh + dyImage);
  if (d.kind === 'pencil') {
    const sx = d.bw > 0 ? newW / d.bw : 1;
    const sy = d.bh > 0 ? newH / d.bh : 1;
    const points = d.startPoints.map((v, i) =>
      i % 2 === 0 ? d.bx + (v - d.bx) * sx : d.by + (v - d.by) * sy
    );
    return { points, x: 0, y: 0, width: 0, height: 0 };
  }
  return { points: [], x: d.bx, y: d.by, width: newW, height: newH };
}

const BATCH_MIN = 1;
const BATCH_MAX = 20;

/** Modal counter (1–20) for ctrl/cmd-drag batch placement of a monster. */
function MonsterBatchDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: (count: number) => void;
}) {
  const [count, setCount] = useState(1);
  const clampCount = (n: number) => Math.max(BATCH_MIN, Math.min(BATCH_MAX, n));

  return (
    <div
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60"
      data-testid="monster-batch-dialog"
    >
      <div
        role="dialog"
        aria-labelledby="monster-batch-title"
        className="w-full max-w-xs rounded-lg border border-white/10 bg-[#0D1117] p-4 shadow-2xl"
      >
        <h2 id="monster-batch-title" className="font-sans text-sm font-bold text-slate-200">
          Place {name}
        </h2>
        <p className="font-sans mt-1 text-xs text-slate-400">
          How many should be scattered on the map?
        </p>

        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Decrease"
            onClick={() => setCount((c) => clampCount(c - 1))}
            disabled={count <= BATCH_MIN}
            data-testid="monster-batch-decrement"
            className="flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/[0.03] font-sans text-lg text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
          >
            −
          </button>
          <span
            className="min-w-[2.5rem] text-center font-mono text-2xl font-bold tabular-nums text-white"
            data-testid="monster-batch-count"
            aria-live="polite"
          >
            {count}
          </span>
          <button
            type="button"
            aria-label="Increase"
            onClick={() => setCount((c) => clampCount(c + 1))}
            disabled={count >= BATCH_MAX}
            data-testid="monster-batch-increment"
            className="flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/[0.03] font-sans text-lg text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
          >
            +
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 font-sans text-xs font-semibold text-slate-300 hover:bg-white/[0.07]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(clampCount(count))}
            data-testid="monster-batch-place"
            className="rounded bg-blue-600 px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-blue-500"
          >
            Place {count}
          </button>
        </div>
      </div>
    </div>
  );
}
