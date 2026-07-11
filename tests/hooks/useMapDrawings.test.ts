import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '~/utils/queryKeys';
import {
  applyDrawingAddToCache,
  applyDrawingUpdateToCache,
  applyDrawingGeomToCache,
  applyDrawingRemoveFromCache,
  applyDrawingsClearToCache,
} from '~/hooks/useMapDrawings';
import type { MapDrawingData } from '~/types/mapDrawing';

/**
 * Unit coverage for the drawing cache helpers — these are the functions the
 * realtime (party) message handler calls to apply remote changes, so they are
 * the deterministic stand-in for the multiplayer sync path (the realtime
 * service itself is not run by the test harness).
 */

const CID = 'c1';
const MID = 'm1';
const key = queryKeys.mapDrawings.list(CID, MID);

function makeDrawing(id: string, over: Partial<MapDrawingData> = {}): MapDrawingData {
  return {
    id,
    mapId: MID,
    campaignId: CID,
    kind: 'rect',
    color: '#ffffff',
    strokeWidth: 4,
    filled: false,
    points: [],
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdBy: 'gm1',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function list(qc: QueryClient): MapDrawingData[] {
  return qc.getQueryData<MapDrawingData[]>(key) ?? [];
}

describe('useMapDrawings cache helpers (realtime apply path)', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient();
    qc.setQueryData<MapDrawingData[]>(key, []);
  });

  it('add appends and dedupes by id', () => {
    applyDrawingAddToCache(qc, CID, MID, makeDrawing('a'));
    applyDrawingAddToCache(qc, CID, MID, makeDrawing('a')); // duplicate ignored
    applyDrawingAddToCache(qc, CID, MID, makeDrawing('b'));
    expect(list(qc).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('add initializes the list when the cache is empty/undefined', () => {
    const fresh = new QueryClient();
    applyDrawingAddToCache(fresh, CID, MID, makeDrawing('a'));
    expect((fresh.getQueryData<MapDrawingData[]>(key) ?? []).map((d) => d.id)).toEqual(['a']);
  });

  it('update replaces only the matching drawing', () => {
    qc.setQueryData<MapDrawingData[]>(key, [
      makeDrawing('a', { color: '#111111' }),
      makeDrawing('b', { color: '#222222' }),
    ]);
    applyDrawingUpdateToCache(qc, CID, MID, makeDrawing('a', { color: '#aa00aa' }));
    expect(list(qc).find((d) => d.id === 'a')!.color).toBe('#aa00aa');
    expect(list(qc).find((d) => d.id === 'b')!.color).toBe('#222222');
  });

  it('geom patches only geometry fields (lightweight live-move)', () => {
    qc.setQueryData<MapDrawingData[]>(key, [
      makeDrawing('a', { x: 0, y: 0, width: 10, height: 10, color: '#abcabc' }),
    ]);
    applyDrawingGeomToCache(qc, CID, MID, 'a', { x: 50, y: 60, width: 30, height: 40 });
    const a = list(qc).find((d) => d.id === 'a')!;
    expect([a.x, a.y, a.width, a.height]).toEqual([50, 60, 30, 40]);
    expect(a.color).toBe('#abcabc'); // non-geometry fields untouched
  });

  it('remove drops the matching drawing', () => {
    qc.setQueryData<MapDrawingData[]>(key, [makeDrawing('a'), makeDrawing('b')]);
    applyDrawingRemoveFromCache(qc, CID, MID, 'a');
    expect(list(qc).map((d) => d.id)).toEqual(['b']);
  });

  it('clear empties the list', () => {
    qc.setQueryData<MapDrawingData[]>(key, [makeDrawing('a'), makeDrawing('b')]);
    applyDrawingsClearToCache(qc, CID, MID);
    expect(list(qc)).toEqual([]);
  });

  it('helpers are no-ops on an unseeded query (no crash)', () => {
    const fresh = new QueryClient();
    expect(() => applyDrawingUpdateToCache(fresh, CID, MID, makeDrawing('a'))).not.toThrow();
    expect(() => applyDrawingGeomToCache(fresh, CID, MID, 'a', { x: 1 })).not.toThrow();
    expect(() => applyDrawingRemoveFromCache(fresh, CID, MID, 'a')).not.toThrow();
  });
});
