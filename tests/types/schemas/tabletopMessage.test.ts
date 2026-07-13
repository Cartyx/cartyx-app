import { describe, it, expect } from 'vitest';
import { parseTabletopMapMessage } from '~/types/schemas/tabletopMessage';

/**
 * The tabletop-map socket is peer-relayed, so every inbound frame is untrusted.
 * parseTabletopMapMessage is the gate that drops malformed/forged frames before
 * they touch the query cache — this locks in that behavior.
 */
describe('parseTabletopMapMessage', () => {
  it('accepts a well-formed token:moved frame', () => {
    const msg = parseTabletopMapMessage({
      type: 'token:moved',
      mapId: 'm1',
      tokenId: 't1',
      x: 10,
      y: 20,
      final: true,
    });
    expect(msg).toMatchObject({ type: 'token:moved', tokenId: 't1', x: 10, y: 20, final: true });
  });

  const fullToken = {
    id: 'k1',
    mapId: 'm1',
    campaignId: 'c1',
    sourceCollection: 'monster',
    sourceDocumentId: 'doc1',
    ownerUserId: null,
    x: 1,
    y: 2,
    sizeSquares: 1,
    instanceNumber: null,
    color: '#fff',
    label: 'Goblin',
    imageUrl: '',
    labelVisible: true,
    hiddenFromPlayers: true,
    zIndex: 0,
    createdAt: '2026-06-15T00:00:00Z',
    updatedAt: '2026-06-15T00:00:00Z',
  };
  const fullDrawing = {
    id: 'd1',
    mapId: 'm1',
    campaignId: 'c1',
    kind: 'rect',
    color: '#f00',
    strokeWidth: 2,
    filled: false,
    points: [],
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdBy: 'u1',
    createdAt: '2026-06-15T00:00:00Z',
    updatedAt: '2026-06-15T00:00:00Z',
  };
  const fullAoe = {
    id: 'a1',
    mapId: 'm1',
    campaignId: 'c1',
    shape: 'cone',
    originX: 5,
    originY: 5,
    sizePx: 100,
    rotation: 0,
    color: '#f00',
    createdBy: 'u1',
    createdAt: '2026-06-15T00:00:00Z',
    updatedAt: '2026-06-15T00:00:00Z',
  };

  it('accepts entity-bearing frames carrying a fully-shaped payload', () => {
    expect(
      parseTabletopMapMessage({ type: 'drawing:added', mapId: 'm1', drawing: fullDrawing })
    ).not.toBeNull();
    expect(
      parseTabletopMapMessage({ type: 'token:added', mapId: 'm1', token: fullToken })
    ).not.toBeNull();
  });

  it('rejects entity-bearing frames with an incomplete payload', () => {
    // A forged/buggy frame whose entity is missing required fields must not seed
    // the cache with a partial object that later crashes render code.
    expect(
      parseTabletopMapMessage({ type: 'token:added', mapId: 'm1', token: { id: 'k1' } })
    ).toBeNull();
    const noHidden: Record<string, unknown> = { ...fullToken };
    delete noHidden.hiddenFromPlayers;
    expect(
      parseTabletopMapMessage({ type: 'token:updated', mapId: 'm1', token: noHidden })
    ).toBeNull();
    expect(
      parseTabletopMapMessage({ type: 'drawing:added', mapId: 'm1', drawing: { id: 'd1' } })
    ).toBeNull();
  });

  it('accepts a well-formed aoe:added frame (shared, not GM-gated)', () => {
    // AoE templates are broadcast to all viewers (like map text), unlike
    // drawings which are dropped for non-GM receivers — see
    // useTabletopMapSync's inbound reducer.
    const msg = parseTabletopMapMessage({ type: 'aoe:added', mapId: 'm1', aoe: fullAoe });
    expect(msg).toMatchObject({ type: 'aoe:added', mapId: 'm1', aoe: fullAoe });
  });

  it('accepts aoe:removed and aoe:cleared frames', () => {
    expect(
      parseTabletopMapMessage({ type: 'aoe:removed', mapId: 'm1', aoeId: 'a1' })
    ).not.toBeNull();
    expect(parseTabletopMapMessage({ type: 'aoe:cleared', mapId: 'm1' })).not.toBeNull();
  });

  it('rejects a malformed aoe:added frame', () => {
    // Missing required fields (shape, sizePx, rotation, etc).
    expect(
      parseTabletopMapMessage({ type: 'aoe:added', mapId: 'm1', aoe: { id: 'a1' } })
    ).toBeNull();
    // Invalid shape enum value.
    const badShape = { ...fullAoe, shape: 'triangle' };
    expect(parseTabletopMapMessage({ type: 'aoe:added', mapId: 'm1', aoe: badShape })).toBeNull();
    // Non-finite originX.
    const badOrigin = { ...fullAoe, originX: Infinity };
    expect(parseTabletopMapMessage({ type: 'aoe:added', mapId: 'm1', aoe: badOrigin })).toBeNull();
    // Missing aoeId on aoe:removed.
    expect(parseTabletopMapMessage({ type: 'aoe:removed', mapId: 'm1' })).toBeNull();
  });

  it('accepts map:active-changed with null mapId', () => {
    expect(
      parseTabletopMapMessage({ type: 'map:active-changed', mapId: null, screenId: null })
    ).not.toBeNull();
  });

  it('rejects unknown / missing types', () => {
    expect(parseTabletopMapMessage({ type: 'token:teleport', mapId: 'm1' })).toBeNull();
    expect(parseTabletopMapMessage({ mapId: 'm1' })).toBeNull();
    expect(parseTabletopMapMessage(null)).toBeNull();
    expect(parseTabletopMapMessage('drawing:cleared')).toBeNull();
  });

  it('rejects frames missing required fields or with wrong types', () => {
    // Missing tokenId
    expect(parseTabletopMapMessage({ type: 'token:moved', mapId: 'm1', x: 1, y: 2 })).toBeNull();
    // Non-numeric / non-finite coordinates
    expect(
      parseTabletopMapMessage({ type: 'token:moved', mapId: 'm1', tokenId: 't1', x: '1', y: 2 })
    ).toBeNull();
    expect(
      parseTabletopMapMessage({
        type: 'drawing:moved',
        mapId: 'm1',
        drawingId: 'd1',
        x: Infinity,
        y: 0,
        width: 1,
        height: 1,
      })
    ).toBeNull();
    // Entity without an id
    expect(parseTabletopMapMessage({ type: 'drawing:added', mapId: 'm1', drawing: {} })).toBeNull();
    // Empty mapId
    expect(parseTabletopMapMessage({ type: 'drawing:cleared', mapId: '' })).toBeNull();
  });
});
