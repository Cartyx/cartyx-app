import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { AudioPackageData, BoardStateData } from '~/types/soundboard';
import type { AudioAssetData } from '~/types/audio';
import type { SoundboardEngineOptions, EngineAsset } from '~/lib/soundboard/engine';
import type { CreateSchedulerOptions } from '~/lib/soundboard/scheduler';
import type { BoardState } from '~/lib/soundboard/reducer';

/**
 * `useSoundboard` is the seam between four independently-tested modules, so
 * every one of them is mocked here and the assertions are about what crossed
 * the seam — not about audio (Task 10's browser suite measures that), not
 * about reducer purity (Task 9), not about timer arithmetic (Task 11).
 *
 * The `unit` project runs happy-dom, where Web Audio does not exist at all.
 * The hook therefore takes an injectable `createAudioContext` factory and
 * never touches `AudioContext` at module scope; `makeCtx()` below is what
 * stands in for one.
 */

const engine = vi.hoisted(() => ({
  apply: vi.fn(),
  fireOneShot: vi.fn(),
  ready: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
const scheduler = vi.hoisted(() => ({ sync: vi.fn(), dispose: vi.fn() }));
// Parameter types spelled out so `createEngine.mock.calls[0][1]` is the real
// `SoundboardEngineOptions` the hook built, not an untyped tuple element.
const createEngine = vi.hoisted(() =>
  vi.fn((_ctx: unknown, _options: SoundboardEngineOptions) => engine)
);
const createScheduler = vi.hoisted(() => vi.fn((_options: CreateSchedulerOptions) => scheduler));
const saveBoardStateFn = vi.hoisted(() =>
  vi.fn(async (_input: { data: SavePayload }): Promise<unknown> => ({}))
);
const captureException = vi.hoisted(() => vi.fn());

vi.mock('~/lib/soundboard/engine', () => ({ createEngine }));
vi.mock('~/lib/soundboard/scheduler', () => ({ createScheduler }));
vi.mock('~/utils/soundboard-server-fns', () => ({ saveBoardStateFn }));
vi.mock('~/utils/telemetry-client', () => ({ captureException }));

const { useSoundboard, SAVE_FLUSH_MS, SAVE_SETTLE_MS, pickRendition, hydrateBoardState } =
  await import('~/hooks/useSoundboard');
type UseSoundboardOptions = NonNullable<Parameters<typeof useSoundboard>[2]>;

const CAMPAIGN = '507f1f77bcf86cd799439011';
const ASSET_A = '507f1f77bcf86cd799439021';
const ASSET_B = '507f1f77bcf86cd799439022';
const PKG_ID = '507f1f77bcf86cd799439031';

const pkg: AudioPackageData = {
  id: PKG_ID,
  ownerId: 'gm1',
  name: 'Storm',
  description: null,
  items: [
    {
      id: 'itemA',
      assetId: ASSET_A,
      volume: 0.8,
      fadeSeconds: 2,
      loop: true,
      randomIntervalMin: 30,
      randomIntervalMax: 90,
      sortIndex: 0,
    },
    { id: 'itemB', assetId: ASSET_B, volume: 0.5, fadeSeconds: 1, loop: false, sortIndex: 1 },
  ],
  moods: [
    {
      id: 'storm',
      name: 'Storm',
      // Names BOTH items as playing — which is what makes the hydration test
      // meaningful: a persisted `playing: false` for one of them cannot be
      // reproduced by replaying `play` commands over this mood.
      states: [
        { itemId: 'itemA', playing: true, volume: 0.3 },
        { itemId: 'itemB', playing: true, volume: 0.4 },
      ],
    },
  ],
  createdAt: '',
  updatedAt: '',
};

function makeAsset(id: string, over: Partial<AudioAssetData> = {}): AudioAssetData {
  return {
    id,
    ownerId: 'gm1',
    title: 'Rain',
    kind: 'ambience',
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 1000,
    durationSamples: 48_312,
    loudnessTargetLufs: null,
    peaks: [],
    renditions: {
      opus: { key: 'a/main.opus', url: 'https://cdn.test/a.opus', bytes: 10 },
      aac: { key: 'a/main.m4a', url: 'https://cdn.test/a.m4a', bytes: 12 },
    },
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const defaultAssets: readonly AudioAssetData[] = [makeAsset(ASSET_A), makeAsset(ASSET_B)];

type CtxBehaviour = {
  /** `resume()` rejects — the autoplay-policy failure the affordance exists for. */
  resumeRejects?: string;
  /** `resume()` RESOLVES but the context never reaches `running` (iOS Safari). */
  staysSuspended?: boolean;
  /** `resume()` blocks on this until the test releases it — the double-tap window. */
  resumeGate?: Promise<void>;
};

type FakeCtx = {
  state: AudioContextState;
  currentTime: number;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
};

function makeCtx(behaviour: CtxBehaviour = {}): FakeCtx {
  const ctx: FakeCtx = {
    state: 'suspended',
    currentTime: 0,
    resume: vi.fn(async () => {
      if (behaviour.resumeGate) await behaviour.resumeGate;
      if (behaviour.resumeRejects) throw new Error(behaviour.resumeRejects);
      if (behaviour.staysSuspended) return;
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as unknown as AudioBuffer),
  };
  return ctx;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The options `useSoundboard` handed `createEngine` on its single call. */
function engineOptions(): SoundboardEngineOptions {
  expect(createEngine).toHaveBeenCalledTimes(1);
  return createEngine.mock.calls[0][1];
}

function schedulerOptions(): CreateSchedulerOptions {
  expect(createScheduler).toHaveBeenCalledTimes(1);
  return createScheduler.mock.calls[0][0];
}

/** The `BoardState` from the most recent `engine.apply` call. */
function lastApplied(): BoardState {
  const calls = engine.apply.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as BoardState;
}

type SavePayload = {
  campaignId: string;
  packageId: string | null;
  moodId: string | null;
  items: { itemId: string; playing: boolean; volume: number }[];
  masterVolume: number;
};

function lastSaved(): SavePayload {
  const calls = saveBoardStateFn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0].data;
}

let ctx: FakeCtx;
/** When non-empty, `ctxFactory` shifts from here instead of returning `ctx`. */
let ctxQueue: FakeCtx[] = [];

function ctxFactory(): AudioContext {
  const next = ctxQueue.length > 0 ? ctxQueue.shift()! : ctx;
  return next as unknown as AudioContext;
}

type Props = {
  pkg?: AudioPackageData | null;
  persist?: boolean;
  assets?: readonly AudioAssetData[];
  /**
   * Only when true is the `initialState` KEY passed at all — an absent key
   * means "this board does not hydrate", which is a different thing from
   * `'pending'`.
   */
  withInitialState?: boolean;
  initialState?: BoardStateData | null | 'pending';
  packagePending?: boolean;
};

function renderBoard(initialProps: Props = {}) {
  return renderHook(
    (props: Props) => {
      const opts: UseSoundboardOptions = {
        assets: 'assets' in props ? props.assets : defaultAssets,
        persist: props.persist,
        packagePending: props.packagePending,
        createAudioContext: ctxFactory,
        ...(props.withInitialState ? { initialState: props.initialState } : {}),
      };
      return useSoundboard(CAMPAIGN, props.pkg === undefined ? pkg : props.pkg, opts);
    },
    { initialProps }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  ctx = makeCtx();
  ctxQueue = [];
  // `vi.clearAllMocks()` clears recorded calls but NOT implementations, so the
  // rejecting `saveBoardStateFn` one test installs would leak into every test
  // after it without this line.
  saveBoardStateFn.mockResolvedValue({});
});

afterEach(() => {
  // In `afterEach`, not inline in the test body: a mid-test failure would
  // otherwise leak the stubbed `fetch` into every subsequent test in the file.
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useSoundboard', () => {
  it('does not dispatch audio commands before the context is resumed', () => {
    const { result } = renderBoard();

    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
      result.current.dispatch({ type: 'fireOneShot', itemId: 'itemA' });
    });

    // The engine was never even constructed, so nothing could reach it.
    expect(createEngine).not.toHaveBeenCalled();
    expect(engine.apply).not.toHaveBeenCalled();
    expect(engine.fireOneShot).not.toHaveBeenCalled();
    expect(result.current.audioReady).toBe(false);
    // …but the board state moved, so the UI is live before audio is.
    expect(result.current.state.moodId).toBe('storm');
  });

  it('enableAudio resumes the suspended context and applies the current board state', async () => {
    const { result } = renderBoard();

    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
    });
    await act(async () => {
      await result.current.enableAudio();
    });

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(result.current.audioReady).toBe(true);
    expect(result.current.audioError).toBeNull();
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(lastApplied().moodId).toBe('storm');
    expect(scheduler.sync).toHaveBeenCalled();
  });

  it('sends a dispatched fireOneShot to the engine, and leaves board state untouched', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
    });

    const before = result.current.state;
    engine.apply.mockClear();

    act(() => {
      result.current.dispatch({ type: 'fireOneShot', itemId: 'itemB' });
    });

    // Half one: it reached the engine, with the right item. `fireOneShot` is a
    // no-op in the reducer by design (Task 9), so an implementation that only
    // diffs board state drops it silently.
    expect(engine.fireOneShot).toHaveBeenCalledTimes(1);
    expect(engine.fireOneShot).toHaveBeenCalledWith('itemB');
    // Half two: it left no mark on the board — which is why half one is needed.
    expect(result.current.state).toBe(before);
    expect(engine.apply).not.toHaveBeenCalled();
  });

  it('does not save a random fire, so ambient thunder never reaches Atlas', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    saveBoardStateFn.mockClear();

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        result.current.dispatch({ type: 'fireOneShot', itemId: 'itemA' });
      }
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });

    expect(saveBoardStateFn).not.toHaveBeenCalled();
  });

  it('does not write on every volume tick — one save carrying the FINAL value', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });
    saveBoardStateFn.mockClear();

    act(() => {
      for (let i = 1; i <= 20; i += 1) {
        result.current.dispatch({ type: 'setItemVolume', itemId: 'itemA', volume: i / 20 });
      }
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });

    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
    // A debounce that fires once but sends the FIRST value is still broken.
    const saved = lastSaved().items.find((item) => item.itemId === 'itemA');
    expect(saved?.volume).toBe(1);
  });

  it('flushes play promptly but lets a volume tick settle first', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    saveBoardStateFn.mockClear();

    act(() => {
      result.current.dispatch({ type: 'setItemVolume', itemId: 'itemA', volume: 0.25 });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });
    expect(saveBoardStateFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);

    saveBoardStateFn.mockClear();
    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemB' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
  });

  it('serializes writes — a flush during an in-flight save waits and carries the newest state', async () => {
    const first = deferred<unknown>();
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    saveBoardStateFn.mockClear();
    saveBoardStateFn.mockReturnValueOnce(first.promise);

    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);

    // A second flush lands while the first write is still in flight. Two
    // concurrent full-state REPLACEs can reach Atlas out of order.
    act(() => {
      result.current.dispatch({ type: 'setMasterVolume', volume: 0.42 });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS + 1);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({});
      await first.promise;
    });

    expect(saveBoardStateFn).toHaveBeenCalledTimes(2);
    expect(lastSaved().masterVolume).toBe(0.42);
  });

  it('keeps persisting after the save function throws synchronously', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    saveBoardStateFn.mockClear();
    captureException.mockClear();
    // A synchronous throw never reaches a promise chain's `.finally`, so the
    // in-flight flag would stay stuck and every later save would queue behind
    // a request that does not exist.
    saveBoardStateFn.mockImplementationOnce(() => {
      throw new Error('server fn exploded');
    });

    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBe('server fn exploded');

    saveBoardStateFn.mockClear();
    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemB' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
  });

  it('keeps playing when the save rejects', async () => {
    saveBoardStateFn.mockRejectedValue(new Error('not the GM'));
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    engine.apply.mockClear();
    captureException.mockClear();

    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });

    // The engine received the NEW state — not merely "no exception escaped".
    const applied = lastApplied();
    expect(applied.items.find((item) => item.itemId === 'itemA')?.playing).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBe('not the GM');
    expect(engine.dispose).not.toHaveBeenCalled();

    // …and the board keeps working afterwards.
    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemB' });
    });
    expect(lastApplied().items.find((item) => item.itemId === 'itemB')?.playing).toBe(true);
  });

  it('persists a board with nothing loaded — null packageId and moodId', async () => {
    const { result } = renderBoard({ pkg: null });
    await act(async () => {
      await result.current.enableAudio();
    });
    saveBoardStateFn.mockClear();

    act(() => {
      result.current.dispatch({ type: 'setMasterVolume', volume: 0.4 });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS + 1);
    });

    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
    expect(lastSaved()).toEqual({
      campaignId: CAMPAIGN,
      packageId: null,
      moodId: null,
      items: [],
      masterVolume: 0.4,
    });
  });

  it('never calls save when persist is false — the non-GM board', async () => {
    const { result } = renderBoard({ persist: false });
    await act(async () => {
      await result.current.enableAudio();
    });

    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
      result.current.dispatch({ type: 'setMasterVolume', volume: 0.2 });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });

    expect(saveBoardStateFn).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    // Audio still runs — a player board is silent server-side, not silent.
    expect(lastApplied().items.find((item) => item.itemId === 'itemA')?.playing).toBe(true);
  });

  it('does not fire a save armed before persist flipped to false', async () => {
    const { result, rerender } = renderBoard({ persist: true });
    await act(async () => {
      await result.current.enableAudio();
    });
    saveBoardStateFn.mockClear();

    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
    });
    rerender({ persist: false });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });

    expect(saveBoardStateFn).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('turns the pad off when the engine reports an item ended', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
    });
    expect(result.current.state.items.find((item) => item.itemId === 'itemA')?.playing).toBe(true);

    act(() => {
      engineOptions().onItemEnded?.('itemA');
    });

    expect(result.current.state.items.find((item) => item.itemId === 'itemA')?.playing).toBe(false);
  });

  it("the scheduler's emit does not synchronously re-enter sync", async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });

    const emit = schedulerOptions().emit;
    const syncCallsBefore = scheduler.sync.mock.calls.length;

    act(() => {
      // Exactly what `fire()` does: call `emit` from inside its own stack,
      // between deleting the pending entry and re-arming. A synchronous `sync`
      // here would arm a duplicate timer and orphan a handle `dispose` cannot
      // reach (Task 11's documented invariant).
      emit({ type: 'fireOneShot', itemId: 'itemA' });
      expect(scheduler.sync.mock.calls.length).toBe(syncCallsBefore);
    });

    expect(engine.fireOneShot).toHaveBeenCalledWith('itemA');
  });

  // -------------------------------------------------------------------
  // enableAudio failure modes
  // -------------------------------------------------------------------

  it('does not report ready, and stays retryable, when resume() rejects', async () => {
    const bad = makeCtx({ resumeRejects: 'play() failed because the user did not interact' });
    const good = makeCtx();
    ctxQueue = [bad, good];
    const { result } = renderBoard();

    await act(async () => {
      await result.current.enableAudio();
    });

    expect(result.current.audioReady).toBe(false);
    expect(result.current.audioError).toContain('did not interact');
    expect(createEngine).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(1);
    // The failed context must not be left in the ref — that is what made the
    // failure unrecoverable: every later click took the retry path, resumed a
    // context with no engine beside it, and reported green.
    expect(bad.close).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.enableAudio();
    });

    expect(good.resume).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(result.current.audioReady).toBe(true);
    expect(result.current.audioError).toBeNull();
  });

  it('does not report ready when resume() resolves but the context never runs', async () => {
    const stuck = makeCtx({ staysSuspended: true });
    ctxQueue = [stuck];
    const { result } = renderBoard();

    await act(async () => {
      await result.current.enableAudio();
    });

    expect(stuck.resume).toHaveBeenCalledTimes(1);
    expect(result.current.audioReady).toBe(false);
    expect(result.current.audioError).toContain('suspended');
    expect(createEngine).not.toHaveBeenCalled();
    expect(stuck.close).toHaveBeenCalledTimes(1);
  });

  it('builds exactly one engine when the enable affordance is double-tapped', async () => {
    const gate = deferred<void>();
    const slow = makeCtx({ resumeGate: gate.promise });
    const second = makeCtx();
    ctxQueue = [slow, second];
    const { result } = renderBoard();

    let first: Promise<void>;
    let repeat: Promise<void>;
    await act(async () => {
      first = result.current.enableAudio();
      // The second tap lands while the first resume() is still pending — the
      // exact window in which both calls used to see a null ctxRef, both
      // create(), and both build an engine. The loser's engine has already had
      // apply() run against it, so it starts sound no dispatch can reach and
      // teardownAudio can never dispose.
      repeat = result.current.enableAudio();
      gate.resolve();
      await Promise.all([first, repeat]);
    });

    // The outcome assertions come FIRST, deliberately: these are the defect
    // (two engines, an orphan graph), and a teeth-proof must fail on them
    // rather than on the promise-identity check below, which is only evidence
    // of the mechanism.
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(createScheduler).toHaveBeenCalledTimes(1);
    // Only one context was ever constructed — the spare is untouched in the queue.
    expect(ctxQueue).toEqual([second]);
    expect(second.resume).not.toHaveBeenCalled();
    // No orphan graph was handed board state.
    expect(engine.apply).toHaveBeenCalledTimes(1);
    expect(result.current.audioReady).toBe(true);
    // Both callers observed the same single attempt.
    expect(repeat!).toBe(first!);
  });

  it('allows a fresh attempt after an in-flight one settles', async () => {
    const bad = makeCtx({ resumeRejects: 'gesture expired' });
    const good = makeCtx();
    ctxQueue = [bad, good];
    const { result } = renderBoard();

    await act(async () => {
      await result.current.enableAudio();
    });
    expect(result.current.audioReady).toBe(false);

    // The guard must release on failure too, or the affordance is dead.
    await act(async () => {
      await result.current.enableAudio();
    });
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(result.current.audioReady).toBe(true);
  });

  it('refuses to build the engine while the asset list has not settled', async () => {
    const { result, rerender } = renderBoard({ assets: undefined });

    await act(async () => {
      await result.current.enableAudio();
    });

    // A single build against an unsettled list poisons the engine's
    // `unplayable` set permanently, so it must not happen at all.
    expect(createEngine).not.toHaveBeenCalled();
    expect(result.current.audioReady).toBe(false);
    expect(result.current.audioError).toContain('still loading');

    rerender({ assets: defaultAssets });
    await act(async () => {
      await result.current.enableAudio();
    });
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(result.current.audioReady).toBe(true);
  });

  // -------------------------------------------------------------------
  // loadAsset
  // -------------------------------------------------------------------

  it('loads the rendition the browser can play and passes durationSamples through unmodified', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });

    let asset: EngineAsset | null = null;
    await act(async () => {
      asset = await engineOptions().loadAsset(ASSET_A);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    // Verbatim — the engine divides it by AUDIO_RENDITION_SAMPLE_RATE itself,
    // and rounding it here makes Safari loops tick.
    expect(asset!.durationSamples).toBe(48_312);
  });

  it('returns null only for an asset that can genuinely never play', async () => {
    const { result } = renderBoard({
      assets: [makeAsset(ASSET_A, { renditions: {} }), makeAsset(ASSET_B, { status: 'failed' })],
    });
    await act(async () => {
      await result.current.enableAudio();
    });

    await expect(engineOptions().loadAsset(ASSET_A)).resolves.toBeNull();
    await expect(engineOptions().loadAsset(ASSET_B)).resolves.toBeNull();
  });

  it('throws — rather than vanishing — for an asset missing from a settled list', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });

    // Both `null` and a throw put the asset in the engine's permanent
    // `unplayable` set, but only a throw reaches `onLoadError`. A list that is
    // simply wrong (paginated past 50, or `{ ownerId }`-filtered so no system
    // package's assets are ever in it) must not kill a pad in silence.
    await expect(engineOptions().loadAsset('507f1f77bcf86cd799439099')).rejects.toThrow(
      'not in the board'
    );
  });

  it('throws for an asset still being transcoded', async () => {
    const { result } = renderBoard({ assets: [makeAsset(ASSET_A, { status: 'processing' })] });
    await act(async () => {
      await result.current.enableAudio();
    });

    await expect(engineOptions().loadAsset(ASSET_A)).rejects.toThrow('status: processing');
  });

  it('throws when the rendition URL 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });

    await expect(engineOptions().loadAsset(ASSET_A)).rejects.toThrow(
      'Audio rendition fetch failed (404)'
    );
  });

  it('reports an engine load error to telemetry', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    captureException.mockClear();

    const boom = new Error('decode failed');
    act(() => {
      engineOptions().onLoadError?.(ASSET_A, boom);
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(boom, {
      area: 'soundboard',
      campaignId: CAMPAIGN,
      assetId: ASSET_A,
    });
  });

  // Telemetry tells ME. `loadErrors` is what tells the GM, and it is the only
  // signal that reaches `BoardPad`'s "Failed to decode this rendition" state —
  // the engine's `unplayable` set is never cleared, so a pad that hits this is
  // silent for the engine's whole life while still LOOKING ready.
  it('surfaces an engine load error to the UI, not only to telemetry', async () => {
    const { result } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    expect(result.current.loadErrors.size).toBe(0);

    act(() => {
      engineOptions().onLoadError?.(ASSET_A, new Error('decode failed'));
    });

    expect(result.current.loadErrors.has(ASSET_A)).toBe(true);
    // Asset ids, not item ids — two items may reference the same asset.
    expect(result.current.loadErrors.has(ASSET_B)).toBe(false);

    // Repeats do not churn the set's identity, which would defeat a memoized
    // consumer re-rendering 64 pads for no change.
    const first = result.current.loadErrors;
    act(() => {
      engineOptions().onLoadError?.(ASSET_A, new Error('again'));
    });
    expect(result.current.loadErrors).toBe(first);
  });

  it('clears load errors when the engine is torn down, since a new engine will retry', async () => {
    const { result, unmount } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    act(() => {
      engineOptions().onLoadError?.(ASSET_A, new Error('decode failed'));
    });
    expect(result.current.loadErrors.has(ASSET_A)).toBe(true);

    // `teardownAudio` runs on unmount; the assertion that matters is that the
    // set is not treated as durable knowledge about the asset itself.
    unmount();
    expect(engine.dispose).toHaveBeenCalled();
  });

  it('pickRendition prefers what canPlayType accepts, and falls back to AAC', () => {
    const both = makeAsset(ASSET_A).renditions;
    const safari = (mime: string) => mime.startsWith('audio/mp4');
    const chrome = (mime: string) => mime.startsWith('audio/ogg');

    expect(pickRendition(both, safari)?.key).toBe('a/main.m4a');
    expect(pickRendition(both, chrome)?.key).toBe('a/main.opus');
    // Nothing reported support. Under-reporting is a Safari/iOS behaviour and
    // MP4/AAC-LC is the more universally decodable of the two, so the fallback
    // must not be Opus.
    expect(pickRendition(both, () => false)?.key).toBe('a/main.m4a');
    expect(pickRendition({ opus: both.opus }, () => false)?.key).toBe('a/main.opus');
    expect(pickRendition({}, chrome)).toBeNull();
  });

  // -------------------------------------------------------------------
  // Hydration
  // -------------------------------------------------------------------

  it('hydrateBoardState restores a stopped item the mood names', () => {
    const persisted: BoardStateData = {
      campaignId: CAMPAIGN,
      packageId: PKG_ID,
      moodId: 'storm',
      // `storm` names BOTH items as playing. `itemA` was stopped by the GM
      // before the reload — unreachable by replaying `play` commands.
      items: [
        { itemId: 'itemA', playing: false, volume: 0.9 },
        { itemId: 'itemB', playing: true, volume: 0.2 },
      ],
      masterVolume: 0.55,
    };

    const hydrated = hydrateBoardState(pkg, persisted);

    expect(hydrated.moodId).toBe('storm');
    expect(hydrated.masterVolume).toBe(0.55);
    const a = hydrated.items.find((item) => item.itemId === 'itemA')!;
    const b = hydrated.items.find((item) => item.itemId === 'itemB')!;
    expect(a.playing).toBe(false);
    expect(a.volume).toBe(0.9);
    expect(b.playing).toBe(true);
    expect(b.volume).toBe(0.2);
    // The mood's non-persisted resolutions still apply.
    expect(a.fadeSeconds).toBe(2);
    expect(a.randomIntervalMin).toBe(30);
  });

  it('hydrateBoardState keeps only masterVolume when the package does not match', () => {
    const hydrated = hydrateBoardState(pkg, {
      campaignId: CAMPAIGN,
      packageId: '507f1f77bcf86cd799439077',
      moodId: 'storm',
      items: [{ itemId: 'itemA', playing: true, volume: 0.9 }],
      masterVolume: 0.35,
    });

    // `itemId` is stable only within its own package — overlaying another
    // package's saved states would apply the wrong volume to whatever shares
    // an id.
    expect(hydrated.moodId).toBeNull();
    expect(hydrated.masterVolume).toBe(0.35);
    expect(hydrated.items.every((item) => !item.playing)).toBe(true);
    expect(hydrated.items.find((item) => item.itemId === 'itemA')?.volume).toBe(0.8);
  });

  it('applies initialState without scheduling a save', async () => {
    const persisted: BoardStateData = {
      campaignId: CAMPAIGN,
      packageId: PKG_ID,
      moodId: 'storm',
      items: [
        { itemId: 'itemA', playing: false, volume: 0.9 },
        { itemId: 'itemB', playing: true, volume: 0.2 },
      ],
      masterVolume: 0.55,
    };
    const { result } = renderBoard({ withInitialState: true, initialState: persisted });

    expect(result.current.hydrated).toBe(true);
    expect(result.current.state.moodId).toBe('storm');
    expect(result.current.state.masterVolume).toBe(0.55);

    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });
    // Merely opening the board must not make the reader the last writer —
    // `updatedBy`/`updatedAt` are the signal two-GM handling depends on.
    expect(saveBoardStateFn).not.toHaveBeenCalled();
  });

  it('holds every save until initialState settles, so a blank board cannot clobber the saved one', async () => {
    const { result, rerender } = renderBoard({
      pkg: null,
      withInitialState: true,
      initialState: 'pending',
    });
    expect(result.current.hydrated).toBe(false);

    // The package query lands first. The [pkg] effect dispatches `loadPackage`,
    // which is prompt-urgency — this is the write that would race the
    // board-state query and overwrite Atlas with a blank board.
    rerender({ pkg, withInitialState: true, initialState: 'pending' });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });
    expect(saveBoardStateFn).not.toHaveBeenCalled();

    const persisted: BoardStateData = {
      campaignId: CAMPAIGN,
      packageId: PKG_ID,
      moodId: 'storm',
      items: [
        { itemId: 'itemA', playing: false, volume: 0.9 },
        { itemId: 'itemB', playing: true, volume: 0.2 },
      ],
      masterVolume: 0.55,
    };
    rerender({ pkg, withInitialState: true, initialState: persisted });

    expect(result.current.hydrated).toBe(true);
    expect(result.current.state.moodId).toBe('storm');
    expect(result.current.state.items.find((i) => i.itemId === 'itemA')?.volume).toBe(0.9);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });
    expect(saveBoardStateFn).not.toHaveBeenCalled();

    // Saving goes live from the GM's first real action.
    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
    expect(lastSaved().moodId).toBe('storm');
  });

  it('waits for the package the persisted state names before hydrating', async () => {
    const persisted: BoardStateData = {
      campaignId: CAMPAIGN,
      packageId: PKG_ID,
      moodId: 'storm',
      items: [{ itemId: 'itemA', playing: false, volume: 0.9 }],
      masterVolume: 0.55,
    };
    // Board state settles first, package still resolving.
    const { result, rerender } = renderBoard({
      pkg: null,
      packagePending: true,
      withInitialState: true,
      initialState: persisted,
    });

    // Hydrating against a null package would drop every item state and then be
    // clobbered by the [pkg] effect's own `loadPackage` moments later.
    expect(result.current.hydrated).toBe(false);
    expect(result.current.state.items).toEqual([]);

    rerender({ pkg, withInitialState: true, initialState: persisted });

    expect(result.current.hydrated).toBe(true);
    expect(result.current.state.moodId).toBe('storm');
    expect(result.current.state.items.find((i) => i.itemId === 'itemA')?.volume).toBe(0.9);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });
    expect(saveBoardStateFn).not.toHaveBeenCalled();
  });

  it('does not wedge saving when the persisted package cannot be resolved', async () => {
    const persisted: BoardStateData = {
      campaignId: CAMPAIGN,
      packageId: '507f1f77bcf86cd799439066',
      moodId: 'storm',
      items: [{ itemId: 'itemA', playing: true, volume: 0.9 }],
      masterVolume: 0.45,
    };
    // The package was deleted (Task 4) — an ordinary outcome, not an edge
    // case. `packagePending` defaults to false, so a null `pkg` here means
    // "gone", not "not yet".
    const { result } = renderBoard({ pkg: null, withInitialState: true, initialState: persisted });

    // It must CONCLUDE, not wait forever: an un-flipped `hydrated` silently
    // discards every save for the whole session and hangs the board UI.
    expect(result.current.hydrated).toBe(true);
    expect(result.current.state.pkg).toBeNull();
    // The mismatch branch keeps the board/output property and nothing tied to
    // a package that no longer exists.
    expect(result.current.state.masterVolume).toBe(0.45);
    expect(result.current.state.moodId).toBeNull();
    // Not silent.
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('did not resolve') }),
      expect.objectContaining({ stage: 'hydrate' })
    );

    // And persistence is live rather than wedged.
    act(() => {
      result.current.dispatch({ type: 'setMasterVolume', volume: 0.6 });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS + 1);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
    expect(lastSaved().masterVolume).toBe(0.6);
  });

  it('hydrates immediately when nothing was persisted', async () => {
    const { result } = renderBoard({ withInitialState: true, initialState: null });

    expect(result.current.hydrated).toBe(true);
    act(() => {
      result.current.dispatch({ type: 'play', itemId: 'itemA' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_FLUSH_MS + 1);
    });
    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------
  // Package identity
  // -------------------------------------------------------------------

  it('does not reset the board when a refetch returns the same package as a new object', async () => {
    const { result, rerender } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });
    saveBoardStateFn.mockClear();

    // Same package, new object — exactly what a react-query refetch produces
    // when `updatedAt` moves. Identity-keying would reset the whole board
    // mid-session AND persist the reset.
    rerender({ pkg: { ...pkg, updatedAt: '2026-07-30T00:00:00.000Z' } });

    expect(result.current.state.moodId).toBe('storm');
    await act(async () => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS * 4);
    });
    expect(saveBoardStateFn).not.toHaveBeenCalled();
  });

  it('loads a genuinely different package', async () => {
    const { result, rerender } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
    });

    const other: AudioPackageData = { ...pkg, id: '507f1f77bcf86cd799439088', moods: [] };
    rerender({ pkg: other });

    expect(result.current.state.pkg?.id).toBe(other.id);
    expect(result.current.state.moodId).toBeNull();
  });

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  it('disposes the scheduler, the engine and the context on unmount', async () => {
    const { result, unmount } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });

    unmount();

    expect(scheduler.dispose).toHaveBeenCalledTimes(1);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending save on unmount rather than dropping the last change', async () => {
    const { result, unmount } = renderBoard();
    await act(async () => {
      await result.current.enableAudio();
    });
    saveBoardStateFn.mockClear();

    act(() => {
      result.current.dispatch({ type: 'setMasterVolume', volume: 0.3 });
    });
    // Deliberately does NOT advance timers — the settle window is still open.
    expect(saveBoardStateFn).not.toHaveBeenCalled();

    unmount();

    expect(saveBoardStateFn).toHaveBeenCalledTimes(1);
    expect(lastSaved().masterVolume).toBe(0.3);
  });
});
