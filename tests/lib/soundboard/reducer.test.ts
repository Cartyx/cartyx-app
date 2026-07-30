import { describe, it, expect } from 'vitest';
import { boardReducer, initialBoardState } from '~/lib/soundboard/reducer';
import type { SoundboardCommand } from '~/lib/soundboard/commands';
import type { AudioPackageData, PackageItemData, MoodData } from '~/types/soundboard';

// Two items so `setMood` tests can prove the reducer resolves EVERY item in
// the package, not only the ones a given mood names. Their defaults
// deliberately differ from every mood override used below — a fixture where
// mood and item agree can't distinguish "inherited" from "overridden to the
// same number" (same trap Task 8's tests avoided).
const itemA: PackageItemData = {
  id: 'a',
  assetId: 'asset-a',
  volume: 0.8,
  fadeSeconds: 2,
  loop: true,
  randomIntervalMin: 30,
  randomIntervalMax: 90,
  sortIndex: 0,
};

const itemB: PackageItemData = {
  id: 'b',
  assetId: 'asset-b',
  volume: 0.5,
  fadeSeconds: 1,
  loop: false,
  sortIndex: 1,
};

// `storm` names both items, so switching TO it can leave both playing.
const stormMood: MoodData = {
  id: 'storm',
  name: 'Storm',
  states: [
    { itemId: 'a', playing: true, volume: 0.3 },
    { itemId: 'b', playing: true, volume: 0.4 },
  ],
};

// `calm` names only item A. It is the mood a "resolve only named items" bug
// cannot pass against: item B, left playing by `storm`, must be silenced by
// switching to a mood that never mentions it.
const calmMood: MoodData = {
  id: 'calm',
  name: 'Calm',
  states: [{ itemId: 'a', playing: true, volume: 0.2 }],
};

const pkg: AudioPackageData = {
  id: 'pkg1',
  ownerId: 'user1',
  name: 'Test Package',
  description: null,
  items: [itemA, itemB],
  moods: [stormMood, calmMood],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// A second, distinct package for `loadPackage` (package-switch) tests.
const itemC: PackageItemData = {
  id: 'c',
  assetId: 'asset-c',
  volume: 0.6,
  fadeSeconds: 3,
  loop: true,
  sortIndex: 0,
};

const pkg2: AudioPackageData = {
  id: 'pkg2',
  ownerId: 'user1',
  name: 'Second Package',
  description: null,
  items: [itemC],
  moods: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('boardReducer', () => {
  it('setMood resolves every item, not just the ones the mood names', () => {
    // Bug this catches: iterating `mood.states` instead of `pkg.items`
    // leaves item B (absent from `calm`'s states) still playing from the
    // previous mood — the most audible possible bug in a live tool.
    let state = initialBoardState(pkg);
    state = boardReducer(state, { type: 'setMood', moodId: 'storm' });
    expect(state.items.find((i) => i.itemId === 'b')?.playing).toBe(true);

    state = boardReducer(state, { type: 'setMood', moodId: 'calm' });
    const itemBAfter = state.items.find((i) => i.itemId === 'b');
    expect(itemBAfter?.playing).toBe(false);
    // Item A, which `calm` does name, should reflect calm's own override —
    // proving this isn't just "everything got wiped".
    expect(state.items.find((i) => i.itemId === 'a')?.playing).toBe(true);
    expect(state.items.find((i) => i.itemId === 'a')?.volume).toBe(0.2);
  });

  it('loadPackage swaps the package but preserves masterVolume', () => {
    // Regression test for a review finding: `loadPackage` used to return
    // `initialBoardState(command.pkg)` directly, which resets masterVolume
    // to DEFAULT_VOLUME. masterVolume is a board/output property, not a
    // package property — a GM who dialed master down to 0.4 must not get
    // full volume on the next pad after switching packages.
    let state = initialBoardState(pkg);
    state = boardReducer(state, { type: 'setMasterVolume', volume: 0.4 });
    state = boardReducer(state, { type: 'setMood', moodId: 'storm' });

    state = boardReducer(state, { type: 'loadPackage', pkg: pkg2 });

    expect(state.pkg).toBe(pkg2);
    expect(state.moodId).toBeNull();
    expect(state.masterVolume).toBe(0.4);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].itemId).toBe('c');
    expect(state.items[0].playing).toBe(false);
  });

  it('setMood with an unknown moodId leaves the board unchanged', () => {
    let state = initialBoardState(pkg);
    state = boardReducer(state, { type: 'setMood', moodId: 'storm' });

    const result = boardReducer(state, { type: 'setMood', moodId: 'does-not-exist' });

    // A 2b client on a stale package must ignore a moodId it doesn't
    // recognize, not silence every item (which is what would happen if the
    // reducer resolved an undefined `mood` the same way it resolves an
    // explicit "no mood").
    expect(result).toBe(state);
  });

  it('play then stop turns an item back off without touching its volume', () => {
    let state = initialBoardState(pkg);
    state = boardReducer(state, { type: 'setMood', moodId: 'storm' });
    expect(state.items.find((i) => i.itemId === 'a')?.playing).toBe(true);

    state = boardReducer(state, { type: 'stop', itemId: 'a' });

    const itemAAfter = state.items.find((i) => i.itemId === 'a');
    expect(itemAAfter?.playing).toBe(false);
    expect(itemAAfter?.volume).toBe(0.3); // storm's override, unchanged by stop
  });

  it('setMasterVolume sets masterVolume exactly', () => {
    const state = boardReducer(initialBoardState(pkg), { type: 'setMasterVolume', volume: 0.55 });
    expect(state.masterVolume).toBe(0.55);
  });

  it('fireOneShot does not modify board state', () => {
    let state = initialBoardState(pkg);
    state = boardReducer(state, { type: 'setMood', moodId: 'storm' });

    const result = boardReducer(state, { type: 'fireOneShot', itemId: 'a' });

    // A random ambient fire is transient — it must not even allocate a new
    // object, since Task 12 debounces `saveBoardStateFn` off state changes.
    expect(result).toBe(state);
  });

  it('stopAll leaves the package and mood loaded', () => {
    let state = initialBoardState(pkg);
    state = boardReducer(state, { type: 'setMood', moodId: 'storm' });
    const pkgBefore = state.pkg;
    const moodIdBefore = state.moodId;

    state = boardReducer(state, { type: 'stopAll' });

    expect(state.pkg).toBe(pkgBefore);
    expect(state.moodId).toBe(moodIdBefore);
    expect(state.items.every((i) => !i.playing)).toBe(true);
  });

  it('setItemVolume on a non-playing item persists for when it starts', () => {
    // No mood selected: every item resolves to not-playing.
    let state = initialBoardState(pkg);
    expect(state.items.find((i) => i.itemId === 'b')?.playing).toBe(false);

    state = boardReducer(state, { type: 'setItemVolume', itemId: 'b', volume: 0.9 });

    const itemB2 = state.items.find((i) => i.itemId === 'b');
    expect(itemB2?.playing).toBe(false);
    expect(itemB2?.volume).toBe(0.9);
  });

  it('is pure — the same command twice yields deep-equal state, and never mutates the input', () => {
    const s = initialBoardState(pkg);
    // Snapshot BEFORE either call. If the reducer mutates its argument, `s`
    // itself will drift from this snapshot even if the mutation happens to
    // be idempotent (which `a`/`b` deep-equality alone would not catch).
    const snapshotBefore = structuredClone(s);

    const a = boardReducer(s, { type: 'play', itemId: 'a' });
    const b = boardReducer(s, { type: 'play', itemId: 'a' });

    expect(a).toEqual(b);
    expect(s).toEqual(snapshotBefore);
  });

  it('is pure for every command in the vocabulary, not just play', () => {
    // The single-command test above only exercises `play`. A mutating
    // `setMood`, `stopAll` or `setItemVolume` branch (each of which maps
    // over `state.items` and could mutate in place instead of copying)
    // would pass that test undetected. Loop the same snapshot-before /
    // deep-equal-after check over one instance of every command type.
    const allCommands: SoundboardCommand[] = [
      { type: 'loadPackage', pkg: pkg2 },
      { type: 'setMood', moodId: 'storm' },
      { type: 'play', itemId: 'a' },
      { type: 'stop', itemId: 'a' },
      { type: 'fireOneShot', itemId: 'a' },
      { type: 'setItemVolume', itemId: 'a', volume: 0.5 },
      { type: 'setMasterVolume', volume: 0.5 },
      { type: 'stopAll' },
    ];

    const base = boardReducer(initialBoardState(pkg), { type: 'setMood', moodId: 'storm' });

    for (const command of allCommands) {
      const snapshotBefore = structuredClone(base);

      const a = boardReducer(base, command);
      const b = boardReducer(base, command);

      expect(a).toEqual(b);
      expect(base).toEqual(snapshotBefore);
    }
  });
});

describe('initialBoardState', () => {
  it('does not auto-select a mood and resolves every item to not-playing', () => {
    const state = initialBoardState(pkg);
    expect(state.moodId).toBeNull();
    expect(state.pkg).toBe(pkg);
    expect(state.items).toHaveLength(2);
    expect(state.items.every((i) => !i.playing)).toBe(true);
  });

  it('represents "no package" with a null pkg and an empty item list', () => {
    const state = initialBoardState(null);
    expect(state.pkg).toBeNull();
    expect(state.moodId).toBeNull();
    expect(state.items).toEqual([]);
  });
});
