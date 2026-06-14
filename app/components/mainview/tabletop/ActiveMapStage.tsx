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
import { ZoomIn, ZoomOut, Maximize2, Grid3x3, Eye, EyeOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapData } from '~/types/map';
import type { MapTokenData } from '~/types/mapToken';
import {
  useMapTokens,
  useMapTokenMutations,
  applyTokenMoveToCache,
  applyTokenRemoveFromCache,
  applyTokenUpdateToCache,
} from '~/hooks/useMapTokens';
import { MapToken } from './MapToken';
import { LayersPanel } from './LayersPanel';
import { RulerSettingsPanel } from './RulerSettingsPanel';
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
      };
  const dragRef = useRef<DragState>({ mode: 'idle' });
  const [dragMode, setDragMode] = useState<'idle' | 'pan' | 'token'>('idle');

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
    // Background click deselects any selected token + closes the context menu.
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

  const cursorClass = rulerActive
    ? 'cursor-crosshair'
    : dragMode === 'pan'
      ? 'cursor-grabbing'
      : 'cursor-grab';

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

      {/* Zoom toolbar */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded bg-black/70 p-1 backdrop-blur-sm">
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
