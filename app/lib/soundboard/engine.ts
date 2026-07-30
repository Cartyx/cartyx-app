import type { BoardItemState, BoardState } from '~/lib/soundboard/reducer';
import { AUDIO_RENDITION_SAMPLE_RATE } from '~/types/audio';

/**
 * The ramp used when a source has to go away *now* — a retrigger, or a
 * teardown. 15 ms rather than 0 because cutting a gain to zero instantly
 * clicks, even when something new is about to start on top of it. Ported
 * verbatim from the POC (`~/Developer/ttrpg-sfx/docs/soundboard.md`), where
 * this value was arrived at by ear.
 */
const IMMEDIATE_FADE_SECONDS = 0.015;

/**
 * One decoded asset, ready to play.
 *
 * `durationSamples` is the worker's MEASUREMENT of the decoded content length
 * (see `app/types/audio.ts`), not a container header, and not
 * `buffer.duration`. It is what makes gapless looping possible — see
 * `contentSeconds` below. `null` is tolerated (assets from before the
 * measurement existed, or a failed probe) and falls back to `buffer.duration`,
 * which is the pre-fix behaviour: correct for Opus, audibly ticky for AAC.
 */
export type EngineAsset = {
  buffer: AudioBuffer;
  durationSamples: number | null;
};

export type SoundboardEngineOptions = {
  /**
   * Fetch + `decodeAudioData` for one asset id. Returning `null` means "this
   * asset cannot be played" (not ready, no rendition, deleted) and the engine
   * will not ask again for the lifetime of the engine.
   */
  loadAsset: (assetId: string) => Promise<EngineAsset | null>;
  /**
   * Fired when a pad releases itself — a one-shot reaching the end of its
   * buffer, or a loop that was flipped to `1×` finishing its current pass.
   * Task 12 needs this to dispatch `{ type: 'stop', itemId }` so the pad stops
   * looking lit; nothing else in the system knows the sound ended.
   * NOT fired for a deliberate stop (the caller already knows) and not for a
   * transient `fireOneShot`, which never lit a pad in the first place.
   */
  onItemEnded?: (itemId: string) => void;
  /** Fired when `loadAsset` rejects. The engine keeps running, silent for that asset. */
  onLoadError?: (assetId: string, error: unknown) => void;
};

export type SoundboardEngine = {
  /**
   * Reconcile the audio graph against a `BoardState` snapshot. Idempotent:
   * applying the same state twice is a no-op, so it is safe to call on every
   * render.
   */
  apply: (state: BoardState) => void;
  /**
   * Fire one transient one-shot for an item, without touching whether its pad
   * is "on". This is the path Task 11's random scheduler uses, and it is
   * separate from `apply` on purpose: `fireOneShot` deliberately makes no mark
   * on `BoardState` (see `boardReducer`), so there is no state diff for
   * `apply` to notice.
   */
  fireOneShot: (itemId: string) => void;
  /**
   * Resolves once every asset load triggered so far has settled. Exists for
   * tests (and any caller that wants to preload before an offline render);
   * normal UI use never needs to await it, since loads re-reconcile on arrival.
   */
  ready: () => Promise<void>;
  /** Stop everything immediately and detach from the destination. */
  dispose: () => void;
};

/**
 * One pad's live playback. `source` is non-null only while playing — it
 * doubles as the "is this pad sounding" flag, exactly as in the POC.
 *
 * `gain` is created fresh on every start and captured by `stopTrack`'s
 * closure, NOT shared across starts. That independence is what lets the POC's
 * documented behaviour actually happen: "the slot is freed immediately, so a
 * re-click can start a fresh source while the old one is still fading." With
 * one gain node per pad, the new source's fade-in schedule would overwrite the
 * old source's fade-out on the same `AudioParam` and the outgoing sound would
 * ride the incoming envelope instead of fading.
 */
type Track = {
  gain: GainNode | null;
  source: AudioBufferSourceNode | null;
  /** `ctx.currentTime` at which `source` started — needed to find the playhead
   * when loop is flipped off mid-play. */
  startedAt: number;
  /** The volume the current source's envelope targets. */
  volume: number;
  fadeSeconds: number;
  loop: boolean;
  /** Content length in seconds of the buffer currently playing. */
  contentSeconds: number;
  /** True when this source came from `fireOneShot` rather than `playing: true`.
   * `apply` must not stop these — a random thunder crack is not represented in
   * `BoardState`, so every unrelated state change (a master-volume nudge, say)
   * would otherwise cut it off mid-flight. */
  transient: boolean;
  /** True once an end-of-pass fade + `stop()` has been scheduled on this
   * source. Volume changes have to re-schedule it (`cancelScheduledValues`
   * wipes it), and flipping loop back on cannot un-schedule it. */
  tailScheduled: boolean;
};

/**
 * The POC's Web Audio engine, ported, with one addition it did not need.
 *
 * Graph: `BufferSource → per-pad GainNode → masterGain → destination`. The
 * per-pad gain is what makes independent per-item fades and volumes possible —
 * "a storm wants to swell over 4 s while a fireball wants to snap in at 0, and
 * a single global fade can't do both."
 *
 * `ctx` is a `BaseAudioContext` rather than an `AudioContext` so an
 * `OfflineAudioContext` can drive it: the tests render the graph and assert on
 * the actual sample values that come out, rather than on a mocked API.
 */
export function createEngine(
  ctx: BaseAudioContext,
  options: SoundboardEngineOptions
): SoundboardEngine {
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const tracks = new Map<string, Track>();
  const assets = new Map<string, EngineAsset>();
  const pending = new Map<string, Promise<void>>();
  /** Assets whose load returned `null` or threw — never retried. */
  const unplayable = new Set<string>();
  /** Every source currently scheduled, so `dispose` can silence detached
   * (already-stopped-but-still-fading) sources too. */
  const live = new Set<AudioBufferSourceNode>();

  let latest: BoardState | null = null;
  let masterVolume = 1;
  let disposed = false;

  /**
   * The exact content length, in seconds, that `loopEnd` must use.
   *
   * The POC could trust `source.loop` alone because its files measured exactly
   * 117.000 s with no padding drift. Ours cannot: AAC carries encoder delay and
   * padding, so `decodeAudioData` hands back a buffer slightly LONGER than the
   * real content and a looping ambience ticks on every repeat — on Safari
   * specifically, which is the browser the AAC rendition exists to serve. See
   * `docs/specs/2026-07-28-audio-library-design.md`, "Gapless looping".
   *
   * `durationSamples` is trustworthy here precisely because it is a
   * measurement: the worker decodes and counts samples rather than reading the
   * container's duration (measured at +312 samples for Ogg/Opus and +1440 for
   * ADTS AAC). It is counted at `AUDIO_RENDITION_SAMPLE_RATE`, NOT at the
   * source file's own rate — dividing by anything else is the one arithmetic
   * error here that produces plausible-sounding, wrong loop points.
   */
  function contentSeconds(asset: EngineAsset): number {
    if (asset.durationSamples === null || asset.durationSamples <= 0) {
      return asset.buffer.duration;
    }
    return Math.min(asset.durationSamples / AUDIO_RENDITION_SAMPLE_RATE, asset.buffer.duration);
  }

  function trackFor(itemId: string): Track {
    const existing = tracks.get(itemId);
    if (existing) return existing;
    const created: Track = {
      gain: null,
      source: null,
      startedAt: 0,
      volume: 1,
      fadeSeconds: 0,
      loop: false,
      contentSeconds: 0,
      transient: false,
      tailScheduled: false,
    };
    tracks.set(itemId, created);
    return created;
  }

  /** Free the pad. Called only from the auto-release path (`onended` on a
   * source nobody deliberately stopped). */
  function clear(itemId: string, track: Track): void {
    const wasTransient = track.transient;
    track.source = null;
    track.gain = null;
    track.tailScheduled = false;
    track.transient = false;
    if (!wasTransient) options.onItemEnded?.(itemId);
  }

  /**
   * Ramp down to zero at `endTime`, from the volume the envelope is currently
   * targeting. Used for a one-shot's tail and for the final pass of a loop
   * that was flipped to `1×`.
   *
   * Clamped so the tail can never start before the fade-IN has finished: on a
   * buffer shorter than twice the fade, the two ramps would otherwise cross and
   * the second `setValueAtTime` would yank the gain back up mid fade-in.
   */
  function scheduleTail(track: Track, endTime: number): void {
    const gain = track.gain;
    if (!gain) return;
    const now = ctx.currentTime;
    const earliest = Math.max(now, track.startedAt + track.fadeSeconds);
    const tailStart = Math.max(earliest, endTime - track.fadeSeconds);
    if (tailStart >= endTime) {
      // No room for a tail (fade 0, or a buffer shorter than its own fade):
      // the buffer simply ends. `stop()` at `endTime` still cuts the padding.
      track.tailScheduled = true;
      return;
    }
    gain.gain.setValueAtTime(track.volume, tailStart);
    gain.gain.linearRampToValueAtTime(0, endTime);
    track.tailScheduled = true;
  }

  /**
   * Start a fresh source for `item`. Any source already on the pad is stopped
   * with the 15 ms ramp first — that is the POC's retrigger.
   */
  function start(item: BoardItemState, transient: boolean): void {
    const asset = assets.get(item.assetId);
    if (!asset) return;
    const track = trackFor(item.itemId);
    if (track.source) stopTrack(item.itemId, track, true);

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(master);

    const source = ctx.createBufferSource();
    source.buffer = asset.buffer;
    const content = contentSeconds(asset);
    // A transient fire is always a one-shot regardless of the item's own loop
    // setting: a random ambient crack that latched into a loop would never stop.
    const loop = transient ? false : item.loop;
    source.loop = loop;
    if (loop) {
      source.loopStart = 0;
      source.loopEnd = content;
    }
    source.connect(gain);

    const fade = item.fadeSeconds;
    if (fade > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(item.volume, now + fade);
    } else {
      // `fade = 0` starts at full. `linearRampToValueAtTime(v, now)` would be a
      // zero-length ramp, which is not guaranteed to land anywhere useful.
      gain.gain.setValueAtTime(item.volume, now);
    }

    // The identity check is the whole point. Without it, a fast off/on has the
    // OLD source's `onended` clear the pad the NEW source is playing on.
    source.onended = () => {
      live.delete(source);
      if (track.source === source) clear(item.itemId, track);
    };

    track.gain = gain;
    track.source = source;
    track.startedAt = now;
    track.volume = item.volume;
    track.fadeSeconds = fade;
    track.loop = loop;
    track.contentSeconds = content;
    track.transient = transient;
    track.tailScheduled = false;

    live.add(source);
    source.start(now);

    if (!loop) {
      const endTime = now + content;
      scheduleTail(track, endTime);
      // Stop at the measured content end, not at the buffer end: for AAC the
      // difference is the encoder's padding, which is silence the pad would
      // otherwise sit through before releasing.
      source.stop(endTime);
    }
  }

  /**
   * Stop the pad's current source, fading over `track.fadeSeconds` (or 15 ms
   * when `immediate`). Frees the slot straight away; the outgoing source and
   * its own gain node live on in this closure until the `stop()` lands.
   */
  function stopTrack(itemId: string, track: Track, immediate: boolean): void {
    const source = track.source;
    const gain = track.gain;
    if (!source || !gain) return;

    const now = ctx.currentTime;
    const fade = immediate ? IMMEDIATE_FADE_SECONDS : track.fadeSeconds;

    // THE FADE-INTERRUPT FIX. All three lines matter, and the middle one is the
    // one that is easy to leave out: without `setValueAtTime(gain.value, now)`,
    // cancelling a still-running fade-in reverts the param to its last set
    // value and the sound LEAPS to full volume before fading out. Measured in
    // the POC: interrupted at gain 0.201, it ramps 0.18 → 0.16 → 0.14 → …
    // rather than jumping to 0.8.
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fade);

    // Deliberate teardown must not run the auto-release path — `onItemEnded`
    // would tell Task 12 the pad released on its own, when in fact the caller
    // asked for it (or is about to start a replacement on the same pad).
    source.onended = null;
    live.delete(source);
    source.stop(now + fade);

    track.source = null;
    track.gain = null;
    track.tailScheduled = false;
    track.transient = false;
  }

  function ensureAsset(assetId: string): void {
    if (assets.has(assetId) || pending.has(assetId) || unplayable.has(assetId)) return;
    const load = options
      .loadAsset(assetId)
      .then((asset) => {
        if (asset) assets.set(assetId, asset);
        else unplayable.add(assetId);
      })
      .catch((error: unknown) => {
        unplayable.add(assetId);
        options.onLoadError?.(assetId, error);
      })
      .finally(() => {
        pending.delete(assetId);
        // Re-reconcile against whatever the board looks like NOW, not against
        // the state that triggered the load — the GM may have changed mood
        // three times while a 6 MB ambience downloaded.
        if (!disposed && latest) reconcile(latest);
      });
    pending.set(assetId, load);
  }

  function reconcile(state: BoardState): void {
    if (disposed) return;

    if (state.masterVolume !== masterVolume) {
      masterVolume = state.masterVolume;
      master.gain.setValueAtTime(masterVolume, ctx.currentTime);
    }

    const seen = new Set<string>();

    for (const item of state.items) {
      seen.add(item.itemId);
      const track = tracks.get(item.itemId);

      if (item.playing) {
        ensureAsset(item.assetId);
        // No source, or only a transient fire is sounding on this pad (which is
        // not the pad being "on") — start the real thing. `start` handles the
        // transient one already playing by stopping it first.
        if (!track?.source || track.transient) {
          start(item, false);
          continue;
        }

        if (item.volume !== track.volume) {
          const now = ctx.currentTime;
          const gain = track.gain;
          if (gain) {
            // Same cancel → pin → ramp shape as the stop path, and for the same
            // reason: a volume change mid fade-in must move from where the gain
            // actually is, not from where the fade started.
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(item.volume, now + IMMEDIATE_FADE_SECONDS);
          }
          track.volume = item.volume;
          // `cancelScheduledValues` just wiped any pending tail; put it back.
          if (track.tailScheduled) scheduleTail(track, track.startedAt + track.contentSeconds);
        }

        if (item.loop !== track.loop) flipLoop(item, track);
        continue;
      }

      // Not playing. A transient fire is not represented in `BoardState`, so
      // `playing: false` is not an instruction to cut it short.
      if (track?.source && !track.transient) stopTrack(item.itemId, track, false);
    }

    // Items that vanished from the package entirely (a `loadPackage` to a
    // different package, an item deleted while the board was open).
    for (const [itemId, track] of tracks) {
      if (seen.has(itemId)) continue;
      if (track.source) stopTrack(itemId, track, false);
      tracks.delete(itemId);
    }
  }

  /**
   * `source.loop` is live-assignable, so flipping `∞ ↔ 1×` applies without
   * restarting. Turning looping OFF needs the playhead position to know where
   * the current pass ends — hence `startedAt`.
   */
  function flipLoop(item: BoardItemState, track: Track): void {
    const source = track.source;
    if (!source) return;

    if (!item.loop) {
      source.loop = false;
      const now = ctx.currentTime;
      const pos = track.contentSeconds > 0 ? (now - track.startedAt) % track.contentSeconds : 0;
      const endTime = now + (track.contentSeconds - pos);
      track.loop = false;
      scheduleTail(track, endTime);
      source.stop(endTime);
      return;
    }

    if (track.tailScheduled) {
      // A scheduled `stop()` cannot be un-scheduled, so the only way back to a
      // loop is a fresh source. Documented as an approximation: flipping
      // 1× → ∞ after already flipping ∞ → 1× mid-pass re-attacks the track.
      start(item, false);
      return;
    }
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = track.contentSeconds;
    track.loop = true;
  }

  return {
    apply(state: BoardState): void {
      latest = state;
      reconcile(state);
    },

    fireOneShot(itemId: string): void {
      if (disposed || !latest) return;
      const item = latest.items.find((candidate) => candidate.itemId === itemId);
      if (!item) return;
      if (assets.has(item.assetId)) {
        start(item, true);
        return;
      }
      if (unplayable.has(item.assetId)) return;
      ensureAsset(item.assetId);
      // Fire as soon as the buffer lands. A random ambient crack that arrives
      // late is still a crack; the alternative is silence until the scheduler's
      // next tick, which for a 5-minute interval is a long wait.
      void pending.get(item.assetId)?.then(() => {
        if (!disposed && assets.has(item.assetId)) start(item, true);
      });
    },

    async ready(): Promise<void> {
      // A settled load re-reconciles synchronously, which can queue further
      // loads — so drain until there is nothing left rather than awaiting once.
      while (pending.size > 0) {
        await Promise.all([...pending.values()]);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      for (const source of live) {
        source.onended = null;
        try {
          source.stop(now);
        } catch {
          // Already stopped, or never started — nothing to tear down.
        }
      }
      live.clear();
      tracks.clear();
      master.disconnect();
    },
  };
}
