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
