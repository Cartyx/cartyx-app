import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageEditor } from '~/components/soundboard/PackageEditor';
import { MAX_PACKAGE_ITEMS } from '~/types/soundboard';
import type { PackageItemData } from '~/types/soundboard';
import type { AudioAssetData } from '~/types/audio';

function mkAsset(
  id: string,
  title: string,
  overrides: Partial<AudioAssetData> = {}
): AudioAssetData {
  return {
    id,
    ownerId: 'u1',
    title,
    kind: 'ambience',
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 10_000,
    durationSamples: 480_000,
    loudnessTargetLufs: -20,
    peaks: [0.1, 0.5, 0.3],
    renditions: {},
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function mkItem(overrides: Partial<PackageItemData> = {}): PackageItemData {
  return {
    id: 'i1',
    assetId: '507f1f77bcf86cd799439011',
    label: 'Storm',
    volume: 1,
    fadeSeconds: 2,
    loop: false,
    sortIndex: 0,
    ...overrides,
  };
}

const noop = () => {};

describe('PackageEditor', () => {
  // Load-bearing test 1: adding from the picker must append an item
  // referencing the ASSET THAT WAS ACTUALLY SELECTED, not just any asset.
  // Two assets in the fixture, picking the second — a single-asset fixture
  // would pass against an implementation that always grabs assets[0].
  it('adding from the picker appends an item referencing the chosen assetId', async () => {
    const user = userEvent.setup();
    const onItemsChange = vi.fn();
    const assets = [mkAsset('a1', 'Storm — Heavy'), mkAsset('a2', 'Tavern Reel')];

    render(
      <PackageEditor
        items={[]}
        onItemsChange={onItemsChange}
        assets={assets}
        filters={{}}
        onFiltersChange={noop}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /select tavern reel/i }));
    await user.click(screen.getByRole('button', { name: /add to package/i }));

    expect(onItemsChange).toHaveBeenCalledTimes(1);
    const next = onItemsChange.mock.calls[0][0] as PackageItemData[];
    expect(next).toHaveLength(1);
    expect(next[0].assetId).toBe('a2');
    expect(next[0].label).toBe('Tavern Reel');
  });

  // Load-bearing test 2: the item cap must disable the add affordance in the
  // UI, not merely prevent a 65th item from landing in state. Built at the
  // cap itself — a handful of items cannot exercise this branch.
  it('disables the add affordance when the package is at MAX_PACKAGE_ITEMS', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: MAX_PACKAGE_ITEMS }, (_, i) =>
      mkItem({ id: `i${i}`, assetId: '507f1f77bcf86cd799439011', sortIndex: i })
    );
    const assets = [mkAsset('a1', 'Storm — Heavy')];

    render(
      <PackageEditor
        items={items}
        onItemsChange={vi.fn()}
        assets={assets}
        filters={{}}
        onFiltersChange={noop}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /select storm — heavy/i }));
    expect(screen.getByRole('button', { name: /add to package/i })).toBeDisabled();
    expect(screen.getByText(/package is full/i)).toBeInTheDocument();
  });

  it('does not disable the add affordance one below the cap', () => {
    const items = Array.from({ length: MAX_PACKAGE_ITEMS - 1 }, (_, i) =>
      mkItem({ id: `i${i}`, assetId: '507f1f77bcf86cd799439011', sortIndex: i })
    );
    render(
      <PackageEditor
        items={items}
        onItemsChange={vi.fn()}
        assets={[mkAsset('a1', 'Storm — Heavy')]}
        filters={{}}
        onFiltersChange={noop}
      />
    );
    // Nothing selected yet, so the button is disabled for that reason alone —
    // this only checks it isn't ALSO disabled by the cap message.
    expect(screen.queryByText(/package is full/i)).not.toBeInTheDocument();
  });

  it('removing an item reassigns sortIndex for the remainder, closing the gap', async () => {
    const user = userEvent.setup();
    const onItemsChange = vi.fn();
    const items = [
      mkItem({ id: 'i0', label: 'First', sortIndex: 0 }),
      mkItem({ id: 'i1', label: 'Second', sortIndex: 1 }),
      mkItem({ id: 'i2', label: 'Third', sortIndex: 2 }),
    ];

    render(
      <PackageEditor
        items={items}
        onItemsChange={onItemsChange}
        assets={[]}
        filters={{}}
        onFiltersChange={noop}
      />
    );

    await user.click(screen.getByRole('button', { name: /remove second/i }));

    expect(onItemsChange).toHaveBeenCalledTimes(1);
    const next = onItemsChange.mock.calls[0][0] as PackageItemData[];
    expect(next.map((i) => i.id)).toEqual(['i0', 'i2']);
    expect(next.map((i) => i.sortIndex)).toEqual([0, 1]);
  });

  it('editing volume calls onItemsChange with the updated field and preserves the rest', async () => {
    const onItemsChange = vi.fn();
    const items = [mkItem({ id: 'i0', label: 'First', volume: 1, sortIndex: 0 })];

    render(
      <PackageEditor
        items={items}
        onItemsChange={onItemsChange}
        assets={[]}
        filters={{}}
        onFiltersChange={noop}
      />
    );

    const slider = screen.getByRole('slider', { name: /volume for first/i });
    fireEvent.change(slider, { target: { value: '0.4' } });

    expect(onItemsChange).toHaveBeenCalledTimes(1);
    const next = onItemsChange.mock.calls[0][0] as PackageItemData[];
    expect(next[0].volume).toBe(0.4);
    expect(next[0].loop).toBe(false);
    expect(next[0].fadeSeconds).toBe(2);
  });

  it('read-only mode hides the picker and item mutation controls', () => {
    const items = [mkItem({ id: 'i0', label: 'First' })];
    render(
      <PackageEditor
        items={items}
        onItemsChange={vi.fn()}
        assets={[mkAsset('a1', 'Storm — Heavy')]}
        filters={{}}
        onFiltersChange={noop}
        readOnly
      />
    );

    expect(screen.queryByRole('button', { name: /add to package/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove first/i })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /volume for first/i })).toBeDisabled();
  });

  it('shows an empty state when the package has no items yet', () => {
    render(
      <PackageEditor
        items={[]}
        onItemsChange={vi.fn()}
        assets={[]}
        filters={{}}
        onFiltersChange={noop}
      />
    );
    expect(screen.getByText(/no items yet/i)).toBeInTheDocument();
  });
});
