import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { MapTokenData } from '~/types/mapToken';
import {
  applyTokenUpdateToCache,
  applyTokenRemoveFromCache,
  type useMapTokenMutations,
} from '~/hooks/useMapTokens';
import {
  tokenLayerId,
  tokenLayerRenderOrder,
  type MapLayerId,
  type TokenLayerId,
} from '~/types/mapLayer';
import type { TabletopMapMessage } from '~/hooks/useTabletopMapParty';

interface UseTokenInteractionsOptions {
  isGM: boolean;
  currentUserId: string | null;
  tokens: MapTokenData[];
  hiddenLayers: Set<MapLayerId>;
  containerRef: RefObject<HTMLDivElement | null>;
  qc: QueryClient;
  campaignId: string;
  mapId: string;
  mutations: ReturnType<typeof useMapTokenMutations>;
  onBroadcast: (msg: TabletopMapMessage) => void;
}

/**
 * Token selection, layer-move, label toggle, removal (GM-gated, with a confirm
 * dialog driven by `tokensPendingDelete`), the right-click context menu, the
 * Delete/Esc keyboard handling, and the visible-token/per-layer-count derivations.
 * Extracted from ActiveMapStage; token *dragging* stays in the stage (it shares
 * the stage's dragRef) and reads `selectedTokenIds` from here for group moves.
 */
export function useTokenInteractions({
  isGM,
  currentUserId,
  tokens,
  hiddenLayers,
  containerRef,
  qc,
  campaignId,
  mapId,
  mutations,
  onBroadcast,
}: UseTokenInteractionsOptions) {
  // Click selects (shift/cmd-click toggles), background click deselects,
  // Delete/Backspace confirms removal (GM only), right-click opens a layer menu.
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(() => new Set());
  const [tokensPendingDelete, setTokensPendingDelete] = useState<MapTokenData[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedTokenIds((cur) => (cur.size === 0 ? cur : new Set()));
    setContextMenu(null);
  }, []);

  const selectToken = useCallback((id: string, additive: boolean) => {
    setContextMenu(null);
    setSelectedTokenIds((cur) => {
      if (additive) {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      // A plain press on a token that is already part of a multi-selection keeps
      // the whole selection, so the press can drag the group together (GM). Any
      // other plain press selects just that token.
      if (cur.has(id) && cur.size > 1) return cur;
      return new Set([id]);
    });
  }, []);

  const handleToggleLabel = useCallback(
    (token: MapTokenData) => {
      if (!isGM) return;
      const nextVisible = !token.labelVisible;
      const optimistic: MapTokenData = { ...token, labelVisible: nextVisible };
      applyTokenUpdateToCache(qc, campaignId, mapId, optimistic);
      mutations.update.mutate(
        { tokenId: token.id, labelVisible: nextVisible },
        {
          onSuccess: (res) => {
            onBroadcast({ type: 'token:updated', mapId, token: res.token });
          },
        }
      );
    },
    [isGM, qc, campaignId, mapId, mutations.update, onBroadcast]
  );

  const handleRemove = useCallback(
    (token: MapTokenData) => {
      if (!isGM) return;
      applyTokenRemoveFromCache(qc, campaignId, mapId, token.id);
      mutations.remove.mutate(token.id, {
        onSuccess: () => {
          onBroadcast({ type: 'token:removed', mapId, tokenId: token.id });
        },
      });
      setSelectedTokenIds((cur) => {
        if (!cur.has(token.id)) return cur;
        const next = new Set(cur);
        next.delete(token.id);
        return next;
      });
    },
    [isGM, qc, campaignId, mapId, mutations.remove, onBroadcast]
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
        applyTokenUpdateToCache(qc, campaignId, mapId, optimistic);
        mutations.update.mutate(
          { tokenId: id, hiddenFromPlayers: hidden },
          {
            onSuccess: (res) => {
              onBroadcast({ type: 'token:updated', mapId, token: res.token });
            },
          }
        );
      }
      setContextMenu(null);
    },
    [isGM, selectedTokenIds, tokens, qc, campaignId, mapId, mutations.update, onBroadcast]
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
    [isGM, containerRef]
  );

  // Keyboard: Delete/Backspace on a selected token opens confirm; Esc dismisses
  // the confirm or clears the selection. GM-only: players can move their own
  // tokens but can't delete them.
  useEffect(() => {
    if (!isGM) return;
    const onKey = (e: KeyboardEvent) => {
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

  return {
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
  };
}
