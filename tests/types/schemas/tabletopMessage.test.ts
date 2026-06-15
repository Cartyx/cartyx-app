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

  it('accepts entity-bearing frames when the entity has a string id', () => {
    expect(
      parseTabletopMapMessage({ type: 'drawing:added', mapId: 'm1', drawing: { id: 'd1' } })
    ).not.toBeNull();
    expect(
      parseTabletopMapMessage({
        type: 'token:added',
        mapId: 'm1',
        token: { id: 'k1', hiddenFromPlayers: true },
      })
    ).not.toBeNull();
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
