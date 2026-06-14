import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
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
}

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
}: ActiveMapStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const qc = useQueryClient();
  const { data: tokens = [] } = useMapTokens(campaignId, map.id);
  const mutations = useMapTokenMutations(campaignId, map.id);

  // Token selection — click selects, click on background deselects,
  // Delete/Backspace asks to confirm removal (GM only).
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [tokenPendingDelete, setTokenPendingDelete] = useState<MapTokenData | null>(null);

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
    // Background click deselects any selected token.
    setSelectedTokenId(null);
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

  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!isGM) return;
    if (!e.dataTransfer.types.includes('application/x-cartyx-document')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
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
    let payload: { collection: string; documentId: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.collection !== 'player' && payload.collection !== 'character') return;

    e.preventDefault();
    e.stopPropagation();

    const imageCoord = domToImage(e.clientX, e.clientY);
    if (!imageCoord) return;
    const x = clamp(imageCoord.x, 0, map.imageWidth);
    const y = clamp(imageCoord.y, 0, map.imageHeight);

    mutations.create.mutate(
      {
        sourceCollection: payload.collection,
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
      setSelectedTokenId((cur) => (cur === token.id ? null : cur));
    },
    [isGM, qc, campaignId, map.id, mutations.remove, onBroadcast]
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
        if (tokenPendingDelete) {
          e.preventDefault();
          setTokenPendingDelete(null);
        } else if (selectedTokenId) {
          e.preventDefault();
          setSelectedTokenId(null);
        }
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (tokenPendingDelete) return; // already confirming
      const id = selectedTokenId;
      if (!id) return;
      const token = tokens.find((t) => t.id === id);
      if (!token) return;
      e.preventDefault();
      setTokenPendingDelete(token);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isGM, selectedTokenId, tokens, tokenPendingDelete]);

  const visibleTokens = useMemo(
    () => (isGM ? tokens : tokens.filter((t) => !t.hiddenFromPlayers)),
    [tokens, isGM]
  );

  const canMoveToken = useCallback(
    (token: MapTokenData) =>
      isGM || (token.ownerUserId != null && token.ownerUserId === currentUserId),
    [isGM, currentUserId]
  );

  const cursorClass = dragMode === 'pan' ? 'cursor-grabbing' : 'cursor-grab';

  return (
    <div
      ref={containerRef}
      onPointerDown={onPanPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
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
          isSelected={selectedTokenId === token.id}
          onSelect={() => setSelectedTokenId(token.id)}
          onBeginDrag={(e) => beginTokenDrag(token, e)}
          onToggleLabel={() => handleToggleLabel(token)}
          onRemove={() => handleRemove(token)}
        />
      ))}

      {/* Delete-confirmation dialog */}
      {tokenPendingDelete && (
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
              Remove token?
            </h2>
            <p className="font-sans mt-2 text-xs text-slate-300">
              Remove{' '}
              <span className="font-semibold text-white">
                {tokenPendingDelete.label || 'this token'}
              </span>{' '}
              from the map? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTokenPendingDelete(null)}
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
                  handleRemove(tokenPendingDelete);
                  setTokenPendingDelete(null);
                }}
                className="rounded bg-rose-500 px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-rose-400"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom toolbar */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded bg-black/70 p-1 backdrop-blur-sm">
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
