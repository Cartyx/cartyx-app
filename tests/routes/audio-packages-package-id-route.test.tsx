import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AudioPackageData, MoodData, PackageItemData } from '~/types/soundboard';

const getPackageFn = vi.fn();
const updatePackageFn = vi.fn();
vi.mock('~/utils/soundboard-server-fns', () => ({
  getPackageFn: (...args: unknown[]) => getPackageFn(...args),
  updatePackageFn: (...args: unknown[]) => updatePackageFn(...args),
}));

const listAudioAssetsFn = vi.fn();
vi.mock('~/utils/audio-server-fns', () => ({
  listAudioAssetsFn: (...args: unknown[]) => listAudioAssetsFn(...args),
}));

const useAuth = vi.fn(() => ({ user: { id: 'u1', name: 'GM' }, logout: vi.fn() }));
vi.mock('~/hooks/useAuth', () => ({ useAuth: () => useAuth() }));

const captureException = vi.fn();
vi.mock('~/utils/telemetry-client', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureEvent: vi.fn(),
}));

// `Route.useParams()` is called directly inside `PackageEditorPage` (not
// through the router's own matching machinery, which isn't stood up in this
// test) — the mocked `createFileRoute` attaches a `useParams` returning a
// fixed id, same shape `audio-route.test.tsx` uses for its own router mock.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ packageId: 'p1' }),
  }),
  redirect: (opts: unknown) => opts,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { PackageEditorPage, pruneOrphanedMoodStates } from '~/routes/audio_.packages_.$packageId';

function mkItem(overrides: Partial<PackageItemData> = {}): PackageItemData {
  return {
    id: 'i1',
    assetId: '507f1f77bcf86cd799439011',
    label: 'Rain',
    volume: 1,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 0,
    ...overrides,
  };
}

function mkPackage(overrides: Partial<AudioPackageData> = {}): AudioPackageData {
  return {
    id: 'p1',
    ownerId: 'u1',
    name: 'Storm Set',
    description: null,
    items: [],
    moods: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('pruneOrphanedMoodStates', () => {
  // The reviewer's fixture, verbatim in spirit: two items, one mood whose
  // states[] names BOTH — not one, which a wholesale-clear implementation
  // would also pass. `i1` carries a real per-state override (`volume: 0.35`,
  // different from the item's own `volume: 1`), so a "rebuild states from
  // remaining items" implementation (which would emit a fresh, default-only
  // state for `i1`) is also caught — its output would not match the
  // survivor's ORIGINAL state object.
  it("drops a removed item's state and leaves the surviving item's state untouched", () => {
    const items = [mkItem({ id: 'i1', volume: 1 }), mkItem({ id: 'i2', volume: 1 })];
    const survivorState = { itemId: 'i1', playing: true, volume: 0.35 };
    const moods: MoodData[] = [
      {
        id: 'm1',
        name: 'Overhead',
        states: [survivorState, { itemId: 'i2', playing: true }],
      },
    ];

    // "removing one": the items array passed in is what's left AFTER i2 was
    // removed from the package — exactly what `PackageEditor`'s `emit()`
    // produces and what the route's save path hands to this function.
    const remainingItems = items.filter((item) => item.id !== 'i2');

    const result = pruneOrphanedMoodStates(moods, remainingItems);

    expect(result).toHaveLength(1);
    expect(result[0].states).toHaveLength(1);
    // Deep-equal against the ORIGINAL object, not just `itemId` — this is
    // what catches a "rebuild from items" fix that would produce a
    // same-itemId state with the override stripped.
    expect(result[0].states[0]).toEqual(survivorState);
    expect(result[0].states.some((s) => s.itemId === 'i2')).toBe(false);
  });

  it('is a no-op when every state already names a surviving item', () => {
    const items = [mkItem({ id: 'i1' })];
    const moods: MoodData[] = [
      { id: 'm1', name: 'Overhead', states: [{ itemId: 'i1', playing: true }] },
    ];
    expect(pruneOrphanedMoodStates(moods, items)).toEqual(moods);
  });
});

describe('PackageEditorPage save path', () => {
  it('prunes an orphaned mood state and sends the pruned moods alongside items on save', async () => {
    const user = userEvent.setup();
    const item1 = mkItem({ id: 'i1', label: 'Rain', sortIndex: 0 });
    const item2 = mkItem({ id: 'i2', label: 'Thunder', sortIndex: 1 });
    const survivorState = { itemId: 'i1', playing: true, volume: 0.35 };
    const pkg = mkPackage({
      items: [item1, item2],
      moods: [
        { id: 'm1', name: 'Overhead', states: [survivorState, { itemId: 'i2', playing: true }] },
      ],
    });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockResolvedValue({
      ...pkg,
      items: [item1],
      moods: [{ id: 'm1', name: 'Overhead', states: [survivorState] }],
    });

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    await screen.findByText('Thunder');
    await user.click(screen.getByRole('button', { name: /remove thunder/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updatePackageFn).toHaveBeenCalledTimes(1));
    const call = updatePackageFn.mock.calls[0][0] as {
      data: { id: string; items: PackageItemData[]; moods: MoodData[] };
    };
    expect(call.data.id).toBe('p1');
    expect(call.data.items.map((i) => i.id)).toEqual(['i1']);
    expect(call.data.moods).toEqual([{ id: 'm1', name: 'Overhead', states: [survivorState] }]);
  });
});
