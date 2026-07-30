import type { SoundboardCommand } from '~/lib/soundboard/commands';
import type { BoardState } from '~/lib/soundboard/reducer';

/** The one command this module is ever allowed to emit. */
type FireOneShotCommand = Extract<SoundboardCommand, { type: 'fireOneShot' }>;

export type CreateSchedulerOptions = {
  /**
   * Called once per random fire, with the exact `fireOneShot` command
   * (`~/lib/soundboard/commands`). Typed narrower than `SoundboardCommand`
   * so this module cannot accidentally emit anything else — but Task 12's
   * `useReducer` dispatch (`(command: SoundboardCommand) => void`) is
   * directly assignable here, since a function that accepts the whole
   * union certainly accepts this narrower slice of it. "Task 12 wires
   * `emit` to dispatch" means literally `createScheduler({ emit: dispatch,
   * ... })`, not a wrapper.
   */
  emit: (command: FireOneShotCommand) => void;
  /**
   * Injected timer functions — a scheduler that reads the global
   * `setTimeout` directly is untestable. Typed off `typeof globalThis.setTimeout`
   * / `typeof globalThis.clearTimeout` so the default (`globalThis.setTimeout`)
   * and vitest's `vi.useFakeTimers()` (which patches those same globals) both
   * satisfy it without a cast, in this DOM (`happy-dom`) test environment.
   *
   * `clearTimeout` is the fourth injected dependency the brief asks about:
   * it is its own dependency, not derived from `setTimeout`, because nothing
   * about a `setTimeout` function value lets you cancel the timer it
   * returned — the handle and the canceling function are two separate
   * capabilities of the host environment.
   */
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  /**
   * The other injectable, per the brief's own prompt: a scheduler that reads
   * `Math.random()` directly cannot be tested for "reschedules with a fresh
   * random interval" (there is no way to observe two DIFFERENT delays from
   * an uncontrolled source) or for "fires within the resolved interval"
   * (there is no way to pin the fire to an exact instant). Defaults to
   * `Math.random`. `reducer.ts` forbids `Math.random()` because the reducer
   * must be pure; this module is deliberately not the reducer — it is the
   * one place in the board's code that is ALLOWED to be nondeterministic,
   * provided the nondeterminism itself is swappable.
   */
  random?: () => number;
};

export type Scheduler = {
  /**
   * Reconcile pending timers against a `BoardState` snapshot. Call this
   * whenever board state changes — a mood switch, a volume nudge, a fresh
   * package load.
   *
   * Idempotent in the sense that matters for a live tool: an item that
   * already has a pending timer and still qualifies (`playing` AND both
   * `randomIntervalMin`/`Max` defined) keeps that SAME timer running,
   * untouched. `sync` does not know or care how long ago that timer was
   * started or how much longer it has to run — it only starts a fresh timer
   * for an item that doesn't have one yet, and stops one for an item that no
   * longer qualifies. Restarting on every call would mean a GM dragging a
   * volume slider (which calls `sync` on every change, unrelated to any
   * random-fire item) resets every ambient thunder countdown in the package,
   * and thunder would never fire while the GM is adjusting anything else.
   */
  sync: (state: BoardState) => void;
  /**
   * Clear every pending timer. Required on every package switch / unmount:
   * a leaked timer holds a stale `itemId` closure and, when it eventually
   * fires, emits a `fireOneShot` for an item that may not even exist in the
   * package now loaded — a ghost fire from audio nobody can hear coming from
   * a package nobody has open anymore.
   */
  dispose: () => void;
};

/**
 * The random one-shot scheduler — "thunder goes off occasionally".
 *
 * Owns no audio and no board state of its own; it only watches
 * `BoardState.items` (already resolved per Task 8's `mood ?? item` rule —
 * `randomIntervalMin`/`Max` here are whatever the CURRENT mood says, with no
 * further resolution to do) and emits `{ type: 'fireOneShot', itemId }` on a
 * randomized timer for every item that is both playing and has both interval
 * bounds defined.
 *
 * The GM's browser is the sole authority, by construction: nothing in this
 * module reads from or writes to any shared/networked state, so there is
 * exactly one `createScheduler` instance per GM board (Task 12 owns its
 * lifecycle) and exactly one source of `fireOneShot` commands. Players in
 * phase 2b receive `fireOneShot` broadcasts and never run this module at
 * all — resolving the roadmap's "random triggers must have a single owner"
 * problem by never letting a second owner exist in the first place.
 */
export function createScheduler(options: CreateSchedulerOptions): Scheduler {
  const {
    emit,
    setTimeout: scheduleTimeout = globalThis.setTimeout,
    clearTimeout: cancelTimeout = globalThis.clearTimeout,
    random = Math.random,
  } = options;

  /** One pending timer per qualifying `itemId`. Presence in this map IS the
   * "does this item currently have a timer running" fact `sync` checks. */
  const pending = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
  /** The most recent state `sync` saw — read back when a timer fires, so the
   * reschedule uses whatever the interval is NOW, not what it was when the
   * timer was originally set. */
  let latest: BoardState | null = null;
  let disposed = false;

  function randomDelayMs(min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const seconds = lo + random() * (hi - lo);
    return seconds * 1000;
  }

  function qualifies(item: BoardState['items'][number]): item is BoardState['items'][number] & {
    randomIntervalMin: number;
    randomIntervalMax: number;
  } {
    return (
      item.playing && item.randomIntervalMin !== undefined && item.randomIntervalMax !== undefined
    );
  }

  function armTimer(itemId: string, min: number, max: number): void {
    const handle = scheduleTimeout(() => fire(itemId), randomDelayMs(min, max));
    pending.set(itemId, handle);
  }

  function fire(itemId: string): void {
    if (disposed) return;
    // Defensive: `cancelTimeout` should make this callback unreachable once
    // `sync`/`dispose` has removed the entry, but the check keeps `fire`
    // correct even if a caller's fake-timer implementation doesn't honor
    // cancellation.
    if (!pending.has(itemId)) return;
    pending.delete(itemId);

    // INVARIANT: `emit` must not synchronously call back into `sync` on this
    // same `itemId`. Between the `pending.delete` above and the `armTimer`
    // re-arm below, this item looks not-pending — a reentrant `sync` would
    // see it as qualifying-but-untracked and arm a SECOND timer, and the
    // re-arm below would then overwrite that handle in `pending` via
    // `Map.set`, orphaning the first one where `dispose` can no longer reach
    // it. Not a live bug: React's dispatch/effect scheduling never calls a
    // reducer/subscriber synchronously from inside another dispatch. Holds
    // only because callers keep it true — see Task 12 notes in the report.
    emit({ type: 'fireOneShot', itemId });

    // Reschedule against the CURRENT state, not the state that was live when
    // this timer was armed — the mood (and therefore the interval) may have
    // changed underneath a long-running timer.
    const item = latest?.items.find((candidate) => candidate.itemId === itemId);
    if (!item || !qualifies(item)) return;
    armTimer(itemId, item.randomIntervalMin, item.randomIntervalMax);
  }

  return {
    sync(state: BoardState): void {
      if (disposed) return;
      latest = state;

      const qualifying = new Set<string>();
      for (const item of state.items) {
        if (!qualifies(item)) continue;
        qualifying.add(item.itemId);
        // Already has a timer running: leave it exactly as it is. This is
        // the line that keeps an unrelated state change (volume, a
        // different item's mood override) from resetting this item's
        // countdown.
        if (pending.has(item.itemId)) continue;
        armTimer(item.itemId, item.randomIntervalMin, item.randomIntervalMax);
      }

      for (const [itemId, handle] of pending) {
        if (qualifying.has(itemId)) continue;
        cancelTimeout(handle);
        pending.delete(itemId);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const handle of pending.values()) cancelTimeout(handle);
      pending.clear();
      latest = null;
    },
  };
}
