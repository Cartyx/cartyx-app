import { describe, it, expect } from 'vitest';
import { storagePrefixFromSourceKey, renditionKeyBase } from '../src/keys.js';

const PREFIX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('storagePrefixFromSourceKey', () => {
  /**
   * Pins the cross-package contract. The app mints source keys in
   * `app/server/functions/uploads.ts` from `audioUserRoot()` and its prefix is
   * 32 lowercase hex characters (`AUDIO_STORAGE_PREFIX_RE` in
   * `app/server/functions/audio-storage.ts`). The two packages cannot import
   * each other, so each pins the shape; if the app's shape changes without this
   * one, every asset fails permanently at the guard in `processAsset`.
   */
  it('reads the prefix the app mints', () => {
    expect(storagePrefixFromSourceKey(`uploads/audio/${PREFIX}/1700000000000-deadbeef.wav`)).toBe(
      PREFIX
    );
  });

  /**
   * Each of these would put renditions somewhere no owner's listing covers, or
   * inside somebody else's namespace. `renditionKeyBase` must refuse them so
   * `processAsset` fails the row instead of writing an unreclaimable object.
   */
  it.each([
    ['uploads/audio/1700000000000-deadbeef.wav', 'the old flat layout'],
    [`uploads/audio/${PREFIX}/nested/file.wav`, 'an extra path segment'],
    ['uploads/audio/renditions/507f1f77bcf86cd799439011.opus', 'the old rendition root'],
    [`uploads/audio/${PREFIX.toUpperCase()}/x.wav`, 'uppercase hex'],
    [`uploads/audio/${PREFIX.slice(0, 31)}/x.wav`, 'a short prefix'],
    [`uploads/images/${PREFIX}/x.wav`, 'a different top-level root'],
    [`uploads/audio/${PREFIX}/`, 'no filename'],
    ['', 'an empty key'],
  ])('refuses %p (%s)', (key) => {
    expect(storagePrefixFromSourceKey(key)).toBeNull();
    expect(renditionKeyBase(key, '507f1f77bcf86cd799439011')).toBeNull();
  });
});

describe('renditionKeyBase', () => {
  /**
   * Renditions live BESIDE their source, inside the same namespace. The app's
   * cleanup lists `uploads/audio/<prefix>/` and reclaims whatever no row
   * references; a rendition outside that prefix appears in no user's listing
   * and is unreclaimable by anyone.
   */
  it("puts renditions inside the source's own namespace", () => {
    expect(renditionKeyBase(`uploads/audio/${PREFIX}/1700000000000-deadbeef.wav`, 'asset-1')).toBe(
      `uploads/audio/${PREFIX}/renditions/asset-1`
    );
  });

  it('derives the namespace from the source, so two owners never share one', () => {
    const other = '0123456789abcdef0123456789abcdef';
    const a = renditionKeyBase(`uploads/audio/${PREFIX}/x.wav`, 'same-id');
    const b = renditionKeyBase(`uploads/audio/${other}/x.wav`, 'same-id');
    expect(a).not.toBe(b);
    expect(a?.startsWith(`uploads/audio/${PREFIX}/`)).toBe(true);
    expect(b?.startsWith(`uploads/audio/${other}/`)).toBe(true);
  });
});
