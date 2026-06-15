import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { useMapTokenMutations } from '~/hooks/useMapTokens';
import type { TabletopMapMessage } from '~/hooks/useTabletopMapParty';
import { clamp } from './ActiveMapStage.geometry';

interface UseMapDropTargetOptions {
  isGM: boolean;
  mapId: string;
  imageWidth: number;
  imageHeight: number;
  /** Convert client (DOM) coords to map-local image coords. */
  domToImage: (clientX: number, clientY: number) => { x: number; y: number } | null;
  mutations: ReturnType<typeof useMapTokenMutations>;
  onBroadcast: (msg: TabletopMapMessage) => void;
}

/**
 * Drag-and-drop of wiki documents (player/character/monster) onto the map →
 * create a token. Shift-dragging a monster opens a batch-placement dialog.
 * GM-only; extracted from ActiveMapStage to keep it focused.
 */
export function useMapDropTarget({
  isGM,
  mapId,
  imageWidth,
  imageHeight,
  domToImage,
  mutations,
  onBroadcast,
}: UseMapDropTargetOptions) {
  const [isDragOverMap, setIsDragOverMap] = useState(false);
  // Latest Shift state seen during a drag-over (the drop event's modifier flags
  // are unreliable mid-DnD, so we read this on drop).
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
              onBroadcast({ type: 'token:added', mapId, token });
            }
          },
        }
      );
      setBatchPlacement(null);
    },
    [isGM, batchPlacement, mutations.createBatch, onBroadcast, mapId]
  );

  const handleDragOver = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (!isGM) return;
      if (!e.dataTransfer.types.includes('application/x-cartyx-document')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      dragShiftRef.current = e.shiftKey;
      setIsDragOverMap(true);
    },
    [isGM]
  );

  const handleDragLeave = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverMap(false);
  }, []);

  const handleDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
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
        setBatchPlacement({
          sourceDocumentId: payload.documentId,
          name: payload.title ?? 'monster',
        });
        return;
      }

      const imageCoord = domToImage(e.clientX, e.clientY);
      if (!imageCoord) return;
      const x = clamp(imageCoord.x, 0, imageWidth);
      const y = clamp(imageCoord.y, 0, imageHeight);

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
              onBroadcast({ type: 'token:added', mapId, token: res.token });
            }
          },
        }
      );
    },
    [isGM, domToImage, imageWidth, imageHeight, mutations.create, onBroadcast, mapId]
  );

  return {
    isDragOverMap,
    batchPlacement,
    setBatchPlacement,
    handleBatchPlace,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
