import { describe, it, expect } from 'vitest';
import { resolveItemState } from '~/lib/soundboard/resolve';
import type { PackageItemData } from '~/types/soundboard';

// Every override used below deliberately differs from the item's own value —
// a fixture where mood and item agree can't distinguish "inherited" from
// "overridden to the same number", and would pass even against a bug that
// applied the wrong field.
const item: PackageItemData = {
  id: 'i1',
  assetId: 'a1',
  volume: 0.8,
  fadeSeconds: 2,
  loop: true,
  randomIntervalMin: 30,
  randomIntervalMax: 90,
  sortIndex: 0,
};

describe('resolveItemState', () => {
  it('inherits every field when the mood overrides nothing', () => {
    expect(resolveItemState(item, { itemId: 'i1', playing: true })).toMatchObject({
      volume: 0.8,
      fadeSeconds: 2,
      randomIntervalMin: 30,
      randomIntervalMax: 90,
      loop: true,
      assetId: 'a1',
      playing: true,
    });
  });

  it('treats an explicit 0 as a value, not as absence', () => {
    // The bug this catches: `moodState.volume || item.volume` yields 0.8
    // here, because 0 is falsy. item.volume (0.8) is truthy and different
    // from 0, so this only passes for the right reason.
    const r = resolveItemState(item, { itemId: 'i1', playing: true, volume: 0 });
    expect(r.volume).toBe(0);
  });

  it('treats an explicit false the same way', () => {
    const r = resolveItemState(item, { itemId: 'i1', playing: false });
    expect(r.playing).toBe(false);
  });

  it('lets one item fire at different rates in different moods', () => {
    const overhead = resolveItemState(item, { itemId: 'i1', playing: true });
    const distant = resolveItemState(item, {
      itemId: 'i1',
      playing: true,
      randomIntervalMin: 180,
      randomIntervalMax: 300,
    });
    expect(overhead.randomIntervalMin).toBe(30);
    expect(distant.randomIntervalMin).toBe(180);
  });

  it('resolves to not-playing when the mood omits the item entirely', () => {
    expect(resolveItemState(item, undefined).playing).toBe(false);
  });

  it('overrides only the fields the mood sets, inheriting the rest, in the same call', () => {
    // Per-field independence: a merge implemented as a wholesale object
    // spread (e.g. `{ ...item, ...moodState }`) would still pass the
    // single-field tests above but break here, because moodState lacks a
    // `loop` or `assetId` key at all and only partially overrides the rest.
    const r = resolveItemState(item, { itemId: 'i1', playing: true, volume: 0.3 });
    expect(r.volume).toBe(0.3); // overridden
    expect(r.fadeSeconds).toBe(2); // inherited
    expect(r.randomIntervalMin).toBe(30); // inherited
    expect(r.randomIntervalMax).toBe(90); // inherited
    expect(r.loop).toBe(true); // inherited (mood has no loop override at all)
    expect(r.assetId).toBe('a1'); // inherited (mood never carries assetId)
  });

  it('resolves undefined randomIntervalMin/Max when neither item nor mood sets them', () => {
    const noRandom: PackageItemData = {
      ...item,
      randomIntervalMin: undefined,
      randomIntervalMax: undefined,
    };
    const r = resolveItemState(noRandom, { itemId: 'i1', playing: true });
    expect(r.randomIntervalMin).toBeUndefined();
    expect(r.randomIntervalMax).toBeUndefined();
  });
});
