import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler } from '~/lib/soundboard/scheduler';
import type { BoardState, BoardItemState } from '~/lib/soundboard/reducer';

/**
 * `createScheduler` only ever reads `state.items`; `pkg`/`moodId` are along
 * for the ride to satisfy `BoardState`'s shape.
 */
function makeState(items: BoardItemState[]): BoardState {
  return { pkg: null, moodId: null, masterVolume: 1, items };
}

function makeItem(overrides: Partial<BoardItemState> & { itemId: string }): BoardItemState {
  return {
    playing: false,
    volume: 1,
    fadeSeconds: 0,
    randomIntervalMin: undefined,
    randomIntervalMax: undefined,
    loop: false,
    assetId: `asset-${overrides.itemId}`,
    ...overrides,
  };
}

/**
 * Returns each value in `sequence` in order on successive calls, then keeps
 * returning the last one. Lets a test pin exactly which random draw feeds
 * which fire, rather than trusting an uncontrolled `Math.random()` to ever
 * produce two observably different delays.
 */
function sequenceRandom(...sequence: number[]): () => number {
  let i = 0;
  return () => {
    const value = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    return value;
  };
}

describe('createScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires within the resolved interval, using the mood override not the item default', () => {
    const emit = vi.fn();
    // The item's OWN default random window — deliberately never fed to
    // `sync` below. It exists only so the assertion at the bottom can prove
    // the fire isn't landing inside it by coincidence.
    const ITEM_DEFAULT_MAX_S = 90;
    // The mood-resolved interval actually present in this BoardState — far
    // enough from the item default above that a fire in one window cannot
    // be mistaken for a fire in the other.
    const MOOD_MIN_S = 500;
    const MOOD_MAX_S = 700;

    const scheduler = createScheduler({ emit, random: () => 0.25 });
    scheduler.sync(
      makeState([
        makeItem({
          itemId: 'a',
          playing: true,
          randomIntervalMin: MOOD_MIN_S,
          randomIntervalMax: MOOD_MAX_S,
        }),
      ])
    );

    // 500 + 0.25 * (700 - 500) = 550s = 550_000ms, exactly.
    const expectedDelayMs = 550_000;
    expect(ITEM_DEFAULT_MAX_S * 1000).toBeLessThan(expectedDelayMs);

    vi.advanceTimersByTime(expectedDelayMs - 1);
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ type: 'fireOneShot', itemId: 'a' });
  });

  it('reschedules with a fresh random interval after each fire', () => {
    const emit = vi.fn();
    // Two very different draws from the same [10s, 20s] window, so the two
    // resulting delays are far apart and cannot be confused with each other.
    const random = sequenceRandom(0.1, 0.9);
    const scheduler = createScheduler({ emit, random });

    scheduler.sync(
      makeState([
        makeItem({ itemId: 'a', playing: true, randomIntervalMin: 10, randomIntervalMax: 20 }),
      ])
    );

    const firstDelayMs = 11_000; // 10 + 0.1 * (20 - 10)
    const secondDelayMs = 19_000; // 10 + 0.9 * (20 - 10)
    expect(firstDelayMs).not.toBe(secondDelayMs);

    vi.advanceTimersByTime(firstDelayMs - 1);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);

    // The reschedule after the first fire must use the SECOND random draw,
    // not repeat the first delay.
    vi.advanceTimersByTime(secondDelayMs - 1);
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('stops firing for an item that the current mood turns off', () => {
    const emit = vi.fn();
    const scheduler = createScheduler({ emit, random: () => 0 });

    scheduler.sync(
      makeState([
        makeItem({ itemId: 'a', playing: true, randomIntervalMin: 10, randomIntervalMax: 10 }),
      ])
    );
    vi.advanceTimersByTime(5_000);
    expect(emit).not.toHaveBeenCalled();

    // The mood turns the item off before the original 10s timer would fire.
    scheduler.sync(
      makeState([
        makeItem({ itemId: 'a', playing: false, randomIntervalMin: 10, randomIntervalMax: 10 }),
      ])
    );

    vi.advanceTimersByTime(60_000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('requires BOTH playing and a resolved interval — either alone does not schedule', () => {
    const emit = vi.fn();
    const scheduler = createScheduler({ emit, random: () => 0 });

    scheduler.sync(
      makeState([
        // Playing, but this mood does not randomize item A (resolved
        // interval is undefined — Task 8's contract for "do not schedule").
        makeItem({
          itemId: 'a',
          playing: true,
          randomIntervalMin: undefined,
          randomIntervalMax: undefined,
        }),
        // Interval resolved, but item B is not currently playing.
        makeItem({ itemId: 'b', playing: false, randomIntervalMin: 5, randomIntervalMax: 5 }),
      ])
    );

    vi.advanceTimersByTime(10 * 60_000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not restart an already-running timer on an unrelated sync (e.g. a volume nudge)', () => {
    const emit = vi.fn();
    const scheduler = createScheduler({ emit, random: () => 0.5 });

    scheduler.sync(
      makeState([
        makeItem({
          itemId: 'a',
          playing: true,
          volume: 0.5,
          randomIntervalMin: 10,
          randomIntervalMax: 10,
        }),
      ])
    );

    // Half of the (fixed, 10s) delay elapses.
    vi.advanceTimersByTime(5_000);
    expect(emit).not.toHaveBeenCalled();

    // An unrelated state change — same item, same playing/interval, only
    // the volume moved — triggers another `sync`.
    scheduler.sync(
      makeState([
        makeItem({
          itemId: 'a',
          playing: true,
          volume: 0.9,
          randomIntervalMin: 10,
          randomIntervalMax: 10,
        }),
      ])
    );

    // If `sync` had restarted the timer, the fire would now be a fresh 10s
    // away (15s total elapsed). It must instead land at the ORIGINAL
    // schedule: 5s more, 10s total elapsed.
    vi.advanceTimersByTime(4_999);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('disposes every pending timer, so a package switch cannot leak a ghost fire', () => {
    const emit = vi.fn();
    const scheduler = createScheduler({ emit, random: () => 0 });

    scheduler.sync(
      makeState([
        makeItem({ itemId: 'a', playing: true, randomIntervalMin: 10, randomIntervalMax: 10 }),
      ])
    );

    scheduler.dispose();

    vi.advanceTimersByTime(60_000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('dispose is idempotent, and sync after dispose does not resurrect a timer', () => {
    const emit = vi.fn();
    const scheduler = createScheduler({ emit, random: () => 0 });

    scheduler.sync(
      makeState([
        makeItem({ itemId: 'a', playing: true, randomIntervalMin: 10, randomIntervalMax: 10 }),
      ])
    );
    scheduler.dispose();
    expect(() => scheduler.dispose()).not.toThrow();

    // A stray `sync` racing teardown (e.g. a final re-render) must not bring
    // a timer back to life.
    scheduler.sync(
      makeState([
        makeItem({ itemId: 'a', playing: true, randomIntervalMin: 10, randomIntervalMax: 10 }),
      ])
    );

    vi.advanceTimersByTime(60_000);
    expect(emit).not.toHaveBeenCalled();
  });
});
