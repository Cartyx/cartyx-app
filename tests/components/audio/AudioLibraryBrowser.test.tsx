import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioLibraryBrowser } from '~/components/audio/AudioLibraryBrowser';
import type { AudioAssetData } from '~/types/audio';

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
    loudnessLufs: -20,
    peaks: [0.1, 0.5, 0.3],
    renditions: {},
    lastError: null,
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
});
