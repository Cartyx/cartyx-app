import { expect, it } from 'vitest';
import { createEngine, type EngineAsset } from './engine';
import { boardReducer, type BoardState, type BoardItemState } from './reducer';
import { createScheduler } from './scheduler';

function fixture() {
  const context = new OfflineAudioContext(1, 48000, 48000);
  const buffer = context.createBuffer(1, 48000, 48000);
  buffer.getChannelData(0).fill(1);
  const item: BoardItemState = {
    itemId: 'thunder',
    assetId: 'audio',
    playing: false,
    volume: 1,
    fadeSeconds: 0,
    loop: false,
    randomIntervalMin: undefined,
    randomIntervalMax: undefined,
  };
  const state: BoardState = { pkg: null, moodId: null, masterVolume: 1, items: [item] };
  const asset: EngineAsset = { buffer, durationSamples: 48000 };
  return { context, state, asset };
}

it('plays successive scheduled one-shots without disarming the pad', async () => {
  const { context, state, asset } = fixture();
  asset.durationSamples = 4800;
  let current: BoardState = {
    ...state,
    items: [{ ...state.items[0], playing: true, randomIntervalMin: 1, randomIntervalMax: 1 }],
  };
  const callbacks: Array<() => void> = [];
  const engine = createEngine(context, {
    loadAsset: async () => asset,
    onItemEnded: (itemId) => {
      current = boardReducer(current, { type: 'stop', itemId });
      scheduler.sync(current);
    },
  });
  const scheduler = createScheduler({
    emit: (command) => engine.fireOneShot(command.itemId),
    setTimeout: ((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof globalThis.setTimeout,
    clearTimeout: (() => {}) as typeof globalThis.clearTimeout,
  });
  engine.apply(current);
  scheduler.sync(current);
  const first = context.suspend(0.2).then(async () => {
    callbacks[0]();
    await engine.ready();
    await context.resume();
  });
  const second = context.suspend(0.6).then(async () => {
    callbacks[1]();
    await engine.ready();
    await context.resume();
  });
  const output = await context.startRendering();
  await Promise.all([first, second]);
  expect(output.getChannelData(0)[4800]).toBe(0);
  expect(output.getChannelData(0)[12000]).toBe(1);
  expect(output.getChannelData(0)[21600]).toBe(0);
  expect(output.getChannelData(0)[31200]).toBe(1);
  expect(current.items[0].playing).toBe(true);
  scheduler.dispose();
  engine.dispose();
});

it('stops an audible one-shot on Stop All', async () => {
  const { context, state, asset } = fixture();
  const engine = createEngine(context, { loadAsset: async () => asset });
  engine.apply(state);
  engine.fireOneShot('thunder');
  await engine.ready();
  engine.stopAll();
  engine.apply(boardReducer(state, { type: 'stopAll' }));
  const output = await context.startRendering();
  expect(output.getChannelData(0)[24000]).toBe(0);
  engine.dispose();
});

it('cancels a pending one-shot on Stop All', async () => {
  const { context, state, asset } = fixture();
  let release!: (asset: EngineAsset) => void;
  const engine = createEngine(context, {
    loadAsset: () =>
      new Promise<EngineAsset>((resolve) => {
        release = resolve;
      }),
  });
  engine.apply(state);
  engine.fireOneShot('thunder');
  engine.stopAll();
  engine.apply(boardReducer(state, { type: 'stopAll' }));
  release(asset);
  await engine.ready();
  const output = await context.startRendering();
  expect(output.getChannelData(0)[24000]).toBe(0);
  engine.dispose();
});

it('keeps random-enabled items armed without starting ordinary playback', async () => {
  const { context, state, asset } = fixture();
  asset.durationSamples = 4800;
  let current: BoardState = {
    ...state,
    items: [{ ...state.items[0], playing: true, randomIntervalMin: 30, randomIntervalMax: 60 }],
  };
  const engine = createEngine(context, {
    loadAsset: async () => asset,
    onItemEnded: (itemId) => {
      current = boardReducer(current, { type: 'stop', itemId });
      engine.apply(current);
    },
  });
  engine.apply(current);
  await engine.ready();
  const output = await context.startRendering();
  expect(output.getChannelData(0)[2400]).toBe(0);
  expect(current.items[0].playing).toBe(true);
  engine.dispose();
});
