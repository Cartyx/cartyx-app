import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { BoardGrid, groupItemsByKind } from '~/components/soundboard/BoardGrid';
import type { PackageItemData } from '~/types/soundboard';
import type { AudioAssetData, AudioKind } from '~/types/audio';
import type { BoardItemState } from '~/lib/soundboard/reducer';

function mkItem(over: Partial<PackageItemData> = {}): PackageItemData {
  return {
    id: 'i1',
    assetId: 'a1',
    label: 'Rain',
    volume: 1,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 0,
    ...over,
  };
}

function mkAsset(id: string, kind: AudioKind, over: Partial<AudioAssetData> = {}): AudioAssetData {
  return {
    id,
    ownerId: 'u1',
    title: `Asset ${id}`,
    kind,
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 1000,
    durationSamples: 48_000,
    loudnessTargetLufs: null,
    peaks: [],
    renditions: { opus: { key: 'k', url: 'https://cdn.test/a.opus', bytes: 1 } },
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function mkState(itemId: string, over: Partial<BoardItemState> = {}): BoardItemState {
  return {
    itemId,
    assetId: 'a1',
    playing: false,
    volume: 1,
    fadeSeconds: 2,
    loop: true,
    randomIntervalMin: undefined,
    randomIntervalMax: undefined,
    ...over,
  };
}

const noop = () => {};

describe('groupItemsByKind', () => {
  it('routes each item to its asset kind', () => {
    const items = [
      mkItem({ id: 'i1', assetId: 'a1' }),
      mkItem({ id: 'i2', assetId: 'a2' }),
      mkItem({ id: 'i3', assetId: 'a3' }),
    ];
    const assets = new Map([
      ['a1', mkAsset('a1', 'music')],
      ['a2', mkAsset('a2', 'ambience')],
      ['a3', mkAsset('a3', 'one-shot')],
    ]);

    const groups = groupItemsByKind(items, assets);

    expect(groups.music.map((i) => i.id)).toEqual(['i1']);
    expect(groups.ambience.map((i) => i.id)).toEqual(['i2']);
    expect(groups['one-shot'].map((i) => i.id)).toEqual(['i3']);
    expect(groups.unresolved).toEqual([]);
  });

  // The edge Task 16 flagged: a dangling reference has no `kind`, and the
  // naive `groups[asset.kind].push(...)` drops it from every group — a pad the
  // GM can neither play nor find to remove.
  it('keeps an item whose asset no longer resolves, in its own group', () => {
    const items = [mkItem({ id: 'i1', assetId: 'a1' }), mkItem({ id: 'gone', assetId: 'deleted' })];
    const assets = new Map([['a1', mkAsset('a1', 'music')]]);

    const groups = groupItemsByKind(items, assets);

    expect(groups.unresolved.map((i) => i.id)).toEqual(['gone']);
    // And it is in exactly ONE group — not silently duplicated into music.
    const everywhere = [
      ...groups.music,
      ...groups.ambience,
      ...groups['one-shot'],
      ...groups.unresolved,
    ];
    expect(everywhere.filter((i) => i.id === 'gone')).toHaveLength(1);
    expect(everywhere).toHaveLength(2);
  });

  // Task 9's `resolveAllItems` preserves `pkg.items` ARRAY order, not
  // `sortIndex` order — the fixture's two orders disagree on purpose.
  it('sorts by sortIndex, not array order', () => {
    const items = [
      mkItem({ id: 'c', assetId: 'a1', sortIndex: 2 }),
      mkItem({ id: 'a', assetId: 'a1', sortIndex: 0 }),
      mkItem({ id: 'b', assetId: 'a1', sortIndex: 1 }),
    ];
    const assets = new Map([['a1', mkAsset('a1', 'music')]]);

    expect(groupItemsByKind(items, assets).music.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the items it was given', () => {
    const items = [
      mkItem({ id: 'c', assetId: 'a1', sortIndex: 2 }),
      mkItem({ id: 'a', assetId: 'a1', sortIndex: 0 }),
    ];
    const before = items.map((i) => i.id);
    groupItemsByKind(items, new Map([['a1', mkAsset('a1', 'music')]]));
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe('BoardGrid', () => {
  it('renders one section per non-empty kind, with the pads inside it', () => {
    const items = [
      mkItem({ id: 'i1', assetId: 'a1', label: 'Theme' }),
      mkItem({ id: 'i2', assetId: 'a2', label: 'Rain' }),
    ];
    render(
      <BoardGrid
        items={items}
        assets={[mkAsset('a1', 'music'), mkAsset('a2', 'ambience')]}
        itemStates={[mkState('i1'), mkState('i2')]}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );

    const music = screen.getByTestId('board-group-music');
    expect(within(music).getByText('Theme')).toBeInTheDocument();
    expect(within(music).queryByText('Rain')).not.toBeInTheDocument();

    const ambience = screen.getByTestId('board-group-ambience');
    expect(within(ambience).getByText('Rain')).toBeInTheDocument();

    // Empty kinds do not render an empty heading.
    expect(screen.queryByTestId('board-group-one-shot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('board-group-unresolved')).not.toBeInTheDocument();
  });

  it('shows a dangling-reference pad in a visible group rather than dropping it', () => {
    render(
      <BoardGrid
        items={[mkItem({ id: 'gone', assetId: 'deleted', label: 'Thunder' })]}
        assets={[]}
        itemStates={[mkState('gone')]}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );

    const group = screen.getByTestId('board-group-unresolved');
    expect(within(group).getByText('Thunder')).toBeInTheDocument();
    expect(within(group).getByTestId('pad-unavailable-reason')).toHaveTextContent(
      /removed|no longer|missing/i
    );
  });

  it('drives each pad from its own BoardItemState', () => {
    render(
      <BoardGrid
        items={[mkItem({ id: 'i1', assetId: 'a1', label: 'Theme' })]}
        assets={[mkAsset('a1', 'music')]}
        itemStates={[mkState('i1', { playing: true, volume: 0.42 })]}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );

    expect(screen.getByRole('button', { name: 'Stop Theme' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByLabelText('Volume for Theme')).toHaveValue('0.42');
  });

  // The reducer's `items` lag `pkg.items` for exactly one commit when a package
  // arrives (the `[pkg]` effect runs after the render that first sees it).
  it('falls back to the item’s own volume when no board state exists for it yet', () => {
    render(
      <BoardGrid
        items={[mkItem({ id: 'i1', assetId: 'a1', label: 'Theme', volume: 0.25 })]}
        assets={[mkAsset('a1', 'music')]}
        itemStates={[]}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );

    expect(screen.getByLabelText('Volume for Theme')).toHaveValue('0.25');
    expect(screen.getByRole('button', { name: 'Play Theme' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('explains an empty board instead of rendering nothing', () => {
    render(
      <BoardGrid
        items={[]}
        assets={[]}
        itemStates={[]}
        onPlay={noop}
        onStop={noop}
        onVolumeChange={noop}
      />
    );

    expect(screen.getByTestId('board-grid-empty')).toBeInTheDocument();
  });

  it('forwards a pad press to the handler with the item id', async () => {
    const onPlay = vi.fn();
    render(
      <BoardGrid
        items={[mkItem({ id: 'i1', assetId: 'a1', label: 'Theme' })]}
        assets={[mkAsset('a1', 'music')]}
        itemStates={[mkState('i1')]}
        onPlay={onPlay}
        onStop={noop}
        onVolumeChange={noop}
      />
    );

    screen.getByRole('button', { name: 'Play Theme' }).click();
    expect(onPlay).toHaveBeenCalledWith('i1');
  });
});
