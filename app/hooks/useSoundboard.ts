import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { createEngine, type EngineAsset, type SoundboardEngine } from '~/lib/soundboard/engine';
import { createScheduler, type Scheduler } from '~/lib/soundboard/scheduler';
import { boardReducer, initialBoardState, type BoardState } from '~/lib/soundboard/reducer';
import type { SoundboardCommand } from '~/lib/soundboard/commands';
import { saveBoardStateFn } from '~/utils/soundboard-server-fns';
import { captureException } from '~/utils/telemetry-client';
import type { AudioPackageData } from '~/types/soundboard';
import type { AudioAssetData, AudioRendition } from '~/types/audio';

/**
 * How long a play/stop/mood/package change waits before it is written. Short:
 * these are discrete, deliberate acts and a reload right after one should not
 * lose it. Not zero — a mood switch produces one command but the GM often
 * chases it with a master nudge, and coalescing the pair costs 200 ms of
 * durability for one fewer Atlas write.
 */
export const SAVE_FLUSH_MS = 200;

/**
 * How long a volume change waits. A slider drag emits a command per frame;
 * this is a true trailing debounce — every tick RESETS the window, so a
 * three-second drag writes once, when it stops, and the value written is the
 * one the GM let go on.
 */
export const SAVE_SETTLE_MS = 800;

/** Ogg/Opus — what `audio-worker` writes as `out.opus` (libopus). Chrome/Firefox. */
const OPUS_MIME = 'audio/ogg; codecs="opus"';
/** MP4/AAC-LC — `out.m4a`. Safari/iOS, which is the entire reason it exists. */
const AAC_MIME = 'audio/mp4; codecs="mp4a.40.2"';

function browserCanPlay(mime: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.createElement('audio');
  if (typeof el.canPlayType !== 'function') return false;
  return el.canPlayType(mime) !== '';
}

/**
 * Pick the rendition this browser can actually decode. Phase 1 emits both
 * precisely for this: Opus is smaller and Chrome/Firefox take it; Safari takes
 * only the AAC.
 *
 * Falls back to whichever rendition EXISTS when neither reports support,
 * rather than returning `null`. That matters more than it looks: the engine
 * caches a `null` return in its `unplayable` set and never asks again for the
 * lifetime of the engine, so a browser that merely under-reports (or an
 * environment with no `canPlayType` at all) would go permanently silent on
 * that pad. `null` is reserved for "there is genuinely nothing to play".
 */
export function pickRendition(
  renditions: { opus?: AudioRendition; aac?: AudioRendition },
  canPlay: (mime: string) => boolean = browserCanPlay
): AudioRendition | null {
  const { opus, aac } = renditions;
  if (opus && canPlay(OPUS_MIME)) return opus;
  if (aac && canPlay(AAC_MIME)) return aac;
  return opus ?? aac ?? null;
}

/** How soon a command's state needs to reach Atlas. */
type SaveUrgency = 'prompt' | 'settle' | 'none';

function saveUrgency(command: SoundboardCommand): SaveUrgency {
  switch (command.type) {
    case 'setItemVolume':
    case 'setMasterVolume':
      return 'settle';
    // A random ambient fire leaves no mark on `BoardState` (see
    // `boardReducer`), so there is nothing to persist — and persisting it
    // anyway is precisely the "every thunder crack writes to Atlas" failure
    // that no-op exists to prevent.
    case 'fireOneShot':
      return 'none';
    default:
      return 'prompt';
  }
}

/**
 * `BoardState` (rich, engine-facing) reduced to `saveBoardStateSchema`'s
 * payload (thin, persistence-facing). `saveBoardState` is a full-state
 * REPLACE, not a patch, so every field goes on every write — there is no
 * merge layer anywhere in this path.
 *
 * `packageId`/`moodId` are `null` for a board with nothing loaded, which is a
 * legal, persistable state (both are nullable in `saveBoardStateSchema` and in
 * the `SoundboardState` model).
 */
function toBoardStatePayload(campaignId: string, state: BoardState) {
  return {
    campaignId,
    packageId: state.pkg?.id ?? null,
    moodId: state.moodId,
    items: state.items.map((item) => ({
      itemId: item.itemId,
      playing: item.playing,
      volume: item.volume,
    })),
    masterVolume: state.masterVolume,
  };
}

export type UseSoundboardOptions = {
  /**
   * The library rows for the assets this package references — where the
   * rendition URLs and `durationSamples` come from. Read live through a ref,
   * so a list that arrives after mount is picked up without remounting.
   */
  assets?: readonly AudioAssetData[];
  /**
   * `false` disables persistence entirely. `saveBoardState` requires the
   * caller to be **GM** (`loadBoardState` only requires membership), so a
   * non-GM board would otherwise emit a guaranteed-rejected write — and a
   * `captureException` — on every command. Audio is unaffected either way.
   * Defaults to `true`.
   */
  persist?: boolean;
  /**
   * Injected so this hook can be imported and tested where Web Audio does not
   * exist (the `unit` project runs happy-dom). Never called at module scope
   * and never called before `enableAudio()`: a context constructed outside a
   * user gesture starts `suspended`, and this is the seam that makes that
   * observable. Defaults to `() => new AudioContext()`.
   */
  createAudioContext?: () => AudioContext;
};

export type UseSoundboardResult = {
  state: BoardState;
  dispatch: (command: SoundboardCommand) => void;
  /** True once the `AudioContext` is running. Until then nothing makes sound. */
  audioReady: boolean;
  /** Must be called from a user gesture — see `createAudioContext` above. */
  enableAudio: () => Promise<void>;
  /**
   * The message from the most recent failed save, or `null`. A failed save
   * NEVER interrupts audio: the engine owns sound and the server is a mirror,
   * so this is a banner for the GM, not an error boundary.
   */
  saveError: string | null;
};

/**
 * The GM board's one stateful seam: reducer + Web Audio engine + random
 * one-shot scheduler + debounced persistence.
 *
 * Three things live here and nowhere else:
 *
 * 1. **The audio gesture.** An `AudioContext` starts suspended. Without
 *    `enableAudio()` on a real click, the GM's first pad press silently does
 *    nothing — the worst possible failure for a live tool. The engine and the
 *    scheduler are therefore constructed INSIDE `enableAudio`, so "nothing
 *    reaches the audio layer before the context is resumed" is structural
 *    rather than a flag anyone has to remember to check.
 * 2. **The debounce.** See `SAVE_FLUSH_MS` / `SAVE_SETTLE_MS`.
 * 3. **Save failures are non-events for audio.** Reported, surfaced, dropped.
 */
export function useSoundboard(
  campaignId: string,
  pkg: AudioPackageData | null,
  options: UseSoundboardOptions = {}
): UseSoundboardResult {
  const [state, rawDispatch] = useReducer(boardReducer, pkg, initialBoardState);
  const [audioReady, setAudioReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  const campaignIdRef = useRef(campaignId);
  const pkgRef = useRef(pkg);
  const mountedRef = useRef(true);

  const ctxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<SoundboardEngine | null>(null);
  const schedulerRef = useRef<Scheduler | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number | null>(null);
  /** True while a `prompt`-urgency flush is already queued. */
  const promptPendingRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
    campaignIdRef.current = campaignId;
  });

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  const runSave = useCallback((): void => {
    timerRef.current = null;
    deadlineRef.current = null;
    promptPendingRef.current = false;

    const id = campaignIdRef.current;
    void saveBoardStateFn({ data: toBoardStatePayload(id, stateRef.current) })
      .then(() => {
        if (mountedRef.current) setSaveError(null);
      })
      .catch((error: unknown) => {
        // The engine keeps playing. This is a mirror falling behind, not an
        // audio failure, and treating it as one would silence a live table.
        captureException(error, { area: 'soundboard', campaignId: id });
        if (mountedRef.current) {
          setSaveError(error instanceof Error ? error.message : String(error));
        }
      });
  }, []);

  const scheduleSave = useCallback(
    (urgency: Exclude<SaveUrgency, 'none'>): void => {
      if (optionsRef.current.persist === false) return;

      const now = Date.now();
      const arm = (delayMs: number, deadline: number) => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        deadlineRef.current = deadline;
        timerRef.current = setTimeout(runSave, delayMs);
      };

      if (urgency === 'settle') {
        // A prompt flush is already queued and will write the WHOLE state,
        // this volume included — pushing its deadline out for a slider drag
        // would delay a play the GM already committed to.
        if (promptPendingRef.current) return;
        arm(SAVE_SETTLE_MS, now + SAVE_SETTLE_MS);
        return;
      }

      // A prompt command is never delayed by a pending settle window; it only
      // ever pulls the deadline earlier.
      const deadline = Math.min(
        deadlineRef.current ?? Number.POSITIVE_INFINITY,
        now + SAVE_FLUSH_MS
      );
      promptPendingRef.current = true;
      arm(Math.max(0, deadline - now), deadline);
    },
    [runSave]
  );

  const flushSaveNow = useCallback((): void => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    runSave();
  }, [runSave]);

  // ---------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------

  const dispatch = useCallback(
    (command: SoundboardCommand): void => {
      // `fireOneShot` goes to the engine DIRECTLY, alongside — not instead of
      // — the reducer. `boardReducer` is a deliberate no-op on it (Task 9:
      // keeping random thunder out of persisted state and off the Atlas write
      // path), which means an effect that diffs board state sees nothing and
      // drops every random fire with the whole suite green.
      if (command.type === 'fireOneShot') engineRef.current?.fireOneShot(command.itemId);

      rawDispatch(command);

      const urgency = saveUrgency(command);
      if (urgency !== 'none') scheduleSave(urgency);
    },
    [scheduleSave]
  );

  // ---------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------

  const loadAsset = useCallback(async (assetId: string): Promise<EngineAsset | null> => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const asset = optionsRef.current.assets?.find((candidate) => candidate.id === assetId);
    if (!asset || asset.status !== 'ready') return null;
    const rendition = pickRendition(asset.renditions);
    if (!rendition) return null;

    const response = await fetch(rendition.url);
    if (!response.ok) throw new Error(`Audio rendition fetch failed (${response.status})`);
    const bytes = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    // `durationSamples` passes through UNMODIFIED: the engine divides it by
    // `AUDIO_RENDITION_SAMPLE_RATE` to compute `loopEnd`, and rounding it
    // anywhere on the way makes Safari loops tick on every repeat.
    return { buffer, durationSamples: asset.durationSamples };
  }, []);

  const enableAudio = useCallback(async (): Promise<void> => {
    const existing = ctxRef.current;
    if (existing) {
      if (existing.state === 'suspended') await existing.resume();
      if (mountedRef.current) setAudioReady(existing.state === 'running');
      return;
    }

    const create = optionsRef.current.createAudioContext ?? (() => new AudioContext());
    const ctx = create();
    ctxRef.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    if (!mountedRef.current) {
      void ctx.close().catch(() => {});
      return;
    }

    const engine = createEngine(ctx, {
      loadAsset,
      // The only signal that playback ended on its own — a one-shot reaching
      // the end of its buffer, or a loop flipped to 1x finishing its pass.
      // Without this the pad stays lit forever.
      onItemEnded: (itemId) => dispatch({ type: 'stop', itemId }),
      onLoadError: (assetId, error) =>
        captureException(error, { area: 'soundboard', campaignId: campaignIdRef.current, assetId }),
    });
    engineRef.current = engine;

    // `emit: dispatch` satisfies the scheduler's reentrancy invariant by
    // construction: `dispatch` calls `engine.fireOneShot` and `rawDispatch`,
    // and NEITHER calls `scheduler.sync`. `sync` is only ever reached from the
    // `[state]` effect below, which React runs after the commit — never
    // synchronously inside `fire()`'s own stack, where a re-entrant `sync`
    // would arm a duplicate timer and orphan a handle `dispose` cannot reach.
    const scheduler = createScheduler({ emit: dispatch });
    schedulerRef.current = scheduler;

    engine.apply(stateRef.current);
    scheduler.sync(stateRef.current);
    setAudioReady(true);
  }, [dispatch, loadAsset]);

  // ---------------------------------------------------------------------
  // Reconciliation and lifecycle
  // ---------------------------------------------------------------------

  useEffect(() => {
    stateRef.current = state;
    // Both are idempotent and are meant to be called together on every state
    // change — `apply` re-reconciles the audio graph, `sync` leaves an
    // already-correct random timer alone.
    engineRef.current?.apply(state);
    schedulerRef.current?.sync(state);
  }, [state]);

  // A package swap while the board is mounted. Keyed on `pkg` IDENTITY, not on
  // `pkg.id`, matching `loadPackage`'s payload. There is no command for
  // unloading, so `pkg` going null leaves the previous package on the board —
  // Task 17 should unmount the board instead.
  useEffect(() => {
    if (pkgRef.current === pkg) return;
    pkgRef.current = pkg;
    if (pkg) dispatch({ type: 'loadPackage', pkg });
  }, [pkg, dispatch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A pending debounce must not eat the GM's last change.
      flushSaveNow();
      schedulerRef.current?.dispose();
      engineRef.current?.dispose();
      void ctxRef.current?.close().catch(() => {});
      schedulerRef.current = null;
      engineRef.current = null;
      ctxRef.current = null;
    };
  }, [flushSaveNow]);

  return { state, dispatch, audioReady, enableAudio, saveError };
}
