import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { AudioPackageData } from '~/types/soundboard';
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

const { useSoundboard, SAVE_FLUSH_MS, SAVE_SETTLE_MS, pickRendition } =
  await import('~/hooks/useSoundboard');

const CAMPAIGN = '507f1f77bcf86cd799439011';
const ASSET_A = '507f1f77bcf86cd799439021';
const ASSET_B = '507f1f77bcf86cd799439022';

const pkg: AudioPackageData = {
  id: '507f1f77bcf86cd799439031',
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

type FakeCtx = {
  state: AudioContextState;
  currentTime: number;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
};

function makeCtx(): FakeCtx {
  const ctx: FakeCtx = {
    state: 'suspended',
    currentTime: 0,
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as unknown as AudioBuffer),
  };
  return ctx;
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

function render(over: { pkg?: AudioPackageData | null; persist?: boolean } = {}) {
  const result = renderHook(() =>
    useSoundboard(CAMPAIGN, over.pkg === undefined ? pkg : over.pkg, {
      assets: [makeAsset(ASSET_A), makeAsset(ASSET_B)],
      persist: over.persist,
      createAudioContext: () => ctx as unknown as AudioContext,
    })
  );
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  ctx = makeCtx();
  // `vi.clearAllMocks()` clears recorded calls but NOT implementations, so the
  // rejecting `saveBoardStateFn` one test installs would leak into every test
  // after it without this line.
  saveBoardStateFn.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSoundboard', () => {
  it('does not dispatch audio commands before the context is resumed', () => {
    const { result } = render();

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
    const { result } = render();

    act(() => {
      result.current.dispatch({ type: 'setMood', moodId: 'storm' });
    });
    await act(async () => {
      await result.current.enableAudio();
    });

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(result.current.audioReady).toBe(true);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(lastApplied().moodId).toBe('storm');
    expect(scheduler.sync).toHaveBeenCalled();
  });

  it('sends a dispatched fireOneShot to the engine, and leaves board state untouched', async () => {
    const { result } = render();
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
    const { result } = render();
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
    const { result } = render();
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
    const { result } = render();
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

  it('keeps playing when the save rejects', async () => {
    saveBoardStateFn.mockRejectedValue(new Error('not the GM'));
    const { result } = render();
    await act(async () => {
      await result.current.enableAudio();
    });
    engine.apply.mockClear();

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
    const { result } = render({ pkg: null });
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
    const { result } = render({ persist: false });
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

  it('turns the pad off when the engine reports an item ended', async () => {
    const { result } = render();
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
    const { result } = render();
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

  it('loads the rendition the browser can play and passes durationSamples through unmodified', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = render();
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
    vi.unstubAllGlobals();
  });

  it('returns null for an asset with no usable rendition rather than guessing', async () => {
    const { result } = renderHook(() =>
      useSoundboard(CAMPAIGN, pkg, {
        assets: [makeAsset(ASSET_A, { renditions: {} }), makeAsset(ASSET_B)],
        createAudioContext: () => ctx as unknown as AudioContext,
      })
    );
    await act(async () => {
      await result.current.enableAudio();
    });

    await expect(engineOptions().loadAsset(ASSET_A)).resolves.toBeNull();
    await expect(engineOptions().loadAsset('nope')).resolves.toBeNull();
  });

  it('pickRendition prefers what canPlayType accepts, and never returns null when something exists', () => {
    const both = makeAsset(ASSET_A).renditions;
    const safari = (mime: string) => mime.startsWith('audio/mp4');
    const chrome = (mime: string) => mime.startsWith('audio/ogg');

    expect(pickRendition(both, safari)?.key).toBe('a/main.m4a');
    expect(pickRendition(both, chrome)?.key).toBe('a/main.opus');
    // happy-dom, and any engine that under-reports: still pick something.
    expect(pickRendition(both, () => false)?.key).toBe('a/main.opus');
    expect(pickRendition({}, chrome)).toBeNull();
  });

  it('disposes the scheduler, the engine and the context on unmount', async () => {
    const { result, unmount } = render();
    await act(async () => {
      await result.current.enableAudio();
    });

    unmount();

    expect(scheduler.dispose).toHaveBeenCalledTimes(1);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending save on unmount rather than dropping the last change', async () => {
    const { result, unmount } = render();
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
