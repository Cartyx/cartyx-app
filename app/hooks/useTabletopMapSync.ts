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

/**
 * Subscribes to the campaign's tabletop-map party and applies inbound
 * token/text/drawing/active-map messages to the TanStack Query cache (the
 * counterpart to ActiveMapStage's outbound broadcasts). Returns `send` for
 * broadcasting local changes. Extracted from TabletopView so the realtime
 * inbound reducer lives next to the map cache helpers it uses.
 */
export function useTabletopMapSync(campaignId: string, getToken: () => Promise<string>) {
  const queryClient = useQueryClient();
  const { send } = useTabletopMapParty(campaignId, getToken, (msg) => {
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
    }
  });

  return send;
}
