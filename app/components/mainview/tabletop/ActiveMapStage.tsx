import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
  Eye,
  EyeOff,
  Type,
  Type as TypeIcon,
  Pencil,
  Ruler as RulerIcon,
  Layers as LayersIcon,
  Circle as CircleIcon,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapData } from '~/types/map';
import type { MapTokenData } from '~/types/mapToken';
import type { MapTextData } from '~/types/mapText';
import type { MapDrawingData } from '~/types/mapDrawing';
import { queryKeys } from '~/utils/queryKeys';
import { useMapTokens, useMapTokenMutations, applyTokenMoveToCache } from '~/hooks/useMapTokens';
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
import {
  useMapAoE,
  useMapAoEMutations,
  applyAoeAddToCache,
  applyAoeRemoveFromCache,
  applyAoeClearToCache,
  applyAoeMoveToCache,
} from '~/hooks/useMapAoE';
import { MapToken } from './MapToken';
import { LayersPanel } from './LayersPanel';
import { RulerSettingsPanel } from './RulerSettingsPanel';
import { useRulerTool } from './useRulerTool';
import { useAoeTool } from './useAoeTool';
import { MapAoELayer } from './MapAoELayer';
import { AoeSettingsPanel } from './AoeSettingsPanel';
import type { AoeInput } from './aoeGeometry';
import { RulerOverlay } from './RulerOverlay';
import { ToolWindow } from './ToolWindow';
import { TOOL_WINDOW_META, type ToolWindowId } from './toolWindowState';
import type { ToolWindowManager } from './useToolWindows';
import { useViewport, type Viewport } from './useViewport';
import { MapDrawingLayer } from './MapDrawingLayer';
import { MapTextLayer } from './MapTextLayer';
import { useTokenInteractions } from './useTokenInteractions';
import { TextSettingsPanel } from './TextSettingsPanel';
import { DrawingSettingsPanel, type DrawShape } from './DrawingSettingsPanel';
import { MonsterBatchDialog } from './MonsterBatchDialog';
import { MapConfirmDialog } from './MapConfirmDialog';
import { useMapDropTarget } from './useMapDropTarget';
import { MAX_DRAWING_POINT_VALUES } from '~/types/schemas/mapDrawings';
import {
  clamp,
  MIN_DRAW_SIZE,
  drawingBBox,
  eraserHits,
  resizedGeometry,
  movedGeometry,
} from './ActiveMapStage.geometry';
import type { MapLayerId } from '~/types/mapLayer';
import type { AoeShape, MapAoEData } from '~/types/mapAoe';
import type { TabletopMapMessage } from '~/hooks/useTabletopMapParty';

interface ActiveMapStageProps {
  map: MapData;
  campaignId: string;
  isGM: boolean;
  /** Database user id of the current viewer — used to gate per-token moves. */
  currentUserId: string | null;
  /** Broadcaster for the tabletop-map party. */
  onBroadcast: (msg: TabletopMapMessage) => void;
  /** Open tool windows (drawing/text/ruler/layer render inside the stage). */
  openToolWindows: ToolWindowId[];
  /** Geometry manager shared with TabletopView (dice renders up there). */
  windowManager: ToolWindowManager;
  /** Whether the measurement (ruler) tool is active. */
  rulerActive?: boolean;
  /** Whether the Spell AoE tool is active (click to place a template). */
  aoeActive?: boolean;
  /** Whether the text tool is active (click to write, click text to select). */
  textActive?: boolean;
  /** Whether the drawing tool is active (draw shapes / erase on the map). */
  drawingActive?: boolean;
  /** Whether the pointer tool is active (select/resize/delete drawings). */
  pointerActive?: boolean;
  /** Whether the hand tool is active (background drag always pans). */
  handActive?: boolean;
}

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
 * Realtime: token/text/drawing writes go through mutations + a peer broadcast
 * on the tabletop-map party (via `onBroadcast`). Inbound remote changes are
 * applied to the query cache by the parent's handler in TabletopView.
 */
export function ActiveMapStage({
  map,
  campaignId,
  isGM,
  currentUserId,
  onBroadcast,
  openToolWindows,
  windowManager,
  rulerActive = false,
  aoeActive = false,
  textActive = false,
  drawingActive = false,
  pointerActive = false,
  handActive = false,
}: ActiveMapStageProps) {
  // Viewport (zoom/pan) + the image↔DOM transform that every tool reads from.
  const {
    containerRef,
    containerSize,
    viewport,
    setViewport,
    effectiveScale,
    displayedImageWidth,
    displayedImageHeight,
    imageOffsetX,
    imageOffsetY,
    domToImage,
    zoomAround,
  } = useViewport(map.imageWidth, map.imageHeight);

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
  // Eraser radius is independent of the pen line width, so switching tools
  // never silently changes your pen size.
  const [drawEraserSize, setDrawEraserSize] = useState(16);
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

  // Spell AoE templates — shared, persisted, multiplayer. Any member can place a
  // template; deletion is gated to the author or a GM (server-enforced). The tool
  // settings (shape/size/width/color) are the local "brush" for this client.
  const { data: aoes = [] } = useMapAoE(campaignId, map.id);
  const aoeMutations = useMapAoEMutations(campaignId, map.id);
  const [aoeShape, setAoeShape] = useState<AoeShape>('sphere');
  const [aoeSizeFt, setAoeSizeFt] = useState(20);
  const [aoeWidthFt, setAoeWidthFt] = useState(5);
  const [aoeColor, setAoeColor] = useState('#3b82f6');
  const [aoeLabel, setAoeLabel] = useState('');
  const [selectedAoeId, setSelectedAoeId] = useState<string | null>(null);
  // Per-viewer show/hide for spell AoE visuals — everyone gets this toggle
  // (local only, not broadcast); hides the AoE layer for this client alone.
  const [showSpellEffects, setShowSpellEffects] = useState(true);

  // Layers — GM-local working layer + per-layer visibility (GM's own view;
  // players never gain this panel so it stays empty for them).
  const [activeLayer, setActiveLayer] = useState<MapLayerId>('public');
  const [hiddenLayers, setHiddenLayers] = useState<Set<MapLayerId>>(() => new Set());

  // Token selection / removal / layer-move / context menu + the visible-token
  // derivations. Token *dragging* stays in this component (shares the dragRef).
  const {
    selectedTokenIds,
    clearSelection,
    selectToken,
    tokensPendingDelete,
    setTokensPendingDelete,
    contextMenu,
    setContextMenu,
    handleToggleLabel,
    handleRemove,
    moveSelectionToLayer,
    handleTokenContextMenu,
    visibleTokens,
    tokenCounts,
    canMoveToken,
  } = useTokenInteractions({
    isGM,
    currentUserId,
    tokens,
    hiddenLayers,
    containerRef,
    qc,
    campaignId,
    mapId: map.id,
    mutations,
    onBroadcast,
  });

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
  // Drawings (Spell FX / Drawing layer) are a GM-only feature: the drawing tool
  // is hidden from players, the server returns no drawings to non-GMs, and every
  // drawing mutation is GM-only. So only a GM may modify any drawing. Kept as a
  // per-drawing predicate to match the MapDrawingLayer `canModify` prop shape.
  const canModifyDrawing = useCallback((_d: MapDrawingData) => isGM, [isGM]);

  // A player may delete only their own AoE template; a GM may delete anyone's.
  // The server enforces this; the client mirrors it for affordances.
  const canModifyAoe = useCallback(
    (a: MapAoEData) => isGM || (currentUserId != null && a.createdBy === currentUserId),
    [isGM, currentUserId]
  );

  // AoE templates are selectable/movable under the pointer tool (like map text)
  // and under the AoE tool. Clear the selection when leaving both, so a stray
  // Delete/Backspace in an unrelated tool (ruler, hand) can't remove a template.
  useEffect(() => {
    if (!aoeActive && !pointerActive) setSelectedAoeId(null);
  }, [aoeActive, pointerActive]);

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
      const radius = drawEraserSize;
      for (const dr of drawings) {
        if (erased.has(dr.id)) continue;
        if (!canModifyDrawing(dr)) continue;
        if (eraserHits(dr, ix, iy, radius)) {
          erased.add(dr.id);
          removeDrawing(dr.id);
        }
      }
    },
    [drawings, drawEraserSize, canModifyDrawing, removeDrawing]
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

  // Keyboard: Delete/Backspace removes the selected drawing (GM-only, gated by
  // canModifyDrawing); Esc clears the selection.
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

  // Space held = temporary hand tool (pan with any tool). Ignored while typing.
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTyping(e.target)) setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    // If focus leaves the window while Space is held (alt-tab, devtools,
    // another app), the keyup never fires and spaceHeld would stick —
    // background drag would keep panning until Space is tapped again.
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const toggleLayerVisibility = useCallback((id: MapLayerId) => {
    setHiddenLayers((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Measurement (ruler) tool — client-only polyline measurement. Owns its own
  // state + handlers; it short-circuits the stage pointer handlers below and
  // never touches the dragRef.
  const ruler = useRulerTool({
    rulerActive,
    tokens,
    domToImage,
    imageOffsetX,
    imageOffsetY,
    effectiveScale,
    pixelsPerSquare: map.scale.pixelsPerSquare,
    feetPerSquare: map.scale.feetPerSquare,
    imageWidth: map.imageWidth,
    imageHeight: map.imageHeight,
  });

  // Spell AoE tool — a ruler-style placement state machine. Committing a
  // template persists it (optimistically added to the cache) and broadcasts to
  // peers. Like the ruler, it short-circuits the stage pointer handlers below.
  const commitAoe = useCallback(
    (committed: AoeInput & { color: string }) => {
      const label = aoeLabel.trim();
      aoeMutations.create.mutate(
        { ...committed, label: label || undefined },
        {
          onSuccess: (res) => {
            applyAoeAddToCache(qc, campaignId, map.id, res.aoe);
            onBroadcast({ type: 'aoe:added', mapId: map.id, aoe: res.aoe });
          },
        }
      );
    },
    [aoeMutations.create, qc, campaignId, map.id, onBroadcast, aoeLabel]
  );

  const aoe = useAoeTool({
    aoeActive,
    shape: aoeShape,
    sizeFt: aoeSizeFt,
    widthFt: aoeWidthFt,
    color: aoeColor,
    domToImage,
    pixelsPerSquare: map.scale.pixelsPerSquare,
    feetPerSquare: map.scale.feetPerSquare,
    imageWidth: map.imageWidth,
    imageHeight: map.imageHeight,
    onCommit: commitAoe,
  });

  const removeAoe = useCallback(
    (aoeId: string) => {
      applyAoeRemoveFromCache(qc, campaignId, map.id, aoeId);
      aoeMutations.remove.mutate(aoeId, {
        onSuccess: () => onBroadcast({ type: 'aoe:removed', mapId: map.id, aoeId }),
      });
      setSelectedAoeId((cur) => (cur === aoeId ? null : cur));
    },
    [qc, campaignId, map.id, aoeMutations.remove, onBroadcast]
  );

  const clearAllAoe = useCallback(() => {
    if (!isGM) return;
    applyAoeClearToCache(qc, campaignId, map.id);
    setSelectedAoeId(null);
    aoeMutations.clear.mutate(undefined, {
      onSuccess: () => onBroadcast({ type: 'aoe:cleared', mapId: map.id }),
    });
  }, [isGM, qc, campaignId, map.id, aoeMutations.clear, onBroadcast]);

  // Keyboard: Delete/Backspace removes the selected AoE (permission-gated); Esc
  // clears the selection. Not GM-gated — players can delete their own template.
  // A template can only be selected under the pointer/AoE tools, and the
  // selection auto-clears when leaving both, so this can't fire from another tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt) {
        const tag = tgt.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tgt.isContentEditable)
          return;
      }
      if (e.key === 'Escape') {
        if (selectedAoeId) {
          e.preventDefault();
          setSelectedAoeId(null);
        }
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedAoeId) return;
      const a = aoes.find((x) => x.id === selectedAoeId);
      if (!a || !canModifyAoe(a)) return;
      e.preventDefault();
      removeAoe(a.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedAoeId, aoes, canModifyAoe, removeAoe]);

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
        /** Every token moving with this drag (one, or a whole GM selection). */
        tokens: Array<{ id: string; startX: number; startY: number }>;
        startClientX: number;
        startClientY: number;
        /** Group start-bounds, so the delta is clamped to keep all in-image. */
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
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
        mode: 'aoe';
        aoeId: string;
        startClientX: number;
        startClientY: number;
        startOriginX: number;
        startOriginY: number;
        lastBroadcastAt: number;
        moved: boolean;
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
      }
    | {
        mode: 'move';
        drawingId: string;
        kind: 'pencil' | 'rect' | 'ellipse';
        startClientX: number;
        startClientY: number;
        /** Original geometry, translated by the drag delta. */
        startPoints: number[];
        startX: number;
        startY: number;
        /** Original bounding box (map-local pixels), for in-bounds clamping. */
        bx: number;
        by: number;
        bw: number;
        bh: number;
        lastBroadcastAt: number;
        moved: boolean;
      };
  const dragRef = useRef<DragState>({ mode: 'idle' });
  const [dragMode, setDragMode] = useState<
    'idle' | 'pan' | 'token' | 'text' | 'aoe' | 'draw' | 'erase' | 'resize' | 'move'
  >('idle');

  const onPanPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Middle-button drag pans with ANY tool (preventDefault stops autoscroll).
    const middlePan = e.button === 1;
    if (middlePan) e.preventDefault();
    else if (e.button !== 0) return;
    // Held Space is a temporary hand tool: like middle-button, it pans with
    // ANY tool, bypassing the ruler/text/drawing handlers below.
    const panOverride = middlePan || spaceHeld;

    if (!panOverride) {
      // Spell AoE tool: a click places/aims a template. Fully owns the pointer
      // while active (no pan/select), like the ruler.
      if (aoeActive) {
        aoe.onPointerDown(e);
        return;
      }
      // Ruler tool: a background click drops/relocates the measurement anchor
      // (clicks on tokens are handled by MapToken). No pan/select while measuring.
      if (rulerActive) {
        ruler.onBackgroundPointerDown(e);
        return;
      }
      // Text tool: a background click writes text. If a draft is already open,
      // this click just commits it (via the input's blur) and opens nothing new;
      // clicking an existing text (handled there) selects it instead.
      if (textActive) {
        if (textDraft) return;
        const img = domToImage(e.clientX, e.clientY);
        if (img) {
          openTextDraft({
            x: clamp(img.x, 0, map.imageWidth),
            y: clamp(img.y, 0, map.imageHeight),
          });
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
          dragRef.current = {
            mode: 'draw',
            kind: 'pencil',
            points: [ix, iy],
            lastX: ix,
            lastY: iy,
          };
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
    }

    // Background press: always deselect; pan only for hand / Space / middle.
    setSelectedDrawingId(null);
    clearSelection();
    if (!panOverride && !handActive) return;
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

      // Pressing a token that's part of a multi-selection drags the whole group
      // together (GM only — players can move only their own single token). Any
      // other press drags just the pressed token.
      const groupIds =
        isGM && selectedTokenIds.has(token.id) && selectedTokenIds.size > 1
          ? [...selectedTokenIds]
          : [token.id];
      const group = groupIds
        .map((id) => tokens.find((t) => t.id === id))
        .filter((t): t is MapTokenData => !!t);
      const items = group.length > 0 ? group : [token];
      const starts = items.map((t) => ({ id: t.id, startX: t.x, startY: t.y }));

      // Clamp by each token's footprint edges (center ± half its pixel size), not
      // its center, so large multi-square tokens can't be dragged partially off
      // the image. token.x/y are image-pixel centers; size = sizeSquares × pps.
      const pps = Math.max(1, map.scale.pixelsPerSquare);
      const half = (t: MapTokenData) => (Math.max(1, t.sizeSquares) * pps) / 2;

      dragRef.current = {
        mode: 'token',
        tokens: starts,
        startClientX: e.clientX,
        startClientY: e.clientY,
        minX: Math.min(...items.map((t) => t.x - half(t))),
        minY: Math.min(...items.map((t) => t.y - half(t))),
        maxX: Math.max(...items.map((t) => t.x + half(t))),
        maxY: Math.max(...items.map((t) => t.y + half(t))),
        lastBroadcastAt: 0,
      };
      setDragMode('token');
    },
    [isGM, selectedTokenIds, tokens, map.scale.pixelsPerSquare]
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

  // Pointer-down on an existing AoE template (pointer/AoE tool, own/GM only):
  // select it, and a drag past a small threshold relocates it — mirrors text.
  const beginAoeDrag = useCallback(
    (a: MapAoEData, e: ReactPointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      if (!canModifyAoe(a)) return;
      e.stopPropagation();
      clearSelection();
      setSelectedAoeId(a.id);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode: 'aoe',
        aoeId: a.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOriginX: a.originX,
        startOriginY: a.originY,
        lastBroadcastAt: 0,
        moved: false,
      };
      setDragMode('aoe');
    },
    [canModifyAoe, clearSelection]
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

  // Pointer-down on a drawing (pointer tool): always selects it; if the viewer
  // may modify it, also primes a move. A press that doesn't move past a small
  // threshold stays a plain selection (see onPointerUp).
  const beginDrawingMove = useCallback(
    (drawingId: string, e: ReactPointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      const dr = drawings.find((x) => x.id === drawingId);
      if (!dr) return;
      e.stopPropagation();
      clearSelection();
      setSelectedDrawingId(drawingId);
      // Selectable by anyone, but only own/GM can move it.
      if (!canModifyDrawing(dr)) return;
      const bbox = drawingBBox(dr);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode: 'move',
        drawingId,
        kind: dr.kind,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPoints: dr.kind === 'pencil' ? [...dr.points] : [],
        startX: dr.x,
        startY: dr.y,
        bx: bbox.x,
        by: bbox.y,
        bw: bbox.width,
        bh: bbox.height,
        lastBroadcastAt: 0,
        moved: false,
      };
      setDragMode('move');
    },
    [drawings, canModifyDrawing, clearSelection]
  );

  // Keyboard nudge of a drawing (arrow keys). Mirrors the pointer-move commit:
  // translate by (dx,dy) map-local px clamped in-bounds, persist + broadcast.
  const nudgeDrawing = useCallback(
    (drawingId: string, dx: number, dy: number) => {
      const dr = drawings.find((x) => x.id === drawingId);
      if (!dr || !canModifyDrawing(dr)) return;
      const bbox = drawingBBox(dr);
      const offX = clamp(dx, -bbox.x, map.imageWidth - bbox.width - bbox.x);
      const offY = clamp(dy, -bbox.y, map.imageHeight - bbox.height - bbox.y);
      if (offX === 0 && offY === 0) return;
      const geom = movedGeometry(
        {
          kind: dr.kind,
          startPoints: dr.points,
          startX: dr.x,
          startY: dr.y,
          bw: dr.width,
          bh: dr.height,
        },
        offX,
        offY
      );
      applyDrawingUpdateToCache(qc, campaignId, map.id, { ...dr, ...geom });
      const update =
        dr.kind === 'pencil'
          ? { drawingId, points: geom.points }
          : { drawingId, x: geom.x, y: geom.y };
      drawingMutations.update.mutate(update, {
        onSuccess: (res) => {
          applyDrawingUpdateToCache(qc, campaignId, map.id, res.drawing);
          onBroadcast({ type: 'drawing:updated', mapId: map.id, drawing: res.drawing });
        },
      });
    },
    [
      drawings,
      canModifyDrawing,
      map.imageWidth,
      map.imageHeight,
      qc,
      campaignId,
      map.id,
      drawingMutations.update,
      onBroadcast,
    ]
  );

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
    const d = dragRef.current;
    // Ruler tool: the live endpoint follows the cursor until a fixed end is
    // set — unless a pan is in progress (middle-button / Space override).
    if (rulerActive && d.mode !== 'pan') {
      ruler.onPointerMove(e);
      return;
    }
    // Spell AoE tool: aim a directional template's second point as the cursor
    // moves — but not while dragging an existing template (mode 'aoe') or a pan
    // override, so an in-progress move falls through to the drag branch below.
    if (aoeActive && d.mode !== 'pan' && d.mode !== 'aoe') {
      aoe.onPointerMove(e);
      return;
    }
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
      // Clamp the delta (not each token) so the whole group keeps its formation
      // and never leaves the image.
      const cdx = clamp(dxImage, -d.minX, map.imageWidth - d.maxX);
      const cdy = clamp(dyImage, -d.minY, map.imageHeight - d.maxY);
      const now = Date.now();
      const broadcast = now - d.lastBroadcastAt >= MOVE_BROADCAST_INTERVAL_MS;
      if (broadcast) d.lastBroadcastAt = now;
      for (const t of d.tokens) {
        const nx = t.startX + cdx;
        const ny = t.startY + cdy;
        // Optimistic local update.
        applyTokenMoveToCache(qc, campaignId, map.id, t.id, nx, ny);
        // Throttled broadcast for smooth remote views.
        if (broadcast) {
          onBroadcast({ type: 'token:moved', mapId: map.id, tokenId: t.id, x: nx, y: ny });
        }
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
    } else if (d.mode === 'aoe') {
      const dxImage = (e.clientX - d.startClientX) / effectiveScale;
      const dyImage = (e.clientY - d.startClientY) / effectiveScale;
      const nx = clamp(d.startOriginX + dxImage, 0, map.imageWidth);
      const ny = clamp(d.startOriginY + dyImage, 0, map.imageHeight);
      if (Math.abs(dxImage) > 1 || Math.abs(dyImage) > 1) d.moved = true;
      applyAoeMoveToCache(qc, campaignId, map.id, d.aoeId, nx, ny);
      const now = Date.now();
      if (now - d.lastBroadcastAt >= MOVE_BROADCAST_INTERVAL_MS) {
        d.lastBroadcastAt = now;
        onBroadcast({ type: 'aoe:moved', mapId: map.id, aoeId: d.aoeId, originX: nx, originY: ny });
      }
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
    } else if (d.mode === 'move') {
      const existing = drawings.find((x) => x.id === d.drawingId);
      if (!existing) return;
      const dxImage = (e.clientX - d.startClientX) / effectiveScale;
      const dyImage = (e.clientY - d.startClientY) / effectiveScale;
      if (Math.abs(dxImage) > 1 || Math.abs(dyImage) > 1) d.moved = true;
      const offX = clamp(dxImage, -d.bx, map.imageWidth - d.bw - d.bx);
      const offY = clamp(dyImage, -d.by, map.imageHeight - d.bh - d.by);
      const geom = movedGeometry(d, offX, offY);
      const moved = { ...existing, ...geom };
      applyDrawingUpdateToCache(qc, campaignId, map.id, moved);
      // Live broadcast: only a rect/ellipse's small bounding box during the drag
      // (a pencil's translated point list would be a large per-frame payload, so
      // pencils sync only on the final commit in onPointerUp).
      if (d.kind !== 'pencil') {
        const now = Date.now();
        if (now - d.lastBroadcastAt >= MOVE_BROADCAST_INTERVAL_MS) {
          d.lastBroadcastAt = now;
          onBroadcast({
            type: 'drawing:moved',
            mapId: map.id,
            drawingId: d.drawingId,
            x: moved.x,
            y: moved.y,
            width: moved.width,
            height: moved.height,
          });
        }
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d.mode === 'token') {
      const dxImage = (e.clientX - d.startClientX) / effectiveScale;
      const dyImage = (e.clientY - d.startClientY) / effectiveScale;
      const cdx = clamp(dxImage, -d.minX, map.imageWidth - d.maxX);
      const cdy = clamp(dyImage, -d.minY, map.imageHeight - d.maxY);
      // Persist and broadcast the final position of every token in the group.
      for (const t of d.tokens) {
        const nx = t.startX + cdx;
        const ny = t.startY + cdy;
        const { startX, startY, id } = t;
        mutations.move.mutate(
          { tokenId: id, x: nx, y: ny },
          {
            onSuccess: () => {
              onBroadcast({
                type: 'token:moved',
                mapId: map.id,
                tokenId: id,
                x: nx,
                y: ny,
                final: true,
              });
            },
            onError: () => {
              // The move didn't persist. Peers may have received interim
              // (non-final) positions during the drag, so revert them and the
              // local cache to the last-known-good (pre-drag) position rather
              // than leaving a ghost, then refetch the authoritative state.
              applyTokenMoveToCache(qc, campaignId, map.id, id, startX, startY);
              onBroadcast({
                type: 'token:moved',
                mapId: map.id,
                tokenId: id,
                x: startX,
                y: startY,
                final: true,
              });
              qc.invalidateQueries({ queryKey: queryKeys.mapTokens.list(campaignId, map.id) });
            },
          }
        );
      }
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
            onError: () => {
              // Persist failed: revert peers (and the local cache) to the
              // pre-drag position so no one is left with a ghost.
              applyTextMoveToCache(qc, campaignId, map.id, d.textId, d.startX, d.startY);
              onBroadcast({
                type: 'text:moved',
                mapId: map.id,
                textId: d.textId,
                x: d.startX,
                y: d.startY,
                final: true,
              });
            },
          }
        );
      }
    } else if (d.mode === 'aoe') {
      if (d.moved) {
        const dxImage = (e.clientX - d.startClientX) / effectiveScale;
        const dyImage = (e.clientY - d.startClientY) / effectiveScale;
        const nx = clamp(d.startOriginX + dxImage, 0, map.imageWidth);
        const ny = clamp(d.startOriginY + dyImage, 0, map.imageHeight);
        applyAoeMoveToCache(qc, campaignId, map.id, d.aoeId, nx, ny);
        aoeMutations.move.mutate(
          { aoeId: d.aoeId, originX: nx, originY: ny },
          {
            onSuccess: () =>
              onBroadcast({
                type: 'aoe:moved',
                mapId: map.id,
                aoeId: d.aoeId,
                originX: nx,
                originY: ny,
                final: true,
              }),
            onError: () => {
              // Persist failed: peers got interim positions during the drag —
              // revert them (and the local cache) to the pre-drag origin rather
              // than leaving a ghost. The hook's onError also toasts + refetches.
              applyAoeMoveToCache(qc, campaignId, map.id, d.aoeId, d.startOriginX, d.startOriginY);
              onBroadcast({
                type: 'aoe:moved',
                mapId: map.id,
                aoeId: d.aoeId,
                originX: d.startOriginX,
                originY: d.startOriginY,
                final: true,
              });
            },
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
    } else if (d.mode === 'move') {
      // A press that never moved is just a selection — nothing to persist.
      if (d.moved) {
        const dxImage = (e.clientX - d.startClientX) / effectiveScale;
        const dyImage = (e.clientY - d.startClientY) / effectiveScale;
        const offX = clamp(dxImage, -d.bx, map.imageWidth - d.bw - d.bx);
        const offY = clamp(dyImage, -d.by, map.imageHeight - d.bh - d.by);
        const geom = movedGeometry(d, offX, offY);
        const existing = drawings.find((x) => x.id === d.drawingId);
        if (existing) applyDrawingUpdateToCache(qc, campaignId, map.id, { ...existing, ...geom });
        const update =
          d.kind === 'pencil'
            ? { drawingId: d.drawingId, points: geom.points }
            : { drawingId: d.drawingId, x: geom.x, y: geom.y };
        drawingMutations.update.mutate(update, {
          onSuccess: (res) => {
            applyDrawingUpdateToCache(qc, campaignId, map.id, res.drawing);
            onBroadcast({ type: 'drawing:updated', mapId: map.id, drawing: res.drawing });
          },
        });
      }
    }
    dragRef.current = { mode: 'idle' };
    setDragMode('idle');
  };

  // -------------------------------------------------------------------------
  // Drag-and-drop from wiki lists → create a token (GM only)
  // -------------------------------------------------------------------------

  const {
    isDragOverMap,
    batchPlacement,
    setBatchPlacement,
    handleBatchPlace,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useMapDropTarget({
    isGM,
    mapId: map.id,
    imageWidth: map.imageWidth,
    imageHeight: map.imageHeight,
    domToImage,
    mutations,
    onBroadcast,
  });

  const cursorClass =
    dragMode === 'pan'
      ? 'cursor-grabbing'
      : handActive || spaceHeld
        ? 'cursor-grab'
        : rulerActive || drawingActive || aoeActive
          ? 'cursor-crosshair'
          : textActive
            ? 'cursor-text'
            : 'cursor-default';

  // Text + drawings both live on the Spell FX / Drawing layer, so each is
  // visible only when its own per-viewer zoom-toolbar toggle is on AND the GM
  // hasn't hidden that layer in the Layers panel (same `hiddenLayers` mechanism
  // as the map image + token layers).
  const spellFxHidden = hiddenLayers.has('spell-fx');
  // Drawings are GM-only, so the whole drawing layer is gated on isGM as well as
  // the per-viewer toggle + the Layers-panel layer visibility. Text is shared,
  // so it only depends on its own toggle + the layer visibility.
  const drawingsVisible = isGM && showDrawings && !spellFxHidden;
  const textVisible = showText && !spellFxHidden;

  return (
    <div
      ref={containerRef}
      onPointerDown={onPanPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        // Spell AoE tool: a double-click cancels an in-progress directional
        // placement (mirrors the ruler's reset).
        if (aoeActive) {
          e.preventDefault();
          aoe.reset();
          return;
        }
        // Ruler tool: a double-click resets the measurement — the tool stops
        // drawing until the next click (also clears a multi-point polyline).
        if (!rulerActive) return;
        e.preventDefault();
        ruler.resetMeasurement();
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

      {/* Spell AoE templates (shared) — one SVG overlay above the map/grid but
          BENEATH drawings/tokens, so the tint reads as a floor effect. */}
      <MapAoELayer
        visible={!spellFxHidden && showSpellEffects}
        aoes={aoes}
        preview={aoe.preview}
        effectiveScale={effectiveScale}
        imageOffsetX={imageOffsetX}
        imageOffsetY={imageOffsetY}
        selectedId={selectedAoeId}
        onBeginDrag={beginAoeDrag}
        interactive={aoeActive || pointerActive}
        canModify={canModifyAoe}
      />

      {/* Drawing layer (shared) — one SVG overlay above the map/grid, plus the
          selected drawing's bounding box + corner resize handle. */}
      <MapDrawingLayer
        visible={drawingsVisible}
        drawings={drawings}
        preview={drawPreview}
        pointerActive={pointerActive}
        isGM={isGM}
        currentUserId={currentUserId}
        effectiveScale={effectiveScale}
        imageOffsetX={imageOffsetX}
        imageOffsetY={imageOffsetY}
        selectedDrawingId={selectedDrawingId}
        canModify={canModifyDrawing}
        onBeginMove={beginDrawingMove}
        onBeginResize={beginDrawingResize}
        onSelect={setSelectedDrawingId}
        onNudge={nudgeDrawing}
      />

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
          onMeasure={(shiftKey) => ruler.pickTokenForMeasure(token, shiftKey)}
          onSelect={(additive) => selectToken(token.id, additive)}
          onBeginDrag={(e) => beginTokenDrag(token, e)}
          onContextMenu={(e) => handleTokenContextMenu(token, e)}
          onToggleLabel={() => handleToggleLabel(token)}
          onRemove={() => handleRemove(token)}
        />
      ))}

      {/* Map text layer (shared) — placed labels + the in-progress editor. */}
      <MapTextLayer
        visible={textVisible}
        texts={texts}
        textActive={textActive}
        pointerActive={pointerActive}
        canModify={canModifyText}
        selectedTextId={selectedTextId}
        effectiveScale={effectiveScale}
        imageOffsetX={imageOffsetX}
        imageOffsetY={imageOffsetY}
        onBeginDrag={beginTextDrag}
        onOpenEdit={openTextEdit}
        draft={textDraft}
        draftValue={textDraftValue}
        onDraftChange={setTextDraftValue}
        onCommit={commitTextDraft}
        onCancel={cancelTextDraft}
        inputRef={textInputRef}
        draftColor={textColor}
        draftFontSize={textFontSize}
      />

      {/* Measurement (ruler) overlay — polyline + endpoints + per-segment feet. */}
      {ruler.measurement && (
        <RulerOverlay measurement={ruler.measurement} rulerColor={ruler.rulerColor} />
      )}

      {/* Delete-confirmation dialog */}
      {tokensPendingDelete && tokensPendingDelete.length > 0 && (
        <MapConfirmDialog
          title={tokensPendingDelete.length === 1 ? 'Remove token?' : 'Remove tokens?'}
          confirmLabel="Remove"
          onCancel={() => setTokensPendingDelete(null)}
          onConfirm={() => {
            for (const t of tokensPendingDelete) handleRemove(t);
            setTokensPendingDelete(null);
          }}
        >
          Remove{' '}
          <span className="font-semibold text-white">
            {tokensPendingDelete.length === 1
              ? tokensPendingDelete[0].label || 'this token'
              : `${tokensPendingDelete.length} tokens`}
          </span>{' '}
          from the map? This cannot be undone.
        </MapConfirmDialog>
      )}

      {/* Token right-click context menu — move selection between token layers. */}
      {contextMenu && isGM && selectedTokenIds.size > 0 && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-50 cursor-default"
            onPointerDown={(e) => {
              e.stopPropagation();
              setContextMenu(null);
            }}
          />
          <div
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-[51] w-52 overflow-hidden rounded border border-white/10 bg-[#080A12] shadow-xl"
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

      {/* Tool windows — unified chrome, placed/dragged by the shared manager. */}
      {isGM && openToolWindows.includes('layer') && (
        <ToolWindow
          title={TOOL_WINDOW_META.layer.title}
          icon={LayersIcon}
          {...windowManager.getWindowProps('layer')}
        >
          <LayersPanel
            activeLayer={activeLayer}
            hiddenLayers={hiddenLayers}
            tokenCounts={tokenCounts}
            onSelectLayer={setActiveLayer}
            onToggleLayer={toggleLayerVisibility}
          />
        </ToolWindow>
      )}

      {openToolWindows.includes('ruler') && (
        <ToolWindow
          title={TOOL_WINDOW_META.ruler.title}
          icon={RulerIcon}
          {...windowManager.getWindowProps('ruler')}
        >
          <RulerSettingsPanel color={ruler.rulerColor} onChangeColor={ruler.setRulerColor} />
        </ToolWindow>
      )}

      {openToolWindows.includes('text') && (
        <ToolWindow
          title={TOOL_WINDOW_META.text.title}
          icon={TypeIcon}
          {...windowManager.getWindowProps('text')}
        >
          <TextSettingsPanel
            color={textColor}
            onChangeColor={applyTextColor}
            fontSize={textFontSize}
            onChangeFontSize={applyTextFontSize}
          />
        </ToolWindow>
      )}

      {openToolWindows.includes('aoe') && (
        <ToolWindow
          title={TOOL_WINDOW_META.aoe.title}
          icon={CircleIcon}
          {...windowManager.getWindowProps('aoe')}
        >
          <AoeSettingsPanel
            shape={aoeShape}
            onShape={setAoeShape}
            sizeFt={aoeSizeFt}
            onSizeFt={setAoeSizeFt}
            widthFt={aoeWidthFt}
            onWidthFt={setAoeWidthFt}
            color={aoeColor}
            onColor={setAoeColor}
            label={aoeLabel}
            onLabel={setAoeLabel}
            onClearAll={clearAllAoe}
            canClearAll={isGM}
          />
        </ToolWindow>
      )}

      {isGM && openToolWindows.includes('drawing') && (
        <ToolWindow
          title={TOOL_WINDOW_META.drawing.title}
          icon={Pencil}
          {...windowManager.getWindowProps('drawing')}
        >
          <DrawingSettingsPanel
            shape={drawShape}
            onChangeShape={setDrawShape}
            color={drawColor}
            onChangeColor={setDrawColor}
            strokeWidth={drawShape === 'eraser' ? drawEraserSize : drawStrokeWidth}
            onChangeStrokeWidth={drawShape === 'eraser' ? setDrawEraserSize : setDrawStrokeWidth}
            filled={drawFilled}
            onToggleFilled={() => setDrawFilled((v) => !v)}
          />
        </ToolWindow>
      )}

      {/* GM "clear all drawings" confirmation dialog. */}
      {drawingsPendingClear && (
        <MapConfirmDialog
          title="Clear all drawings?"
          confirmLabel="Clear all"
          confirmTestId="map-clear-drawings-confirm"
          onCancel={() => setDrawingsPendingClear(false)}
          onConfirm={clearAllDrawings}
        >
          Remove <span className="font-semibold text-white">every drawing</span> on this map? This
          cannot be undone.
        </MapConfirmDialog>
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
        {/* Spell AoE visuals — per-viewer show/hide, available to everyone. */}
        <button
          type="button"
          aria-label={showSpellEffects ? 'Hide spell effects' : 'Show spell effects'}
          aria-pressed={showSpellEffects}
          title={showSpellEffects ? 'Hide spell effects' : 'Show spell effects'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setShowSpellEffects((v) => !v)}
          className={[
            'flex h-7 w-7 items-center justify-center rounded transition-colors',
            showSpellEffects ? 'bg-white/15 text-[#60A5FA]' : 'text-slate-200 hover:bg-white/10',
          ].join(' ')}
          data-testid="map-spell-effects-toggle"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
        {/* Drawings are GM-only — players never see the drawing controls. */}
        {isGM && (
          <>
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
          </>
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
