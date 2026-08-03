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
  /**
   * Overrides `DEFAULT_ASSET_CACHE_CAP_BYTES`. Not needed in production — the
   * default is sized against the documented worst case. Exists so tests can
   * cross the cap with small fixture buffers instead of allocating gigabytes
   * of real decoded audio.
   */
  assetCacheCapBytes?: number;
};

/**
 * Default cap, in bytes, on the sum of decoded `AudioBuffer` sizes held in
 * the engine's asset cache (`assets`).
 *
 * Sized against the documented worst case rather than picked round: at the
 * current caps (64 items, 30-minute assets, 48 kHz stereo float32) ONE fully
 * decoded asset already costs `48_000 × 1800 × 2 channels × 4 bytes` ≈
 * 691 MB — see `docs/specs/2026-07-31-audio-hardening-design.md`. 1 GiB
 * leaves room for that single worst-case asset plus a handful of shorter
 * loops and one-shots resident at once (a storm bed, a rain bed, and a few
 * one-shots layered over them is the realistic ceiling for one board), while
 * still bounding a board that plays through all 64 documented-max assets —
 * ~44 GB unbounded — down to about 1/44th of that. It is a per-engine cap:
 * a page holding several boards' engines multiplies it, which is a
 * lifecycle question for whoever owns how many engines exist at once, not
 * something one engine's cache can bound from the inside.
 */
export const DEFAULT_ASSET_CACHE_CAP_BYTES = 1024 * 1024 * 1024;

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
  /**
   * The asset this track's current (or most recent) source plays from. Set by
   * `start`; read by `isAssetPlaying` to decide what the cache cap may evict.
   * Stale while `source` is `null` — harmless, since every read of this field
   * is gated on `source` being non-null first.
   */
  assetId: string | null;
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
   * Transient tracks live in their own map (see `oneShots`) and are only
   * flagged here so `clear` knows not to report an `onItemEnded` for a pad that
   * was never lit. */
  transient: boolean;
  /**
   * The audio-clock time at which this source's scheduled fade-out reaches
   * zero, or `null` if no end has been scheduled.
   *
   * Stored rather than recomputed. `startedAt + contentSeconds` is right for a
   * one-shot but WRONG for a loop flipped to `1×` mid-play, which ends at
   * `startedAt + (k+1)·contentSeconds` for whichever pass was running. A volume
   * change after such a flip calls `cancelScheduledValues`, wiping the tail; if
   * the re-schedule recomputes an end time already in the past, `scheduleTail`
   * writes nothing while `flipLoop`'s `source.stop()` still lands — a hard cut
   * at full volume, in exactly the class of click the 15 ms ramp exists to
   * prevent.
   */
  tailEndTime: number | null;
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

  /** Pad state, keyed by `itemId`. Only `apply` writes here. */
  const tracks = new Map<string, Track>();
  /**
   * Transient `fireOneShot` playback, keyed by `itemId`, kept in a SEPARATE map
   * from the pads.
   *
   * If a random fire shared the pad's track, firing on an item that is also
   * `playing: true` would stop the pad's source (that is `start`'s retrigger)
   * and the next `apply` would then restart the loop from zero with a fresh
   * fade-in — Task 11's scheduler chopping the very ambience it is decorating.
   * Separate keys mean a thunder crack layers over a playing rain bed, which is
   * the actual use case, and Task 11 gains no constraint it has to remember.
   * Retrigger still works: a second fire on an item already cracking retriggers
   * that one-shot, because it is the same key within this map.
   */
  const oneShots = new Map<string, Track>();
  /**
   * The decoded-buffer cache, keyed by `assetId`. Bounded by
   * `assetCacheCapBytes` (see `evictAssets`) rather than left to grow for the
   * engine's whole life — see `DEFAULT_ASSET_CACHE_CAP_BYTES`.
   *
   * Iteration order doubles as recency order: `touchAsset` moves an entry to
   * the end on every access, so `evictAssets` walking front-to-back visits
   * least-recently-used entries first. `Map` preserves insertion order and
   * does NOT reorder on a plain `set` of an existing key, which is why
   * `touchAsset` has to delete-then-set rather than just `set`.
   */
  const assets = new Map<string, EngineAsset>();
  const assetCacheCapBytes = options.assetCacheCapBytes ?? DEFAULT_ASSET_CACHE_CAP_BYTES;
  const pending = new Map<string, Promise<void>>();
  /** Assets whose load returned `null` or threw — never retried. */
  const unplayable = new Set<string>();
  /**
   * Every source that has been started and not yet ended — INCLUDING sources
   * that are stopping but still fading out, which is why `stopTrack` replaces
   * the auto-release handler with a bookkeeping one rather than nulling it.
   *
   * `dispose` stops all of them. That is resource release, not silencing:
   * `master.disconnect()` is what makes dispose inaudible, and the effect of
   * this set is therefore NOT observable in rendered output. It exists so a
   * long-lived `AudioContext` does not accumulate scheduled sources across the
   * lifetime of engines that come and go.
   */
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

  /** Decoded size of one asset's buffer: float32 PCM, 4 bytes per sample per channel. */
  function assetBytes(asset: EngineAsset): number {
    return asset.buffer.length * asset.buffer.numberOfChannels * 4;
  }

  /**
   * True if `assetId`'s buffer is behind a source that is actually sounding
   * right now — a pad in `tracks` or a transient fire in `oneShots`.
   *
   * This is the one rule `evictAssets` may never break: a `Track`'s `source`
   * doubles as "is this pad sounding" throughout the engine (see the `Track`
   * doc comment), so checking it here is the same test every other read of
   * play state uses, not a separate notion of "playing" invented for the
   * cache.
   */
  function isAssetPlaying(assetId: string): boolean {
    for (const track of tracks.values()) {
      if (track.source && track.assetId === assetId) return true;
    }
    for (const track of oneShots.values()) {
      if (track.source && track.assetId === assetId) return true;
    }
    return false;
  }

  /**
   * Moves `assetId` to the most-recently-used end of `assets`'s iteration
   * order. See the `assets` doc comment for why a delete + re-set is needed.
   * A no-op if the asset is not cached (nothing to touch).
   */
  function touchAsset(assetId: string): void {
    const asset = assets.get(assetId);
    if (!asset) return;
    assets.delete(assetId);
    assets.set(assetId, asset);
  }

  /**
   * Evict least-recently-used, not-currently-playing assets until the cache
   * is back at or under `assetCacheCapBytes` — or until nothing left is
   * evictable.
   *
   * Called only after `reconcile` has had a chance to start whatever should
   * be playing (see the call site in `ensureAsset`): a `finally` ordered the
   * other way round would let a just-decoded asset that is about to be
   * played get evicted before `start` ever marks it playing, since at the
   * moment its bytes land in `assets` its track has no source yet.
   *
   * Leaving the cache over cap when everything resident is playing is
   * correct, not a bug: that memory is sound the GM is actually hearing, and
   * the only rule that is not negotiable is that eviction never touches it.
   * An evicted asset is not lost — the next `ensureAsset` for it re-decodes
   * through the exact same path a cold engine uses for a first play.
   */
  function evictAssets(): void {
    let total = 0;
    for (const asset of assets.values()) total += assetBytes(asset);
    if (total <= assetCacheCapBytes) return;
    for (const [assetId, asset] of assets) {
      if (total <= assetCacheCapBytes) break;
      if (isAssetPlaying(assetId)) continue;
      assets.delete(assetId);
      total -= assetBytes(asset);
    }
  }

  function trackFor(itemId: string, transient: boolean): Track {
    const map = transient ? oneShots : tracks;
    const existing = map.get(itemId);
    if (existing) return existing;
    const created: Track = {
      gain: null,
      source: null,
      assetId: null,
      startedAt: 0,
      volume: 1,
      fadeSeconds: 0,
      loop: false,
      contentSeconds: 0,
      transient,
      tailEndTime: null,
    };
    map.set(itemId, created);
    return created;
  }

  /** Free the pad. Called only from the auto-release path (`onended` on a
   * source nobody deliberately stopped). */
  function clear(itemId: string, track: Track): void {
    track.source = null;
    track.gain = null;
    track.tailEndTime = null;
    if (track.transient) {
      // A finished transient leaves nothing to remember, and reports nothing:
      // it never lit a pad, so there is no "it stopped" for Task 12 to act on.
      oneShots.delete(itemId);
      return;
    }
    options.onItemEnded?.(itemId);
  }

  /**
   * Ramp down to zero at `endTime`, from the volume the envelope is currently
   * targeting. Used for a one-shot's tail and for the final pass of a loop that
   * was flipped to `1×`. Always records `endTime` on the track, even when there
   * is no room to ramp, so a later re-schedule knows where the source really
   * ends rather than recomputing it wrongly.
   *
   * `notBefore` guards against writing a `setValueAtTime` on top of a ramp that
   * is still in flight: the volume-change path re-schedules the tail 15 ms
   * before its own slide has landed, and an event at the same instant would
   * replace it and turn the slide into a step.
   *
   * `tailStart` is also clamped past the fade-IN's end — on a buffer shorter
   * than twice the fade the two ramps would otherwise cross, and the tail's
   * `setValueAtTime` would yank the gain up to full mid fade-in.
   */
  function scheduleTail(track: Track, endTime: number, notBefore = ctx.currentTime): void {
    track.tailEndTime = endTime;
    const gain = track.gain;
    if (!gain) return;
    // fade 0 is an instant cut by request; `stop()` at `endTime` does it.
    if (track.fadeSeconds <= 0) return;
    const earliest = Math.max(notBefore, track.startedAt + track.fadeSeconds);
    const tailStart = Math.max(earliest, endTime - track.fadeSeconds);
    // No room left at all (a change landing in the last few ms). Nothing to
    // schedule; the source's own `stop()` ends it.
    if (tailStart >= endTime) return;
    gain.gain.setValueAtTime(track.volume, tailStart);
    gain.gain.linearRampToValueAtTime(0, endTime);
  }

  /**
   * Start a fresh source for `item`. Any source already on the pad is stopped
   * with the 15 ms ramp first — that is the POC's retrigger.
   */
  function start(item: BoardItemState, transient: boolean): void {
    const asset = assets.get(item.assetId);
    if (!asset) return;
    // Mark this asset as freshly used before anything below can be evicted
    // out from under it.
    touchAsset(item.assetId);
    const track = trackFor(item.itemId, transient);
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

    // The auto-release path: a source that reaches its end frees the pad.
    //
    // `track.source === source` is DEFENCE IN DEPTH, not the load-bearing
    // mechanism — it is paired with `stopTrack` replacing this handler before
    // every deliberate stop, and with `start` always routing through `stopTrack`
    // before it replaces a source. With that pairing intact the identity check
    // is unreachable: removing it alone leaves the whole browser suite green
    // (verified). It is kept because removing BOTH reproduces the POC's
    // documented failure — a stale source releasing the pad the new source is
    // playing on — and a future edit that drops the handler swap must not
    // silently also drop the only remaining guard.
    source.onended = () => {
      live.delete(source);
      if (track.source === source) clear(item.itemId, track);
    };

    track.gain = gain;
    track.source = source;
    track.assetId = item.assetId;
    track.startedAt = now;
    track.volume = item.volume;
    track.fadeSeconds = fade;
    track.loop = loop;
    track.contentSeconds = content;
    track.transient = transient;
    track.tailEndTime = null;

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
    //
    // The POC sets `onended = null` here. This SWAPS it for a bookkeeping
    // handler instead, which honours the same requirement (it never reaches
    // `clear`) while keeping two things true that nulling it would break: the
    // source stays in `live` until it has actually finished fading, so
    // `dispose` can stop it; and the detached gain node — reachable from
    // nothing but this dying source — gets an explicit `disconnect()` rather
    // than waiting on graph GC.
    source.onended = () => {
      live.delete(source);
      gain.disconnect();
    };
    source.stop(now + fade);

    track.source = null;
    track.gain = null;
    track.tailEndTime = null;
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
        // AFTER reconcile, not before: reconcile is what starts this asset
        // playing if it should be, and `evictAssets` must see that before it
        // decides what is safe to evict. See `evictAssets`'s doc comment.
        if (!disposed) evictAssets();
      });
    pending.set(assetId, load);
  }

  function reconcile(state: BoardState): void {
    if (disposed) return;

    if (state.masterVolume !== masterVolume) {
      masterVolume = state.masterVolume;
      const now = ctx.currentTime;
      // Ramped, not stepped. A GM dragging the master slider produces a stream
      // of these, and `setValueAtTime` on every one is a stair of
      // discontinuities — zipper noise. Same 15 ms slide the per-pad volume
      // uses, and the same cancel → pin → ramp shape so consecutive drags
      // compose instead of fighting.
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(masterVolume, now + IMMEDIATE_FADE_SECONDS);
    }

    const seen = new Set<string>();

    for (const item of state.items) {
      seen.add(item.itemId);
      const track = tracks.get(item.itemId);

      // Refresh the fade BEFORE anything can consume it. A `setMood` can change
      // an item's `fadeSeconds` while it is already playing, and the very next
      // thing that reads it may be this same reconcile's stop branch below —
      // which would otherwise fade out over the PREVIOUS mood's fade. The
      // in-flight fade-in keeps its original schedule (re-timing a ramp already
      // half-run has no meaningful "correct" answer); the new value governs the
      // stop, the tail, and every later start.
      if (track?.source && item.fadeSeconds !== track.fadeSeconds) {
        track.fadeSeconds = item.fadeSeconds;
      }

      if (item.playing) {
        ensureAsset(item.assetId);
        if (!track?.source) {
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
          // `cancelScheduledValues` just wiped any pending tail. Put it back at
          // the end time that was actually scheduled — NOT a recomputed
          // `startedAt + contentSeconds`, which is wrong for a loop flipped to
          // `1×` on any pass after the first. `notBefore` keeps it clear of the
          // 15 ms slide just scheduled above.
          if (track.tailEndTime !== null) {
            scheduleTail(track, track.tailEndTime, now + IMMEDIATE_FADE_SECONDS);
          }
        }

        if (item.loop !== track.loop) flipLoop(item, track);
        continue;
      }

      if (track?.source) stopTrack(item.itemId, track, false);
    }

    // Items that vanished from the package entirely (a `loadPackage` to a
    // different package, an item deleted while the board was open).
    for (const [itemId, track] of tracks) {
      if (seen.has(itemId)) continue;
      if (track.source) stopTrack(itemId, track, false);
      tracks.delete(itemId);
    }
    // A transient fire on a vanished item is left to finish — it is already
    // decoupled from the pad — but its bookkeeping entry is dropped once it has.
    for (const [itemId, track] of oneShots) {
      if (!seen.has(itemId) && !track.source) oneShots.delete(itemId);
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

    if (track.tailEndTime !== null) {
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
      oneShots.clear();
      // This, not the loop above, is what makes dispose silent.
      master.disconnect();
    },
  };
}
