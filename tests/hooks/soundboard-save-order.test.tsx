import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AudioPackageData } from '~/types/soundboard';

const saveBoardStateFn = vi.hoisted(() => vi.fn());
vi.mock('~/utils/soundboard-server-fns', () => ({ saveBoardStateFn }));
vi.mock('~/utils/telemetry-client', () => ({ captureException: vi.fn() }));
import { useSoundboard } from '~/hooks/useSoundboard';

it('serializes saves across board remounts so clearing wins', async () => {
  vi.useFakeTimers();
  const pkg: AudioPackageData = {
    id: 'old-package',
    ownerId: 'owner',
    name: 'Old',
    description: null,
    items: [],
    moods: [],
    createdAt: '',
    updatedAt: '',
  };
  let storedPackage: string | null = pkg.id;
  let release!: () => void;
  saveBoardStateFn.mockImplementation(async ({ data }) => {
    if (data.packageId)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    storedPackage = data.packageId;
  });
  const oldBoard = renderHook(() => useSoundboard('campaign', pkg));
  act(() => oldBoard.result.current.dispatch({ type: 'setMasterVolume', volume: 0.5 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  oldBoard.unmount();
  const clearedBoard = renderHook(() => useSoundboard('campaign', null, { initialState: null }));
  act(() => clearedBoard.result.current.dispatch({ type: 'stopAll' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(storedPackage).toBe('old-package');
  await act(async () => {
    release();
  });
  expect(storedPackage).toBe(null);
  clearedBoard.unmount();
  vi.useRealTimers();
});
