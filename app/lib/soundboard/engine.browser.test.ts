import { describe, it, expect } from 'vitest';
import { createEngine, type EngineAsset } from '~/lib/soundboard/engine';
import type { BoardItemState, BoardState } from '~/lib/soundboard/reducer';
import { AUDIO_RENDITION_SAMPLE_RATE } from '~/types/audio';

/**
 * The engine's tests run in a real browser against a real `OfflineAudioContext`
 * and assert on MEASURED SAMPLE VALUES, never on "was this method called".
 *
 * Mocking Web Audio here would repeat phase 1's central failure — mocked
 * mongoose passed every unit test while the audio library was broken end to
 * end. A mock returns whatever it was told to; only rendered samples can say
 * whether a fade actually ramped.
 *
 * The measuring trick: every fixture buffer is DC — every sample is exactly
 * `1.0`. A constant signal through a gain graph comes out as the gain itself,
 * so `rendered[t * sampleRate]` IS the product of the pad's gain and the master
 * gain at time `t`. That makes the whole envelope directly readable.
 */

const SR = 48_000;

/** Where in the rendered output time `t` lands. */
function at(rendered: AudioBuffer, t: number, channel = 0): number {
  return rendered.getChannelData(channel)[Math.round(t * rendered.sampleRate)];
}

/** The largest sample in `[from, to)` — used to prove a gain never jumped. */
function peakBetween(rendered: AudioBuffer, from: number, to: number, channel = 0): number {
  const data = rendered.getChannelData(channel);
  let peak = -Infinity;
  for (
    let i = Math.round(from * rendered.sampleRate);
    i < Math.round(to * rendered.sampleRate);
    i++
  ) {
    if (data[i] > peak) peak = data[i];
  }
  return peak;
}

function minBetween(rendered: AudioBuffer, from: number, to: number, channel = 0): number {
  const data = rendered.getChannelData(channel);
  let low = Infinity;
  for (
    let i = Math.round(from * rendered.sampleRate);
    i < Math.round(to * rendered.sampleRate);
    i++
  ) {
    if (data[i] < low) low = data[i];
  }
  return low;
}

/**
 * A DC buffer: `contentSeconds` of exactly 1.0, then `padSeconds` of silence.
 *
 * The padding is the point for the looping test. Real AAC encoder delay/padding
 * cannot be produced inside an `OfflineAudioContext` — there is no encoder in
 * the browser's audio graph, only `decodeAudioData` on bytes we would have to
 * ship as a fixture. So the discrepancy is constructed rather than encoded:
 * `buffer.duration` is `content + pad`, while the asset's `durationSamples`
 * counts the content alone, exactly as the worker's measurement does for a
 * padded AAC rendition. An implementation that loops on `buffer.duration`
 * therefore plays the silence on every repeat, which the rendered output shows.
 *
 * `activeChannel` lets a stereo fixture put one item on the left and another on
 * the right, so two items playing at once stay separately measurable.
 */
function dcBuffer(
  ctx: BaseAudioContext,
  contentSeconds: number,
  { padSeconds = 0, channels = 1, activeChannel = -1 }: BufferOptions = {}
): AudioBuffer {
  const contentSamples = Math.round(contentSeconds * SR);
  const padSamples = Math.round(padSeconds * SR);
  const buffer = ctx.createBuffer(channels, contentSamples + padSamples, SR);
  for (let ch = 0; ch < channels; ch++) {
    if (activeChannel >= 0 && ch !== activeChannel) continue;
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < contentSamples; i++) data[i] = 1;
  }
  return buffer;
}

type BufferOptions = { padSeconds?: number; channels?: number; activeChannel?: number };

function boardItem(
  over: Partial<BoardItemState> & { itemId: string; assetId: string }
): BoardItemState {
  return {
    playing: false,
    volume: 1,
    fadeSeconds: 0,
    randomIntervalMin: undefined,
    randomIntervalMax: undefined,
    loop: false,
    ...over,
  };
}

function board(items: BoardItemState[], masterVolume = 1): BoardState {
  // `pkg`/`moodId` are the reducer's business; the engine never reads them.
  return { pkg: null, moodId: null, items, masterVolume };
}

function loaderFor(assets: Record<string, EngineAsset>) {
  return (assetId: string) => Promise.resolve(assets[assetId] ?? null);
}

/**
 * Same as `loaderFor`, plus a call count per `assetId`. The asset cache is
 * private engine state — the number of times `loadAsset` gets asked for a
 * given id is the only black-box signal of whether that id's buffer is still
 * cached (1 call) or was evicted and had to be re-decoded (2+ calls).
 */
function countingLoader(assets: Record<string, EngineAsset>): {
  loadAsset: (assetId: string) => Promise<EngineAsset | null>;
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};
  const loadAsset = (assetId: string) => {
    calls[assetId] = (calls[assetId] ?? 0) + 1;
    return Promise.resolve(assets[assetId] ?? null);
  };
  return { loadAsset, calls };
}

describe('createEngine — fades', () => {
  it('fades in on a clean linear ramp that reaches the target at exactly t = fade', async () => {
    const ctx = new OfflineAudioContext(1, 3 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 3), durationSamples: 3 * SR } }),
    });

    engine.apply(
      board([
        boardItem({
          itemId: 'storm',
          assetId: 'a1',
          playing: true,
          volume: 0.8,
          fadeSeconds: 2,
          loop: true,
        }),
      ])
    );
    await engine.ready();
    const rendered = await ctx.startRendering();

    // Linear: gain(t) = 0.8 * t / 2.
    expect(at(rendered, 0)).toBeCloseTo(0, 4);
    expect(at(rendered, 0.5)).toBeCloseTo(0.2, 3);
    expect(at(rendered, 1)).toBeCloseTo(0.4, 3);
    expect(at(rendered, 1.5)).toBeCloseTo(0.6, 3);
    // Target reached at exactly t = fade, and held there afterwards.
    expect(at(rendered, 2)).toBeCloseTo(0.8, 4);
    expect(at(rendered, 2.5)).toBeCloseTo(0.8, 4);
    // It never overshoots on the way up.
    expect(peakBetween(rendered, 0, 2)).toBeLessThanOrEqual(0.8 + 1e-6);
  });

  it('gives each item its own fade — a 4 s storm is mid-ramp while a 0.5 s battle is already full', async () => {
    const ctx = new OfflineAudioContext(2, 3 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({
        // Left channel only / right channel only, so the summed output still
        // reports each item's gain separately.
        storm: {
          buffer: dcBuffer(ctx, 3, { channels: 2, activeChannel: 0 }),
          durationSamples: 3 * SR,
        },
        battle: {
          buffer: dcBuffer(ctx, 3, { channels: 2, activeChannel: 1 }),
          durationSamples: 3 * SR,
        },
      }),
    });

    engine.apply(
      board([
        boardItem({
          itemId: 'storm',
          assetId: 'storm',
          playing: true,
          volume: 0.8,
          fadeSeconds: 4,
          loop: true,
        }),
        boardItem({
          itemId: 'battle',
          assetId: 'battle',
          playing: true,
          volume: 0.8,
          fadeSeconds: 0.5,
          loop: true,
        }),
      ])
    );
    await engine.ready();
    const rendered = await ctx.startRendering();

    // Battle is at full by its own 0.5 s; storm is still climbing.
    expect(at(rendered, 0.5, 1)).toBeCloseTo(0.8, 4);
    expect(at(rendered, 0.5, 0)).toBeCloseTo(0.1, 3);
    // The POC's measurement: storm @4 s sits at 0.4 (half of 0.8, at half of 4 s)
    // while battle @0.5 s is long since full.
    expect(at(rendered, 2, 0)).toBeCloseTo(0.4, 3);
    expect(at(rendered, 2, 1)).toBeCloseTo(0.8, 4);
    // Two different envelopes, at the same instant, from one `apply`.
    expect(at(rendered, 2, 0)).not.toBeCloseTo(at(rendered, 2, 1), 2);
  });

  it('ramps DOWN from wherever the gain actually is when a fade-in is interrupted', async () => {
    const ctx = new OfflineAudioContext(1, 6 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 6), durationSamples: 6 * SR } }),
    });
    const on = board([
      boardItem({
        itemId: 'storm',
        assetId: 'a1',
        playing: true,
        volume: 0.8,
        fadeSeconds: 4,
        loop: true,
      }),
    ]);
    const off = board([
      boardItem({
        itemId: 'storm',
        assetId: 'a1',
        playing: false,
        volume: 0.8,
        fadeSeconds: 4,
        loop: true,
      }),
    ]);

    engine.apply(on);
    await engine.ready();

    // Interrupt one quarter of the way into a 4 s fade-in, i.e. at gain ~0.2 —
    // the POC's 0.201 case.
    void ctx.suspend(1).then(() => {
      engine.apply(off);
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    const atInterrupt = at(rendered, 1);
    expect(atInterrupt).toBeCloseTo(0.2, 2);

    // THE ASSERTION THIS TEST EXISTS FOR. Without `setValueAtTime(gain.value,
    // now)` the param reverts to its last set value and LEAPS to 0.8 before
    // fading out. Nothing after the interrupt may exceed where it was.
    expect(peakBetween(rendered, 1, 6)).toBeLessThanOrEqual(atInterrupt + 1e-4);
    // And it is a ramp down, not a cut: still sounding, quieter, at every step.
    expect(at(rendered, 2)).toBeCloseTo(0.15, 2);
    expect(at(rendered, 3)).toBeCloseTo(0.1, 2);
    expect(at(rendered, 4)).toBeCloseTo(0.05, 2);
    expect(at(rendered, 5)).toBeCloseTo(0, 4);
  });

  it('starts at full when fade is 0, without throwing', async () => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 1), durationSamples: SR } }),
    });

    expect(() =>
      engine.apply(
        board([
          boardItem({
            itemId: 'fireball',
            assetId: 'a1',
            playing: true,
            volume: 0.8,
            fadeSeconds: 0,
            loop: true,
          }),
        ])
      )
    ).not.toThrow();
    await engine.ready();
    const rendered = await ctx.startRendering();

    expect(at(rendered, 0)).toBeCloseTo(0.8, 5);
    expect(at(rendered, 0.001)).toBeCloseTo(0.8, 5);
    expect(minBetween(rendered, 0, 0.9)).toBeCloseTo(0.8, 5);
  });
});

describe('createEngine — the graph', () => {
  it('routes each pad through its own gain into the master gain', async () => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 1), durationSamples: SR } }),
    });

    engine.apply(
      board(
        [
          boardItem({
            itemId: 'storm',
            assetId: 'a1',
            playing: true,
            volume: 0.8,
            fadeSeconds: 0,
            loop: true,
          }),
        ],
        0.5
      )
    );
    await engine.ready();
    const rendered = await ctx.startRendering();

    // 0.8 (pad) x 0.5 (master). A pad wired straight to the destination reads
    // 0.8; a master applied instead of the pad's own volume reads 0.5.
    expect(at(rendered, 0.5)).toBeCloseTo(0.4, 5);
  });
});

describe('createEngine — looping', () => {
  it('loops on the measured content length, not on buffer.duration', async () => {
    const ctx = new OfflineAudioContext(1, 3 * SR, SR);
    // 1.000 s of content followed by 0.250 s standing in for encoder padding.
    const buffer = dcBuffer(ctx, 1, { padSeconds: 0.25 });
    const durationSamples = SR;
    // The fixture only has teeth if the two candidate loop points genuinely
    // differ. A fixture whose padding happened to be zero would pass under BOTH
    // implementations and prove nothing.
    expect(buffer.duration).toBeCloseTo(1.25, 5);
    expect(durationSamples / AUDIO_RENDITION_SAMPLE_RATE).toBeCloseTo(1, 5);
    expect(durationSamples / AUDIO_RENDITION_SAMPLE_RATE).not.toBeCloseTo(buffer.duration, 2);

    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer, durationSamples } }),
    });

    engine.apply(
      board([
        boardItem({
          itemId: 'rain',
          assetId: 'a1',
          playing: true,
          volume: 1,
          fadeSeconds: 0,
          loop: true,
        }),
      ])
    );
    await engine.ready();
    const rendered = await ctx.startRendering();

    // Under a `buffer.duration` implementation the padding is played on every
    // repeat, so [1.00, 1.25) and [2.25, 2.50) are silence. Sample right inside
    // those windows.
    expect(at(rendered, 1.1)).toBeCloseTo(1, 5);
    expect(at(rendered, 2.3)).toBeCloseTo(1, 5);
    // And, wholesale: the loop is gapless for the entire render.
    expect(minBetween(rendered, 0, 3)).toBeCloseTo(1, 5);
  });

  it('finishes the current pass, then releases the pad, when loop is flipped off mid-play', async () => {
    const ctx = new OfflineAudioContext(1, 4 * SR, SR);
    const ended: string[] = [];
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 1), durationSamples: SR } }),
      onItemEnded: (itemId) => ended.push(itemId),
    });
    const looping = boardItem({
      itemId: 'chant',
      assetId: 'a1',
      playing: true,
      volume: 1,
      fadeSeconds: 0,
      loop: true,
    });

    engine.apply(board([looping]));
    await engine.ready();

    // Flip to 1x halfway through the second pass. It must play out to the end
    // of THAT pass (t = 2.0), not stop where the click landed.
    void ctx.suspend(1.5).then(() => {
      engine.apply(board([{ ...looping, loop: false }]));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    expect(at(rendered, 1.9)).toBeCloseTo(1, 5);
    expect(at(rendered, 2.1)).toBeCloseTo(0, 5);
    expect(minBetween(rendered, 0, 1.99)).toBeCloseTo(1, 5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ended).toEqual(['chant']);
  });

  it('keeps the final-pass fade-out when the volume changes after a mid-play flip to 1x', async () => {
    const ctx = new OfflineAudioContext(1, 3 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 1), durationSamples: SR } }),
    });
    const item = boardItem({
      itemId: 'chant',
      assetId: 'a1',
      playing: true,
      volume: 1,
      fadeSeconds: 1,
      loop: true,
    });

    engine.apply(board([item]));
    await engine.ready();

    // Flip to 1x halfway through the SECOND pass: the source really ends at
    // t = 2.0, which is `startedAt + 2 x contentSeconds`, not
    // `startedAt + contentSeconds`.
    void ctx.suspend(1.5).then(() => {
      engine.apply(board([{ ...item, loop: false }]));
      void ctx.resume();
    });
    // Then nudge the volume, which calls `cancelScheduledValues` and wipes the
    // tail ramp. Re-scheduling it from a recomputed `startedAt + contentSeconds`
    // yields t = 1.0 — already in the past — so nothing is written while
    // `flipLoop`'s `stop(2.0)` still lands: a hard cut at full volume.
    void ctx.suspend(1.7).then(() => {
      engine.apply(board([{ ...item, loop: false, volume: 0.5 }]));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    // The pass still runs to 2.0 …
    expect(at(rendered, 1.6)).toBeCloseTo(0.8, 2);
    // … and still arrives there at zero rather than at the new volume.
    expect(at(rendered, 1.85)).toBeGreaterThan(0.2);
    expect(at(rendered, 1.85)).toBeLessThan(0.32);
    expect(at(rendered, 1.99)).toBeLessThan(0.05);
    expect(peakBetween(rendered, 1.95, 2)).toBeLessThan(0.1);
    expect(at(rendered, 2.05)).toBeCloseTo(0, 5);
  });
});

describe('createEngine — one-shots', () => {
  it('releases its pad at the end of the buffer', async () => {
    const ctx = new OfflineAudioContext(1, 2 * SR, SR);
    const ended: string[] = [];
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 1), durationSamples: SR } }),
      onItemEnded: (itemId) => ended.push(itemId),
    });

    engine.apply(
      board([
        boardItem({
          itemId: 'fireball',
          assetId: 'a1',
          playing: true,
          volume: 1,
          fadeSeconds: 0,
          loop: false,
        }),
      ])
    );
    await engine.ready();
    const rendered = await ctx.startRendering();

    expect(at(rendered, 0.9)).toBeCloseTo(1, 5);
    expect(at(rendered, 1.1)).toBeCloseTo(0, 5);
    expect(peakBetween(rendered, 1.01, 2)).toBeCloseTo(0, 5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ended).toEqual(['fireball']);
  });

  it('retriggers on a second fire, ramping the outgoing source down rather than cutting it', async () => {
    const ctx = new OfflineAudioContext(1, 4 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 2), durationSamples: 2 * SR } }),
    });

    engine.apply(
      board([
        boardItem({
          itemId: 'thunder',
          assetId: 'a1',
          playing: false,
          volume: 1,
          fadeSeconds: 0,
          loop: false,
        }),
      ])
    );
    engine.fireOneShot('thunder');
    await engine.ready();
    engine.fireOneShot('thunder');

    void ctx.suspend(1).then(() => {
      engine.fireOneShot('thunder');
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    // A fresh 2 s source started at t = 1, so the sound now runs to t = 3
    // instead of ending with the first fire at t = 2.
    expect(at(rendered, 2.5)).toBeCloseTo(1, 5);
    expect(at(rendered, 3.1)).toBeCloseTo(0, 5);
    // The outgoing source does not cut: for 15 ms both are audible and the old
    // one is ramping, so the sum sits strictly between 1 and 2 and settles at 1.
    expect(at(rendered, 1.0075)).toBeGreaterThan(1.2);
    expect(at(rendered, 1.0075)).toBeLessThan(1.8);
    expect(at(rendered, 1.02)).toBeCloseTo(1, 5);
    expect(peakBetween(rendered, 0, 4)).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('leaves a transient fire alone when unrelated board state changes', async () => {
    const ctx = new OfflineAudioContext(1, 2 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 2), durationSamples: 2 * SR } }),
    });
    const idle = board([
      boardItem({
        itemId: 'thunder',
        assetId: 'a1',
        playing: false,
        volume: 1,
        fadeSeconds: 0,
        loop: false,
      }),
    ]);

    engine.apply(idle);
    engine.fireOneShot('thunder');
    await engine.ready();
    engine.fireOneShot('thunder');

    // A master-volume nudge mid-crack. `fireOneShot` leaves no mark on
    // `BoardState`, so a reconcile that treated `playing: false` as "stop it"
    // would silence every random ambient the moment anything else changed.
    void ctx.suspend(1).then(() => {
      engine.apply(board(idle.items, 1));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    expect(at(rendered, 1.5)).toBeCloseTo(1, 5);
  });

  it('layers over a pad that is already playing instead of stealing it', async () => {
    const ctx = new OfflineAudioContext(1, 3 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 1), durationSamples: SR } }),
    });
    // A looping rain bed that Task 11's scheduler will also fire one-shots on.
    const rain = boardItem({
      itemId: 'rain',
      assetId: 'a1',
      playing: true,
      volume: 1,
      fadeSeconds: 0.5,
      loop: true,
    });

    engine.apply(board([rain]));
    await engine.ready();
    void ctx.suspend(1).then(() => {
      engine.fireOneShot('rain');
      void ctx.resume();
    });
    // A later reconcile, after the crack has finished. If the fire had taken the
    // pad's own track, this would find no source and re-attack the loop from
    // zero with a fresh fade-in — the scheduler chopping its own ambience.
    void ctx.suspend(2.5).then(() => {
      engine.apply(board([rain]));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    expect(at(rendered, 0.75)).toBeCloseTo(1, 5);
    // Both sounding: the bed at 1, the crack riding its own 0.5 s envelope.
    expect(at(rendered, 1.25)).toBeCloseTo(1.5, 3);
    expect(at(rendered, 1.5)).toBeCloseTo(2, 3);
    expect(at(rendered, 1.75)).toBeCloseTo(1.5, 3);
    // Crack over, bed untouched — and still untouched by the later reconcile.
    expect(at(rendered, 2.05)).toBeCloseTo(1, 5);
    expect(at(rendered, 2.6)).toBeCloseTo(1, 5);
    expect(at(rendered, 2.9)).toBeCloseTo(1, 5);
  });
});

describe('createEngine — pad ownership', () => {
  it('leaves the pad owned by the newest source after a fast off/on', async () => {
    const ctx = new OfflineAudioContext(1, 3 * SR, SR);
    const ended: string[] = [];
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 2), durationSamples: 2 * SR } }),
      onItemEnded: (itemId) => ended.push(itemId),
    });
    const item = boardItem({
      itemId: 'horn',
      assetId: 'a1',
      playing: true,
      volume: 1,
      fadeSeconds: 0,
      loop: false,
    });

    engine.apply(board([item]));
    await engine.ready();

    // Off and straight back on. The replacement source now owns the pad; the
    // outgoing one must not release it out from under the replacement.
    void ctx.suspend(0.5).then(() => {
      engine.apply(board([{ ...item, playing: false }]));
      engine.apply(board([item]));
      void ctx.resume();
    });
    // If the pad had been released by the stale source, this stop finds nothing
    // to stop and the replacement runs on to t = 2.5.
    void ctx.suspend(1).then(() => {
      engine.apply(board([{ ...item, playing: false }]));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    expect(at(rendered, 0.9)).toBeCloseTo(1, 5);
    expect(peakBetween(rendered, 1.01, 3)).toBeCloseTo(0, 5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Both stops were deliberate, so neither reports an auto-release.
    expect(ended).toEqual([]);
  });
});

describe('createEngine — volume and teardown', () => {
  it('ramps to a new item volume mid-play instead of stepping', async () => {
    const ctx = new OfflineAudioContext(1, 2 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 2), durationSamples: 2 * SR } }),
    });
    const item = boardItem({
      itemId: 'storm',
      assetId: 'a1',
      playing: true,
      volume: 0.8,
      fadeSeconds: 0,
      loop: true,
    });

    engine.apply(board([item]));
    await engine.ready();
    void ctx.suspend(1).then(() => {
      engine.apply(board([{ ...item, volume: 0.2 }]));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    expect(at(rendered, 0.9)).toBeCloseTo(0.8, 5);
    // Mid-ramp, halfway through the 15 ms slide.
    expect(at(rendered, 1.0075)).toBeCloseTo(0.5, 2);
    expect(at(rendered, 1.05)).toBeCloseTo(0.2, 5);
  });

  it('ramps the master volume too, so a slider drag does not zipper', async () => {
    const ctx = new OfflineAudioContext(1, 2 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 2), durationSamples: 2 * SR } }),
    });
    const item = boardItem({
      itemId: 'storm',
      assetId: 'a1',
      playing: true,
      volume: 1,
      fadeSeconds: 0,
      loop: true,
    });

    engine.apply(board([item], 1));
    await engine.ready();
    void ctx.suspend(1).then(() => {
      engine.apply(board([item], 0.25));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    expect(at(rendered, 0.9)).toBeCloseTo(1, 5);
    // Halfway through the same 15 ms slide the per-pad volume uses. A
    // `setValueAtTime` step would already read 0.25 here.
    expect(at(rendered, 1.0075)).toBeCloseTo(0.625, 2);
    expect(at(rendered, 1.05)).toBeCloseTo(0.25, 5);
  });

  it('fades out over the new fadeSeconds when a mood changed it mid-play', async () => {
    const ctx = new OfflineAudioContext(1, 4 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 4), durationSamples: 4 * SR } }),
    });
    const item = boardItem({
      itemId: 'storm',
      assetId: 'a1',
      playing: true,
      volume: 1,
      fadeSeconds: 2,
      loop: true,
    });

    engine.apply(board([item]));
    await engine.ready();
    // A mood switch that both stops the item and shortens its fade, in one
    // apply. The stop must use the NEW 0.5 s, not the 2 s it started with.
    void ctx.suspend(1).then(() => {
      engine.apply(board([{ ...item, fadeSeconds: 0.5, playing: false }]));
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    // Interrupted mid fade-in at 0.5, then down to zero by t = 1.5.
    expect(at(rendered, 1)).toBeCloseTo(0.5, 3);
    expect(at(rendered, 1.25)).toBeCloseTo(0.25, 2);
    expect(at(rendered, 1.55)).toBeCloseTo(0, 5);
    // Under the previous fade the ramp would still be at ~0.25 here.
    expect(peakBetween(rendered, 1.55, 4)).toBeCloseTo(0, 5);
  });

  it('dispose() silences everything immediately', async () => {
    const ctx = new OfflineAudioContext(1, 2 * SR, SR);
    const engine = createEngine(ctx, {
      loadAsset: loaderFor({ a1: { buffer: dcBuffer(ctx, 2), durationSamples: 2 * SR } }),
    });

    engine.apply(
      board([
        boardItem({
          itemId: 'storm',
          assetId: 'a1',
          playing: true,
          volume: 1,
          fadeSeconds: 0,
          loop: true,
        }),
      ])
    );
    await engine.ready();
    void ctx.suspend(1).then(() => {
      engine.dispose();
      void ctx.resume();
    });
    const rendered = await ctx.startRendering();

    expect(at(rendered, 0.9)).toBeCloseTo(1, 5);
    expect(peakBetween(rendered, 1.01, 2)).toBeCloseTo(0, 5);
  });
});

describe('createEngine — decoded-buffer cache cap', () => {
  // Real fixtures, real bytes: three 0.01 s mono buffers, 480 samples each.
  // `assetCacheCapBytes` is overridden per test so the cap is genuinely
  // crossed by a few KB of fixture instead of requiring gigabytes of real
  // decoded audio to prove the same thing.
  const BYTES_PER_ASSET = 480 * 1 * 4; // mono, float32 — 1920 bytes.

  function tinyAsset(ctx: BaseAudioContext): EngineAsset {
    return { buffer: dcBuffer(ctx, 0.01), durationSamples: 480 };
  }

  it('evicts an idle asset past the cap, and never the one still playing', async () => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    const fixtures: Record<string, EngineAsset> = {
      a: tinyAsset(ctx),
      b: tinyAsset(ctx),
      c: tinyAsset(ctx),
    };
    const { loadAsset, calls } = countingLoader(fixtures);
    // Room for two assets, not three — the fixture only has teeth if loading
    // the third genuinely crosses the cap rather than approaching it.
    const assetCacheCapBytes = BYTES_PER_ASSET * 2 + 1;
    const engine = createEngine(ctx, { loadAsset, assetCacheCapBytes });

    const itemA = boardItem({ itemId: 'a', assetId: 'a', playing: true, volume: 1, loop: true });
    const itemB = boardItem({ itemId: 'b', assetId: 'b', playing: true, volume: 1, loop: true });
    const itemC = boardItem({ itemId: 'c', assetId: 'c', playing: true, volume: 1, loop: true });

    // a loads and is left playing for the rest of the test — the
    // "currently playing" asset. It is also the OLDEST cache entry once b
    // and c have loaded, which matters below: a plain LRU-by-age policy
    // would reach for it first and get this exactly backwards.
    engine.apply(board([itemA]));
    await engine.ready();

    // b loads, plays briefly, then stops — idle, but still resident.
    engine.apply(board([itemA, itemB]));
    await engine.ready();
    engine.apply(board([itemA, { ...itemB, playing: false }]));
    await engine.ready();
    expect(calls.a).toBe(1);
    expect(calls.b).toBe(1);

    // c loads. a + b + c is three assets' worth of bytes — over cap. a is
    // playing and idle-b is not; eviction must take b.
    engine.apply(board([itemA, { ...itemB, playing: false }, itemC]));
    await engine.ready();

    // Retrigger a: stop it, then immediately restart it. If a survived
    // eviction this is a synchronous restart — its buffer is still in the
    // cache, so no new decode is needed. If a was wrongly evicted instead of
    // b, `start` finds no buffer and reconcile has to re-request it.
    engine.apply(board([{ ...itemA, playing: false }, { ...itemB, playing: false }, itemC]));
    engine.apply(board([itemA, { ...itemB, playing: false }, itemC]));
    await engine.ready();
    expect(calls.a).toBe(1);

    // b, in contrast, must have been evicted — playing it again needs a
    // fresh decode.
    engine.apply(board([itemA, itemB, itemC]));
    await engine.ready();
    expect(calls.b).toBe(2);

    // Nothing here should have thrown or left the graph in a bad state.
    await expect(ctx.startRendering()).resolves.toBeTruthy();
  });

  it('re-decodes an evicted asset on next play, and it actually plays — not a silent no-op', async () => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    const fixtures: Record<string, EngineAsset> = { x: tinyAsset(ctx), y: tinyAsset(ctx) };
    const { loadAsset, calls } = countingLoader(fixtures);
    const errors: Array<{ assetId: string; error: unknown }> = [];
    // Room for exactly one of these assets at a time.
    const assetCacheCapBytes = BYTES_PER_ASSET + 1;
    const engine = createEngine(ctx, {
      loadAsset,
      assetCacheCapBytes,
      onLoadError: (assetId, error) => errors.push({ assetId, error }),
    });

    const itemX = boardItem({ itemId: 'x', assetId: 'x', playing: true, volume: 1, loop: true });
    const itemY = boardItem({ itemId: 'y', assetId: 'y', playing: true, volume: 1, loop: true });

    // x loads and plays, then stops — idle, but still cached.
    engine.apply(board([itemX]));
    await engine.ready();
    engine.apply(board([{ ...itemX, playing: false }]));
    await engine.ready();

    // y loads and plays. x + y is two assets' worth of bytes against a
    // one-asset cap — over cap. x is idle and y is playing, so eviction must
    // take x, not y.
    engine.apply(board([{ ...itemX, playing: false }, itemY]));
    await engine.ready();
    expect(calls.x).toBe(1);

    // Stop y, then play x again. x's buffer is gone — this must re-decode
    // rather than leaving the pad silently unlit.
    engine.apply(board([itemX, { ...itemY, playing: false }]));
    await engine.ready();

    expect(calls.x).toBe(2);
    expect(errors).toEqual([]);

    const rendered = await ctx.startRendering();
    // Not just "no error" — actually sounding, at the volume x was given.
    expect(at(rendered, 0.005)).toBeCloseTo(1, 4);
  });

  it('fires a cold one-shot correctly even when the cache is fully saturated with playing assets', async () => {
    // Stereo, and the two beds vs. the one-shot are put on separate channels
    // (the same isolation trick the fades tests use) — on a single shared
    // channel, "the beds are playing" and "the one-shot also played" sum
    // together and become indistinguishable in the rendered output.
    const ctx = new OfflineAudioContext(2, SR, SR);
    const bedBuffer = () => dcBuffer(ctx, 0.01, { channels: 2, activeChannel: 0 });
    const oneShotBuffer = () => dcBuffer(ctx, 0.01, { channels: 2, activeChannel: 1 });
    const bytesPerStereoAsset = 480 * 2 * 4; // 3840 bytes.
    const fixtures: Record<string, EngineAsset> = {
      p1: { buffer: bedBuffer(), durationSamples: 480 },
      p2: { buffer: bedBuffer(), durationSamples: 480 },
      c: { buffer: oneShotBuffer(), durationSamples: 480 },
    };
    const { loadAsset, calls } = countingLoader(fixtures);
    const errors: Array<{ assetId: string; error: unknown }> = [];
    // Room for exactly the two beds below — zero idle headroom once both are
    // playing. This is not a contrived corner: the cap's own derivation notes
    // that two long ambience beds playing together already consume the whole
    // 1 GiB production cap, so "nothing evictable" is the normal state of a
    // busy board, not an edge case.
    const assetCacheCapBytes = bytesPerStereoAsset * 2;
    const engine = createEngine(ctx, {
      loadAsset,
      assetCacheCapBytes,
      onLoadError: (assetId, error) => errors.push({ assetId, error }),
    });

    const p1 = boardItem({ itemId: 'p1', assetId: 'p1', playing: true, volume: 1, loop: true });
    const p2 = boardItem({ itemId: 'p2', assetId: 'p2', playing: true, volume: 1, loop: true });
    // Never played as a pad (`playing: false`) — only ever reached through
    // `fireOneShot`, so its asset is genuinely cold when fired below.
    const cItem = boardItem({ itemId: 'c', assetId: 'c', playing: false, volume: 1, loop: false });

    // Both beds load and are left playing. The cache is now exactly at cap,
    // nothing idle to reclaim.
    engine.apply(board([p1, p2]));
    await engine.ready();
    expect(calls.p1).toBe(1);
    expect(calls.p2).toBe(1);

    // Fire a one-shot on the third, never-loaded asset. Decoding it pushes
    // the cache over cap with both beds still playing — the only thing
    // `evictAssets` could otherwise reach for is the one-shot's own
    // just-landed buffer, before `fireOneShot`'s own continuation ever gets a
    // turn to call `start` and mark it playing. That race is exactly what
    // `firingOneShots` exists to close.
    engine.apply(board([p1, p2, cItem]));
    engine.fireOneShot('c');
    await engine.ready();

    expect(calls.c).toBe(1);
    expect(errors).toEqual([]);

    const rendered = await ctx.startRendering();
    // c's own channel: silence here would mean the fire was dropped — the
    // assertion that actually rules that out, not just "no thrown error".
    expect(at(rendered, 0.005, 1)).toBeCloseTo(1, 4);
    // Sanity: the beds are still there too, undisturbed by the one-shot.
    expect(at(rendered, 0.005, 0)).toBeCloseTo(2, 4);
  });
});
