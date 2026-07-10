import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { verifyBroadcastToken, verifyConnectionToken } from './auth.js';

const SECRET = 'test-secret-at-least-32-characters-long!!';

function sign(claims: Record<string, unknown>, secret = SECRET) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

describe('verifyConnectionToken', () => {
  it('accepts a valid main-party token bound to the room', async () => {
    const token = await sign({ sub: 'user-1', sessionId: 'room-1', role: 'gm' });
    expect(await verifyConnectionToken('main', 'room-1', token, SECRET)).toEqual({
      userId: 'user-1',
      role: 'gm',
    });
  });

  it('defaults role to player when the claim is missing', async () => {
    const token = await sign({ sub: 'user-1', sessionId: 'room-1' });
    expect(await verifyConnectionToken('main', 'room-1', token, SECRET)).toEqual({
      userId: 'user-1',
      role: 'player',
    });
  });

  it('rejects missing token, empty secret, wrong secret, and missing sub', async () => {
    const token = await sign({ sub: 'user-1', sessionId: 'room-1' });
    expect(await verifyConnectionToken('main', 'room-1', null, SECRET)).toBeNull();
    expect(await verifyConnectionToken('main', 'room-1', token, '')).toBeNull();
    expect(await verifyConnectionToken('main', 'room-1', token, undefined)).toBeNull();
    const wrong = await sign(
      { sub: 'user-1', sessionId: 'room-1' },
      'another-secret-32-characters-long!!!!'
    );
    expect(await verifyConnectionToken('main', 'room-1', wrong, SECRET)).toBeNull();
    const noSub = await sign({ sessionId: 'room-1' });
    expect(await verifyConnectionToken('main', 'room-1', noSub, SECRET)).toBeNull();
  });

  it('main party: rejects a sessionId claim that mismatches the room, allows an absent claim', async () => {
    const mismatched = await sign({ sub: 'u', sessionId: 'other-room' });
    expect(await verifyConnectionToken('main', 'room-1', mismatched, SECRET)).toBeNull();
    const noClaim = await sign({ sub: 'u' });
    expect(await verifyConnectionToken('main', 'room-1', noClaim, SECRET)).not.toBeNull();
  });

  it('tabletop party: requires room to be exactly tabletop-<campaignId>', async () => {
    const token = await sign({ sub: 'u', sessionId: 'camp-1' });
    expect(
      await verifyConnectionToken('tabletop', 'tabletop-camp-1', token, SECRET)
    ).not.toBeNull();
    expect(await verifyConnectionToken('tabletop', 'tabletop-camp-2', token, SECRET)).toBeNull();
    const empty = await sign({ sub: 'u' });
    expect(await verifyConnectionToken('tabletop', 'tabletop-', empty, SECRET)).toBeNull();
  });

  it('tabletop_map party: requires room to be exactly tabletop-map-<campaignId>', async () => {
    const token = await sign({ sub: 'u', sessionId: 'camp-1' });
    expect(
      await verifyConnectionToken('tabletop_map', 'tabletop-map-camp-1', token, SECRET)
    ).not.toBeNull();
    expect(
      await verifyConnectionToken('tabletop_map', 'tabletop-camp-1', token, SECRET)
    ).toBeNull();
  });
});

describe('verifyBroadcastToken', () => {
  it('accepts only a bearer token with scope tabletop-broadcast', async () => {
    const good = await sign({ scope: 'tabletop-broadcast' });
    const bad = await sign({ scope: 'other' });
    expect(await verifyBroadcastToken(`Bearer ${good}`, SECRET)).toBe(true);
    expect(await verifyBroadcastToken(`Bearer ${bad}`, SECRET)).toBe(false);
    expect(await verifyBroadcastToken(undefined, SECRET)).toBe(false);
    expect(await verifyBroadcastToken(`Bearer ${good}`, '')).toBe(false);
  });
});
