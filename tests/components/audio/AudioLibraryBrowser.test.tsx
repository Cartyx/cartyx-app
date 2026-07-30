import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AudioAssetData } from '~/types/audio';

// Replaces the real AudioWaveform (up to ~400 <rect>s per row) with a call
// counter, so the memoization test below can assert directly on how many
// times each row's subtree actually re-rendered, rather than inferring it
// indirectly.
const { waveformSpy } = vi.hoisted(() => ({ waveformSpy: vi.fn(() => null) }));
vi.mock('~/components/audio/AudioWaveform', () => ({ AudioWaveform: waveformSpy }));

import { AudioLibraryBrowser } from '~/components/audio/AudioLibraryBrowser';

function mkAsset(id: string, title: string): AudioAssetData {
  return {
    id,
    ownerId: 'u1',
    title,
    kind: 'music',
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
  };
}

const noop = () => {};

describe('AudioLibraryBrowser', () => {
  it('renders one row per asset', () => {
    render(
      <AudioLibraryBrowser
        assets={[mkAsset('1', 'Storm'), mkAsset('2', 'Tavern')]}
        filters={{}}
        onFiltersChange={noop}
      />
    );
    expect(screen.getByText('Storm')).toBeInTheDocument();
    expect(screen.getByText('Tavern')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  describe('load more', () => {
    const rows = [mkAsset('1', 'Storm'), mkAsset('2', 'Tavern')];

    it('offers Load more and calls back when another page exists', async () => {
      const onLoadMore = vi.fn();
      render(
        <AudioLibraryBrowser
          assets={rows}
          filters={{}}
          onFiltersChange={noop}
          hasMore
          onLoadMore={onLoadMore}
        />
      );
      // Filtering and paging are both server-side, so the list is a page, not
      // the library: with no control a GM with 60 assets never sees 10 of them.
      await userEvent.click(screen.getByRole('button', { name: /load more/i }));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('renders no control when there is no next page', () => {
      render(
        <AudioLibraryBrowser
          assets={rows}
          filters={{}}
          onFiltersChange={noop}
          hasMore={false}
          onLoadMore={vi.fn()}
        />
      );
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('disables the control while the next page is in flight', () => {
      render(
        <AudioLibraryBrowser
          assets={rows}
          filters={{}}
          onFiltersChange={noop}
          hasMore
          loadingMore
          onLoadMore={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
    });

    it('forwards onRetry with the clicked asset', async () => {
      const onRetry = vi.fn();
      const failed = { ...mkAsset('3', 'Broken'), status: 'failed' as const, retryable: true };
      render(
        <AudioLibraryBrowser
          assets={[...rows, failed]}
          filters={{}}
          onFiltersChange={noop}
          onRetry={onRetry}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Retry Broken' }));
      expect(onRetry).toHaveBeenCalledWith(failed);
    });
  });

  it('shows the empty message when there are no assets', () => {
    render(
      <AudioLibraryBrowser
        assets={[]}
        filters={{}}
        onFiltersChange={noop}
        emptyMessage="Nothing here yet"
      />
    );
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows a loading state instead of rows or the empty message', () => {
    render(
      <AudioLibraryBrowser
        assets={[]}
        loading
        filters={{}}
        onFiltersChange={noop}
        emptyMessage="Nothing here yet"
      />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders the actions slot above the list', () => {
    render(
      <AudioLibraryBrowser
        assets={[mkAsset('1', 'Storm')]}
        filters={{}}
        onFiltersChange={noop}
        actionsSlot={<button type="button">Bulk tag</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Bulk tag' })).toBeInTheDocument();
  });

  it('forwards onToggleSelect with the clicked asset id, not the first row', async () => {
    const onToggleSelect = vi.fn();
    render(
      <AudioLibraryBrowser
        assets={[mkAsset('1', 'Storm'), mkAsset('2', 'Tavern')]}
        filters={{}}
        onFiltersChange={noop}
        selectable
        onToggleSelect={onToggleSelect}
      />
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /select tavern/i }));
    expect(onToggleSelect).toHaveBeenCalledWith('2');
    expect(onToggleSelect).not.toHaveBeenCalledWith('1');
  });

  it('forwards onDelete with the clicked asset, not the first row', async () => {
    const onDelete = vi.fn();
    render(
      <AudioLibraryBrowser
        assets={[mkAsset('1', 'Storm'), mkAsset('2', 'Tavern')]}
        filters={{}}
        onFiltersChange={noop}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /delete tavern/i }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
    expect(onDelete).not.toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('does not filter or drop assets client-side — filtering is server-side', () => {
    // If the browser ever starts filtering the array it's handed, this test
    // should fail: these assets don't match `filters`, and must still render.
    render(
      <AudioLibraryBrowser
        assets={[mkAsset('1', 'Storm'), mkAsset('2', 'Tavern')]}
        filters={{ kind: 'ambience', search: 'zzz-does-not-match-anything' }}
        onFiltersChange={noop}
      />
    );
    expect(screen.getByText('Storm')).toBeInTheDocument();
    expect(screen.getByText('Tavern')).toBeInTheDocument();
  });

  it('forwards filter changes from the filter bar via onFiltersChange', async () => {
    const onFiltersChange = vi.fn();
    render(<AudioLibraryBrowser assets={[]} filters={{}} onFiltersChange={onFiltersChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'ambience' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ kind: 'ambience' });
  });

  it('does not re-render unaffected rows when one row is selected (AudioAssetRow is memoized)', async () => {
    waveformSpy.mockClear();
    // AudioAssetRow only bails out via memo if the callbacks it receives are
    // referentially stable across re-renders — AudioLibraryBrowser forwards
    // onToggleSelect straight through without wrapping it, so the harness
    // mirrors what a real caller must do (e.g. useCallback around a
    // functional state update) to get that benefit.
    const onToggleSelect = vi.fn();
    const assets = [mkAsset('1', 'Storm'), mkAsset('2', 'Tavern')];

    function Harness() {
      const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
      const handleToggle = React.useCallback((id: string) => {
        onToggleSelect(id);
        setSelectedIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
      }, []);
      return (
        <AudioLibraryBrowser
          assets={assets}
          filters={{}}
          onFiltersChange={noop}
          selectable
          selectedIds={selectedIds}
          onToggleSelect={handleToggle}
        />
      );
    }

    render(<Harness />);
    expect(waveformSpy).toHaveBeenCalledTimes(2); // one per row, initial render

    await userEvent.click(screen.getByRole('checkbox', { name: /select tavern/i }));

    // Only the Tavern row's props actually changed (selected: false -> true).
    // If AudioAssetRow were unmemoized, this re-render would re-invoke
    // AudioWaveform for both rows (4 total); memo should limit it to the one
    // row whose props changed (3 total: 2 initial + 1 for Tavern).
    expect(waveformSpy).toHaveBeenCalledTimes(3);
  });
});
