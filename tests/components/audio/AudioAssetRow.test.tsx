import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioAssetRow, formatDuration } from '~/components/audio/AudioAssetRow';
import type { AudioAssetData } from '~/types/audio';

const asset: AudioAssetData = {
  id: 'a1',
  ownerId: 'u1',
  title: 'Storm',
  kind: 'ambience',
  environment: ['coast'],
  mood: ['tense'],
  intensity: 4,
  tags: ['storm'],
  status: 'ready',
  durationMs: 125_000,
  durationSamples: 6_000_000,
  loudnessTargetLufs: -20,
  peaks: [0.1, 0.9, 0.4],
  renditions: {},
  lastError: null,
  createdAt: '',
  updatedAt: '',
};

// Rows render an <li> so they compose into AudioLibraryBrowser's <ul> (Task 16).
// Wrap in a <ul> here so the DOM stays valid for a standalone render.
function renderRow(ui: React.ReactElement) {
  return render(<ul>{ui}</ul>);
}

describe('AudioAssetRow', () => {
  it('shows the title, kind and formatted duration', () => {
    renderRow(<AudioAssetRow asset={asset} />);
    expect(screen.getByText('Storm')).toBeInTheDocument();
    expect(screen.getByText('ambience')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('shows a processing state instead of a play button when not ready', () => {
    renderRow(<AudioAssetRow asset={{ ...asset, status: 'processing' }} />);
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument();
  });

  it.each(['pending', 'processing', 'uploading', 'failed'] as const)(
    'keeps Edit and Delete reachable but hides Play when status is %s',
    (status) => {
      renderRow(
        <AudioAssetRow
          asset={{ ...asset, status, peaks: [] }}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      expect(screen.queryByRole('button', { name: /play storm/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /edit storm/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /delete storm/i })).toBeInTheDocument();
    }
  );

  it('calls onEdit with the full asset even when the asset is not ready', async () => {
    const onEdit = vi.fn();
    const pendingAsset: AudioAssetData = { ...asset, status: 'pending', peaks: [] };
    renderRow(<AudioAssetRow asset={pendingAsset} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: /edit storm/i }));
    expect(onEdit).toHaveBeenCalledWith(pendingAsset);
  });

  it('shows an uploading state distinct from processing', () => {
    renderRow(<AudioAssetRow asset={{ ...asset, status: 'uploading', peaks: [] }} />);
    expect(screen.getByText(/uploading/i)).toBeInTheDocument();
    expect(screen.queryByText(/^processing/i)).not.toBeInTheDocument();
  });

  it('shows a queued state distinct from processing when pending', () => {
    renderRow(<AudioAssetRow asset={{ ...asset, status: 'pending', peaks: [] }} />);
    // A stalled queue (worker down) must read as "waiting", never as an
    // in-progress "Processing…" state — those are different facts.
    expect(screen.getByText(/queued|waiting/i)).toBeInTheDocument();
    expect(screen.queryByText(/^processing/i)).not.toBeInTheDocument();
  });

  it('surfaces the error message when the asset failed', () => {
    renderRow(<AudioAssetRow asset={{ ...asset, status: 'failed', lastError: 'bad codec' }} />);
    expect(screen.getByText(/bad codec/i)).toBeInTheDocument();
  });

  describe('retry', () => {
    it('offers Retry on a failed asset and calls back with that asset', async () => {
      const onRetry = vi.fn();
      const failed = { ...asset, status: 'failed' as const, lastError: 'bad codec' };
      renderRow(<AudioAssetRow asset={failed} onRetry={onRetry} />);

      // Without this the only recovery from one transient transcode failure is
      // delete-and-re-upload — for a 50-file bulk import, the whole folder.
      await userEvent.click(screen.getByRole('button', { name: 'Retry Storm' }));
      expect(onRetry).toHaveBeenCalledWith(failed);
    });

    it.each(['ready', 'pending', 'processing', 'uploading'] as const)(
      'does not offer Retry when status is %s',
      (status) => {
        renderRow(<AudioAssetRow asset={{ ...asset, status }} onRetry={vi.fn()} />);
        // Retrying anything but a failed row is meaningless, and the server fn
        // is scoped to `failed` — offering the button would just error.
        expect(screen.queryByRole('button', { name: /^Retry/ })).not.toBeInTheDocument();
      }
    );
  });

  it('falls back to a generic message when a failed asset has no lastError', () => {
    renderRow(<AudioAssetRow asset={{ ...asset, status: 'failed', lastError: null }} />);
    expect(screen.getByText(/fail/i)).toBeInTheDocument();
  });

  it('does not render a checkbox when not selectable', () => {
    renderRow(<AudioAssetRow asset={asset} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('calls onToggleSelect with the asset id when the checkbox is used', async () => {
    const onToggleSelect = vi.fn();
    renderRow(<AudioAssetRow asset={asset} selectable onToggleSelect={onToggleSelect} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /select storm/i }));
    expect(onToggleSelect).toHaveBeenCalledWith('a1');
  });

  it('reflects the selected prop on the checkbox', () => {
    renderRow(<AudioAssetRow asset={asset} selectable selected onToggleSelect={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /select storm/i })).toBeChecked();
  });

  it('calls onPlay with the full asset when the play button is clicked', async () => {
    const onPlay = vi.fn();
    renderRow(<AudioAssetRow asset={asset} onPlay={onPlay} />);
    await userEvent.click(screen.getByRole('button', { name: /play storm/i }));
    expect(onPlay).toHaveBeenCalledWith(asset);
  });

  it('calls onEdit with the full asset when the edit button is clicked', async () => {
    const onEdit = vi.fn();
    renderRow(<AudioAssetRow asset={asset} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: /edit storm/i }));
    expect(onEdit).toHaveBeenCalledWith(asset);
  });

  it('calls onDelete with the full asset when the delete button is clicked', async () => {
    const onDelete = vi.fn();
    renderRow(<AudioAssetRow asset={asset} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /delete storm/i }));
    expect(onDelete).toHaveBeenCalledWith(asset);
  });

  it('calls onDelete with the full asset even when the asset is not ready', async () => {
    const onDelete = vi.fn();
    const pendingAsset: AudioAssetData = { ...asset, status: 'pending', peaks: [] };
    renderRow(<AudioAssetRow asset={pendingAsset} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /delete storm/i }));
    expect(onDelete).toHaveBeenCalledWith(pendingAsset);
  });

  it('renders tags', () => {
    renderRow(<AudioAssetRow asset={{ ...asset, tags: ['storm', 'coastal'] }} />);
    expect(screen.getByText('#storm')).toBeInTheDocument();
    expect(screen.getByText('#coastal')).toBeInTheDocument();
  });
});

describe('formatDuration', () => {
  it('returns an em dash for null', () => {
    expect(formatDuration(null)).toBe('—');
  });

  it('returns an em dash for negative values', () => {
    expect(formatDuration(-1000)).toBe('—');
  });

  it('formats zero as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats sub-minute durations with a zero-padded seconds field', () => {
    expect(formatDuration(45_000)).toBe('0:45');
  });

  it('formats whole minutes', () => {
    expect(formatDuration(60_000)).toBe('1:00');
  });

  it('formats durations over an hour without a separate hours field', () => {
    expect(formatDuration(3_661_000)).toBe('61:01');
  });

  it('rounds to the nearest second', () => {
    expect(formatDuration(125_499)).toBe('2:05');
  });
});
