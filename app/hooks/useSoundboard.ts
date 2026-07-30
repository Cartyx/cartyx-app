import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { createEngine, type EngineAsset, type SoundboardEngine } from '~/lib/soundboard/engine';
import { createScheduler, type Scheduler } from '~/lib/soundboard/scheduler';
import { boardReducer, initialBoardState, type BoardState } from '~/lib/soundboard/reducer';
import type { SoundboardCommand } from '~/lib/soundboard/commands';
import { saveBoardStateFn } from '~/utils/soundboard-server-fns';
import { captureException } from '~/utils/telemetry-client';
import type { AudioPackageData, BoardStateData } from '~/types/soundboard';
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
 *
 * The fallback prefers **AAC/M4A**, not Opus. Under-reporting is
 * overwhelmingly a Safari/iOS behaviour, and MP4/AAC-LC is the more
 * universally decodable of the two — falling back to Opus would fail hardest
 * on exactly the browser the AAC rendition exists to serve.
 */
export function pickRendition(
  renditions: { opus?: AudioRendition; aac?: AudioRendition },
  canPlay: (mime: string) => boolean = browserCanPlay
): AudioRendition | null {
  const { opus, aac } = renditions;
  if (opus && canPlay(OPUS_MIME)) return opus;
  if (aac && canPlay(AAC_MIME)) return aac;
  return aac ?? opus ?? null;
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

/**
 * Rebuild a live `BoardState` from what was persisted — the inverse of
 * `toBoardStatePayload`, and the reason this hook needs a hydration seam at
 * all rather than a replay of commands through `dispatch`.
 *
 * Why a replay does not work. `setMood` runs `resolveAllItems`, which sets
 * `playing: true` for **every item the mood names**. An item the mood names
 * but that the GM had explicitly STOPPED before the reload is therefore
 * unreachable by any sequence of `play` commands — you would need a `stop`
 * for it, and knowing which items need one means doing this overlay anyway.
 * A replay also runs through `dispatch`, so it would re-save what it just
 * read, silently making "opened the board" the last write to `updatedBy`.
 *
 * The overlay, in order:
 *
 * 1. `initialBoardState(pkg)` — every item resolved to not-playing.
 * 2. `setMood(persisted.moodId)` through `boardReducer`, so the mood's own
 *    `fadeSeconds`/`randomInterval` overrides are resolved exactly as a live
 *    `setMood` would resolve them. A `moodId` naming a mood that has since
 *    been deleted leaves `moodId` null — that is `boardReducer`'s own guard,
 *    reused rather than reimplemented.
 * 3. Persisted `{ playing, volume }` overlaid per item. This is the step that
 *    restores a stopped item the mood names, and it is why the persisted row
 *    wins over the mood's resolution for those two fields only.
 *
 * **Package mismatch is not merged.** `PackageItemData.id` is stable only
 * WITHIN its package, so overlaying package A's saved item states onto package
 * B's items would apply the wrong `playing`/`volume` to whatever happened to
 * share an id. When `persisted.packageId` does not match the package being
 * hydrated, only `masterVolume` survives — it is a board/output property, not
 * a package one, exactly as `boardReducer`'s `loadPackage` case already treats
 * it.
 */
export function hydrateBoardState(
  pkg: AudioPackageData | null,
  persisted: BoardStateData
): BoardState {
  const base = initialBoardState(pkg);
  if (persisted.packageId !== (pkg?.id ?? null)) {
    return { ...base, masterVolume: persisted.masterVolume };
  }

  const withMood =
    pkg && persisted.moodId
      ? boardReducer(base, { type: 'setMood', moodId: persisted.moodId })
      : base;

  const saved = new Map(persisted.items.map((item) => [item.itemId, item]));
  return {
    ...withMood,
    masterVolume: persisted.masterVolume,
    items: withMood.items.map((item) => {
      const row = saved.get(item.itemId);
      // No saved row means the item was added to the package after the last
      // save — its mood-resolved value is the only correct answer.
      if (!row) return item;
      return { ...item, playing: row.playing, volume: row.volume };
    }),
  };
}

/**
 * Hook-private. Deliberately NOT a member of `SoundboardCommand`: that union
 * is phase 2b's wire vocabulary, and a whole-state replacement is not
 * something one client may hand another. It also carries a `BoardState`, which
 * embeds the full `AudioPackageData` — not a payload anything should
 * broadcast. Keeping it out of the union is what makes it impossible to
 * dispatch through the public `dispatch`, and therefore impossible to
 * accidentally persist or broadcast.
 */
type HydrateAction = { type: '@@hydrate'; state: BoardState };

function soundboardReducer(
  state: BoardState,
  action: SoundboardCommand | HydrateAction
): BoardState {
  if (action.type === '@@hydrate') return action.state;
  return boardReducer(state, action);
}

export type UseSoundboardOptions = {
  /**
   * The library rows for the assets this package references — where the
   * rendition URLs and `durationSamples` come from. Read live through a ref,
   * so a list that arrives after mount is picked up without remounting.
   *
   * `undefined` means "not settled yet" and `enableAudio()` REFUSES to build
   * the engine while it is. That is not defensive noise: `loadAsset` returning
   * `null` (or throwing) puts the asset in the engine's `unplayable` set for
   * the engine's whole lifetime (`engine.ts`), so a single early build against
   * an empty list produces permanently dead pads with nothing logged. Pass an
   * explicit `[]` for a board that genuinely has no assets — the empty array
   * is the statement "I know there are none".
   */
  assets?: readonly AudioAssetData[];
  /**
   * What `loadBoardStateFn` returned for this campaign.
   *
   * - key ABSENT — this board does not hydrate; saving is live from mount.
   * - `'pending'` — the query is in flight. **No save may be armed yet.**
   *   Without this gate the `[pkg]` effect's `loadPackage` arms a write at
   *   +200 ms and a slower board-state query loses the race, overwriting the
   *   GM's saved board with a blank one.
   * - `BoardStateData` / `null` — settled. Applied ONCE, without scheduling a
   *   save, then saving goes live.
   *
   * Task 17: `initialState: boardQuery.isPending ? 'pending' : (boardQuery.data ?? null)`.
   */
  initialState?: BoardStateData | null | 'pending';
  /**
   * True while the caller's package query is still in flight — i.e. `pkg ===
   * null` means "not yet", not "there is none".
   *
   * Only consulted when a persisted board names a package that has not
   * arrived. Defaults to **`false`**, and the direction of that default is
   * deliberate: a caller who forgets this flag on a slow query loses the
   * restored item states (visible, recoverable, the board just shows nothing
   * playing), whereas defaulting to `true` would mean a persisted board naming
   * a DELETED package waits forever, and a hook that never hydrates never
   * saves. Task 4 deletes packages, so that is an ordinary outcome, not an
   * edge case. Failing toward "lose a little, loudly" beats "lose everything,
   * silently".
   */
  packagePending?: boolean;
  /**
   * `false` disables persistence entirely. `saveBoardState` requires the
   * caller to be **GM** (`loadBoardState` only requires membership), so a
   * non-GM board would otherwise emit a guaranteed-rejected write — and a
   * `captureException` — on every command. Audio is unaffected either way.
   * Defaults to `true`. Honoured at both ends: a pending timer armed while it
   * was `true` does not fire a write after it flips to `false`.
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
  /**
   * True only while the `AudioContext` has actually REACHED `running`. Never
   * set optimistically from a resolved `resume()` — on iOS Safari a `resume()`
   * can resolve with the context still suspended or interrupted, and a board
   * that says audio is on while making no sound is the worst failure this hook
   * has.
   */
  audioReady: boolean;
  /**
   * Why the last `enableAudio()` did not produce a running context, or `null`.
   * A failed gesture is fully retryable — nothing is cached, the context is
   * closed and the ref left empty, so the next call is a fresh attempt.
   */
  audioError: string | null;
  /** Must be called from a user gesture — see `createAudioContext` above. */
  enableAudio: () => Promise<void>;
  /**
   * The message from the most recent failed save, or `null`. A failed save
   * NEVER interrupts audio: the engine owns sound and the server is a mirror,
   * so this is a banner for the GM, not an error boundary.
   */
  saveError: string | null;
  /**
   * False until `initialState` has settled and been applied. While false, no
   * save can be armed. A board that does not use `initialState` is `hydrated`
   * from mount.
   */
  hydrated: boolean;
};

/**
 * The GM board's one stateful seam: reducer + Web Audio engine + random
 * one-shot scheduler + debounced persistence.
 *
 * Four things live here and nowhere else:
 *
 * 1. **The audio gesture.** An `AudioContext` starts suspended. Without
 *    `enableAudio()` on a real click, the GM's first pad press silently does
 *    nothing — the worst possible failure for a live tool. The engine and the
 *    scheduler are therefore constructed INSIDE `enableAudio`, so "nothing
 *    reaches the audio layer before the context is resumed" is structural
 *    rather than a flag anyone has to remember to check.
 * 2. **Hydration.** `initialState` is applied without a save, and gates every
 *    save until it settles.
 * 3. **The debounce.** See `SAVE_FLUSH_MS` / `SAVE_SETTLE_MS`. Writes are also
 *    SERIALIZED — never two in flight — so a slow prompt write and a later
 *    settle write cannot land at Atlas out of order.
 * 4. **Save failures are non-events for audio.** Reported, surfaced, dropped.
 */
export function useSoundboard(
  campaignId: string,
  pkg: AudioPackageData | null,
  options: UseSoundboardOptions = {}
): UseSoundboardResult {
  const [state, rawDispatch] = useReducer(soundboardReducer, pkg, initialBoardState);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(() => options.initialState === undefined);

  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  const campaignIdRef = useRef(campaignId);
  /** Package IDENTITY is not the key — see the `[pkg]` effect. */
  const pkgIdRef = useRef(pkg?.id ?? null);
  const mountedRef = useRef(true);
  const hydratedRef = useRef(options.initialState === undefined);

  const ctxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<SoundboardEngine | null>(null);
  const schedulerRef = useRef<Scheduler | null>(null);
  /** The in-flight `enableAudio()` attempt, shared by concurrent callers. */
  const enablingRef = useRef<Promise<void> | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number | null>(null);
  /** True while a `prompt`-urgency flush is already queued. */
  const promptPendingRef = useRef(false);
  /** True while a write is in flight — writes are serialized, never raced. */
  const inFlightRef = useRef(false);
  /** A flush that arrived while a write was in flight, to run after it lands. */
  const resaveRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
    campaignIdRef.current = campaignId;
  });

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  const runSave = useCallback(function save(): void {
    timerRef.current = null;
    deadlineRef.current = null;
    promptPendingRef.current = false;

    // `persist` may have flipped to `false` while this timer was pending — the
    // guard in `scheduleSave` cannot see that. Firing anyway is a guaranteed
    // server rejection plus a GlitchTip event, which is the loop `persist`
    // exists to prevent.
    if (optionsRef.current.persist === false) return;

    // Writes are serialized. `saveBoardState` is a full-state REPLACE, so two
    // concurrent writes are not merely wasteful: a slow 200 ms prompt write and
    // a faster later settle write can land at Atlas in the wrong order and
    // persist stale state. Queue instead, and re-read `stateRef` when the queued
    // write actually runs so it carries the newest state rather than a snapshot.
    if (inFlightRef.current) {
      resaveRef.current = true;
      return;
    }
    inFlightRef.current = true;

    const id = campaignIdRef.current;
    // `try/catch/finally` rather than `.then().catch().finally()`: a
    // SYNCHRONOUS throw from `saveBoardStateFn` never reaches a promise chain,
    // so the chain's `finally` would not run, `inFlightRef` would stay stuck
    // `true`, and every later save would queue behind a request that no longer
    // exists — persistence silently dead for the session. Unlikely (server fns
    // return promises) but total, and this shape costs nothing.
    void (async () => {
      try {
        await saveBoardStateFn({ data: toBoardStatePayload(id, stateRef.current) });
        if (mountedRef.current) setSaveError(null);
      } catch (error: unknown) {
        // The engine keeps playing. This is a mirror falling behind, not an
        // audio failure, and treating it as one would silence a live table.
        captureException(error, { area: 'soundboard', campaignId: id });
        if (mountedRef.current) {
          setSaveError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        inFlightRef.current = false;
        if (resaveRef.current) {
          resaveRef.current = false;
          save();
        }
      }
    })();
  }, []);

  const scheduleSave = useCallback(
    (urgency: Exclude<SaveUrgency, 'none'>): void => {
      // Nothing may be written before we know what is already persisted. This
      // is the clobber gate: the `[pkg]` effect's `loadPackage` would otherwise
      // arm a write of a blank board that a slower board-state query loses to.
      if (!hydratedRef.current) return;
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
    if (!ctx) throw new Error('Soundboard: loadAsset ran with no AudioContext');

    const assets = optionsRef.current.assets;
    // `enableAudio` refuses to build an engine while this is undefined, so
    // reaching here means the invariant broke. THROW rather than return null:
    // both end up in the engine's permanent `unplayable` set, but only a throw
    // reaches `onLoadError` -> `captureException` instead of vanishing.
    if (!assets) throw new Error('Soundboard: loadAsset ran before the asset list settled');

    const asset = assets.find((candidate) => candidate.id === assetId);
    // Absent from a SETTLED list is not "nothing to play" — it is the list
    // being wrong. Today that happens two ways: `listAudioAssetsFn` is
    // cursor-paginated (default 50) while a package holds up to 64 items, and
    // it filters `{ ownerId: userId }` so no system package's assets are ever
    // in it (Task 21 adds `listPackageAssetsFn` to fix the source). Either way
    // the pad dies permanently, so it must not die quietly.
    if (!asset) throw new Error(`Soundboard: asset ${assetId} is not in the board's asset list`);
    // Still transcoding: temporary in the world, permanent for this engine.
    // Loud, for the same reason.
    if (
      asset.status === 'pending' ||
      asset.status === 'processing' ||
      asset.status === 'uploading'
    ) {
      throw new Error(`Soundboard: asset ${assetId} is not ready (status: ${asset.status})`);
    }

    // `failed`/no rendition are the only genuine "there is nothing to play,
    // ever" answers, and the only ones that may return null silently.
    if (asset.status !== 'ready') return null;
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

  const teardownAudio = useCallback((): void => {
    schedulerRef.current?.dispose();
    engineRef.current?.dispose();
    void ctxRef.current?.close().catch(() => {});
    schedulerRef.current = null;
    engineRef.current = null;
    ctxRef.current = null;
  }, []);

  const runEnableAudio = useCallback(async (): Promise<void> => {
    const fail = (message: string, error?: unknown) => {
      captureException(error ?? new Error(message), {
        area: 'soundboard',
        campaignId: campaignIdRef.current,
        stage: 'enableAudio',
      });
      if (mountedRef.current) {
        setAudioReady(false);
        setAudioError(message);
      }
    };

    // Retry path. `ctxRef.current` is only ever a context that reached
    // `running` WITH a live engine beside it, so a desync here means something
    // tore one down; rebuild rather than trust it.
    const existing = ctxRef.current;
    if (existing && engineRef.current && existing.state !== 'closed') {
      try {
        if (existing.state !== 'running') await existing.resume();
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error), error);
        return;
      }
      if (existing.state !== 'running') {
        fail(`Audio could not start (context is ${existing.state}).`);
        return;
      }
      if (mountedRef.current) {
        setAudioReady(true);
        setAudioError(null);
      }
      return;
    }
    // Closed or desynced: nothing here is reusable.
    if (existing) teardownAudio();

    // Building the engine against an unsettled asset list produces permanently
    // dead pads with nothing logged (see `assets` in the options type).
    if (!optionsRef.current.assets) {
      fail('Audio assets are still loading — try again in a moment.');
      return;
    }

    const create = optionsRef.current.createAudioContext ?? (() => new AudioContext());
    let created: AudioContext | null = null;
    try {
      created = create();
      if (created.state !== 'running') await created.resume();
    } catch (error) {
      // `ctxRef.current` is deliberately still NULL here. Assigning it before
      // the resume settles is what made a rejected autoplay gesture
      // unrecoverable: every later click took the retry path, resumed a
      // context with no engine beside it, and returned green and silent.
      if (created) void created.close().catch(() => {});
      fail(error instanceof Error ? error.message : String(error), error);
      return;
    }

    // `resume()` can RESOLVE without the context reaching `running` — iOS
    // Safari does exactly this on a stale gesture or during an audio-session
    // interruption. Never infer readiness from the promise settling.
    if (created.state !== 'running') {
      const observed = created.state;
      void created.close().catch(() => {});
      fail(`Audio could not start (context is ${observed}).`);
      return;
    }

    if (!mountedRef.current) {
      void created.close().catch(() => {});
      return;
    }

    ctxRef.current = created;
    const engine = createEngine(created, {
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
    setAudioError(null);
  }, [dispatch, loadAsset, teardownAudio]);

  /**
   * Concurrent callers share ONE attempt.
   *
   * This guard is not optional politeness. `ctxRef.current` is deliberately
   * assigned only AFTER `await resume()` (that ordering is what makes a failed
   * gesture recoverable), which means it can no longer double as the mutual
   * exclusion it used to accidentally provide: two clicks during a pending
   * `resume()` would both see a null ref, both `create()`, and both build an
   * engine. `engineRef`/`ctxRef` would keep only the second — while the first
   * engine has already had `apply(stateRef.current)` run against it, so with
   * hydration restoring `playing: true` items it starts sound that no later
   * `dispatch` can reach and `teardownAudio` can never dispose.
   *
   * A double-tap is the ordinary trigger, and it is most likely on iOS, where
   * `resume()` is slowest and the affordance is deliberately left clickable so
   * a failed gesture can be retried.
   *
   * `enablingRef` is assigned synchronously, before control can return to any
   * other caller: `runEnableAudio()` runs to its first `await` without
   * yielding, so there is no window in which a second call can see it unset.
   */
  const enableAudio = useCallback((): Promise<void> => {
    const inFlight = enablingRef.current;
    if (inFlight) return inFlight;
    const attempt = runEnableAudio().finally(() => {
      if (enablingRef.current === attempt) enablingRef.current = null;
    });
    enablingRef.current = attempt;
    return attempt;
  }, [runEnableAudio]);

  // ---------------------------------------------------------------------
  // Hydration, reconciliation and lifecycle
  // ---------------------------------------------------------------------

  const initialState = options.initialState;
  const packagePending = options.packagePending ?? false;

  // Declared BEFORE the `[pkg]` effect on purpose: in the commit where `pkg`
  // first arrives, this runs first and claims the package id, so the `[pkg]`
  // effect sees no change and cannot dispatch a `loadPackage` that would wipe
  // what was just hydrated.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (initialState === 'pending') return;

    if (initialState && initialState.packageId !== null && pkg === null) {
      // Still loading: wait. Consuming hydration now would drop every item
      // state, since there are no items to overlay onto yet.
      if (packagePending) return;
      // Settled: the package is GONE — deleted (Task 4), or unreadable by this
      // caller. Waiting forever here would never flip `hydratedRef`, and
      // `scheduleSave`'s gate would then silently discard every save for the
      // whole session while `hydrated` never went true. Fall through instead
      // and let `hydrateBoardState`'s package-mismatch branch keep
      // `masterVolume` and nothing else — the board resolves to "no package
      // loaded", which is both true and something Task 17 already renders.
      captureException(
        new Error(
          `Soundboard: persisted board names package ${initialState.packageId}, which did not resolve`
        ),
        { area: 'soundboard', campaignId: campaignIdRef.current, stage: 'hydrate' }
      );
    }

    hydratedRef.current = true;
    pkgIdRef.current = pkg?.id ?? null;
    if (initialState) {
      // Straight into the reducer, NOT through `dispatch`: hydration must not
      // schedule a save. Re-writing what was just read would make merely
      // opening the board the last write to `updatedBy`/`updatedAt`.
      rawDispatch({ type: '@@hydrate', state: hydrateBoardState(pkg, initialState) });
    }
    setHydrated(true);
  }, [initialState, pkg, packagePending]);

  useEffect(() => {
    stateRef.current = state;
    // Both are idempotent and are meant to be called together on every state
    // change — `apply` re-reconciles the audio graph, `sync` leaves an
    // already-correct random timer alone.
    engineRef.current?.apply(state);
    schedulerRef.current?.sync(state);
  }, [state]);

  // A package swap while the board is mounted. Keyed on `pkg.id`, NOT object
  // identity: a refetch that returns the same package with a moving
  // `updatedAt` produces a new object every time, and identity-keying would
  // reset the whole board mid-session and then persist the reset. The
  // trade-off is deliberate — an in-place edit to the same package id is not
  // picked up until the board remounts.
  //
  // There is no command for unloading, so `pkg` going null leaves the previous
  // package on the board; Task 17 should unmount the board instead.
  useEffect(() => {
    const id = pkg?.id ?? null;
    if (pkgIdRef.current === id) return;
    pkgIdRef.current = id;
    if (pkg) dispatch({ type: 'loadPackage', pkg });
  }, [pkg, dispatch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A pending debounce must not eat the GM's last change.
      flushSaveNow();
      teardownAudio();
    };
  }, [flushSaveNow, teardownAudio]);

  return { state, dispatch, audioReady, audioError, enableAudio, saveError, hydrated };
}
