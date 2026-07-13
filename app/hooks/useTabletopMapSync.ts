import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '~/utils/queryKeys';
import { useTabletopMapParty } from './useTabletopMapParty';
import {
  applyTokenAddToCache,
  applyTokenMoveToCache,
  applyTokenRemoveFromCache,
  applyTokenUpdateToCache,
} from './useMapTokens';
import {
  applyTextAddToCache,
  applyTextRemoveFromCache,
  applyTextMoveToCache,
  applyTextUpdateToCache,
} from './useMapTexts';
import {
  applyDrawingAddToCache,
  applyDrawingUpdateToCache,
  applyDrawingGeomToCache,
  applyDrawingRemoveFromCache,
  applyDrawingsClearToCache,
} from './useMapDrawings';
import { applyAoeAddToCache, applyAoeRemoveFromCache, applyAoeClearToCache } from './useMapAoE';

/**
 * Subscribes to the campaign's tabletop-map party and applies inbound
 * token/text/drawing/active-map messages to the TanStack Query cache (the
 * counterpart to ActiveMapStage's outbound broadcasts). Returns `send` for
 * broadcasting local changes. Extracted from TabletopView so the realtime
 * inbound reducer lives next to the map cache helpers it uses.
 */
export function useTabletopMapSync(
  campaignId: string,
  getToken: () => Promise<string>,
  isGM: boolean
) {
  const queryClient = useQueryClient();
  const { send } = useTabletopMapParty(campaignId, getToken, (msg) => {
    // Defense-in-depth against GM-only data reaching player clients: drawings are
    // a GM-only feature and hidden tokens must never land in a player's cache
    // (readable via devtools even if not rendered). The party already gates
    // these by sender role; this drops them on the receiving side too.
    if (!isGM) {
      if (msg.type.startsWith('drawing:')) return;
      if (
        (msg.type === 'token:added' || msg.type === 'token:updated') &&
        msg.token.hiddenFromPlayers
      ) {
        return;
      }
    }
    if (msg.type === 'map:active-changed') {
      // Invalidate every tab's active-map query (cheap; only the visible tab refetches).
      queryClient.invalidateQueries({ queryKey: queryKeys.maps.activeAll(campaignId) });
      return;
    }
    if (msg.type === 'token:added') {
      applyTokenAddToCache(queryClient, campaignId, msg.mapId, msg.token);
    } else if (msg.type === 'token:moved') {
      applyTokenMoveToCache(queryClient, campaignId, msg.mapId, msg.tokenId, msg.x, msg.y);
    } else if (msg.type === 'token:removed') {
      applyTokenRemoveFromCache(queryClient, campaignId, msg.mapId, msg.tokenId);
    } else if (msg.type === 'token:updated') {
      applyTokenUpdateToCache(queryClient, campaignId, msg.mapId, msg.token);
    } else if (msg.type === 'text:added') {
      applyTextAddToCache(queryClient, campaignId, msg.mapId, msg.text);
    } else if (msg.type === 'text:moved') {
      applyTextMoveToCache(queryClient, campaignId, msg.mapId, msg.textId, msg.x, msg.y);
    } else if (msg.type === 'text:updated') {
      applyTextUpdateToCache(queryClient, campaignId, msg.mapId, msg.text);
    } else if (msg.type === 'text:removed') {
      applyTextRemoveFromCache(queryClient, campaignId, msg.mapId, msg.textId);
    } else if (msg.type === 'drawing:added') {
      applyDrawingAddToCache(queryClient, campaignId, msg.mapId, msg.drawing);
    } else if (msg.type === 'drawing:updated') {
      applyDrawingUpdateToCache(queryClient, campaignId, msg.mapId, msg.drawing);
    } else if (msg.type === 'drawing:moved') {
      applyDrawingGeomToCache(queryClient, campaignId, msg.mapId, msg.drawingId, {
        x: msg.x,
        y: msg.y,
        width: msg.width,
        height: msg.height,
      });
    } else if (msg.type === 'drawing:removed') {
      applyDrawingRemoveFromCache(queryClient, campaignId, msg.mapId, msg.drawingId);
    } else if (msg.type === 'drawing:cleared') {
      applyDrawingsClearToCache(queryClient, campaignId, msg.mapId);
    } else if (msg.type === 'aoe:added') {
      // AoE templates are shared (like map text), not GM-gated like drawings —
      // this branch runs for all viewers, including non-GM.
      applyAoeAddToCache(queryClient, campaignId, msg.mapId, msg.aoe);
    } else if (msg.type === 'aoe:removed') {
      applyAoeRemoveFromCache(queryClient, campaignId, msg.mapId, msg.aoeId);
    } else if (msg.type === 'aoe:cleared') {
      applyAoeClearToCache(queryClient, campaignId, msg.mapId);
    }
  });

  return send;
}
