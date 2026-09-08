import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioOrphanCleanup } from '~/components/audio/AudioOrphanCleanup';
import type { ScanOrphanAudioResult } from '~/types/schemas/audio';

const BASE = {
  result: null,
  scanning: false,
  deleting: false,
  error: null,
  lastDelete: null,
  onScan: vi.fn(),
  onDelete: vi.fn(),
};

function scan(over: Partial<ScanOrphanAudioResult> = {}): ScanOrphanAudioResult {
  return { orphans: [], scannedObjectCount: 3, truncated: false, r2Disabled: false, ...over };
}

const ORPHAN = {
  key: 'uploads/audio/renditions/507f1f77bcf86cd799439aaa.opus',
  sizeBytes: 2_097_152,
  lastModified: '2026-07-01T00:00:00.000Z',
};

describe('AudioOrphanCleanup', () => {
  it('scans on demand rather than on mount — the scan costs R2 round trips', async () => {
    const onScan = vi.fn();
    render(<AudioOrphanCleanup {...BASE} onScan={onScan} />);
    expect(onScan).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /scan for orphaned files/i }));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when there is nothing to reclaim', () => {
    render(<AudioOrphanCleanup {...BASE} result={scan()} />);
    expect(screen.getByText(/nothing to reclaim/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('requires a confirmation before deleting, and sends exactly the scanned keys', async () => {
    const onDelete = vi.fn();
    render(
      <AudioOrphanCleanup {...BASE} result={scan({ orphans: [ORPHAN] })} onDelete={onDelete} />
    );

    await userEvent.click(screen.getByRole('button', { name: /delete 1 file/i }));
    // The first click only arms the confirmation; nothing is deleted yet.
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(onDelete).toHaveBeenCalledWith([ORPHAN.key]);
  });

  it('cancels out of the confirmation without deleting', async () => {
    const onDelete = vi.fn();
    render(
      <AudioOrphanCleanup {...BASE} result={scan({ orphans: [ORPHAN] })} onDelete={onDelete} />
    );
    await userEvent.click(screen.getByRole('button', { name: /delete 1 file/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /delete 1 file/i })).toBeInTheDocument();
  });

  /**
   * The signal the campaign image scanner never emitted: it capped its listing
   * and threw `IsTruncated` away, so an account past the cap saw a partial
   * result presented as a complete one. A partial scan must say it is partial,
   * or "nothing to reclaim" is a lie.
   */
  it('warns when the scan was truncated', () => {
    render(
      <AudioOrphanCleanup {...BASE} result={scan({ truncated: true, scannedObjectCount: 500 })} />
    );
    expect(screen.getByText(/partial scan/i)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('does not warn about truncation on a complete scan', () => {
    render(<AudioOrphanCleanup {...BASE} result={scan({ orphans: [ORPHAN] })} />);
    expect(screen.queryByText(/partial scan/i)).not.toBeInTheDocument();
  });

  it('reports a storage-disabled environment instead of an empty success', () => {
    render(<AudioOrphanCleanup {...BASE} result={scan({ r2Disabled: true })} />);
    expect(screen.getByText(/storage isn't configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing to reclaim/i)).not.toBeInTheDocument();
  });

  it('surfaces an error as an alert', () => {
    render(<AudioOrphanCleanup {...BASE} error="Failed to scan for orphaned files." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to scan/i);
  });

  it('reports partial delete failures rather than claiming success', () => {
    render(<AudioOrphanCleanup {...BASE} result={scan()} lastDelete={{ deleted: 2, failed: 1 }} />);
    expect(screen.getByText(/deleted 2 files/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
  });

  it('disables its actions while a scan is in flight', () => {
    render(<AudioOrphanCleanup {...BASE} scanning result={scan({ orphans: [ORPHAN] })} />);
    expect(screen.getByRole('button', { name: /scanning/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /delete 1 file/i })).toBeDisabled();
  });

  /**
   * B2 (phase-B): this component now imports the shared `~/utils/format-
   * bytes` instead of its own copy, which had no GB tier and stopped at MB
   * with 1 decimal. `ORPHAN.sizeBytes` (2_097_152) is exactly 2.0 MB, so this
   * pins the per-row size — a fixture picked because it renders identically
   * under BOTH the old and new implementations, proving the MB tier itself
   * still works after the switch.
   */
  it('formats an individual orphan size in the row list', () => {
    render(<AudioOrphanCleanup {...BASE} result={scan({ orphans: [ORPHAN] })} />);
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();
  });

  /**
   * This is the assertion that would have passed for the wrong reason before
   * the consolidation: the old copy of `formatBytes` in this file had no GB
   * tier at all, so a 1.5 GiB total rendered as "1536.0 MB" — a plain
   * `/delete 2 files/i` match (the style every other test in this file uses)
   * would still pass either way. Asserting the exact button name is what
   * actually pins the shared implementation's GB tier here, mirroring what
   * `AudioQuotaBar.test.tsx` already pins for its own GB-scale numbers.
   * Individual assets can never reach this tier (`AUDIO_MAX_BYTES` caps one
   * asset at 50 MB), but the aggregate this button sums can, on an account
   * with enough orphaned files.
   */
  it('formats the delete total in GB once the orphan set crosses 1 GiB', () => {
    const GIB = 1024 * 1024 * 1024;
    const bigOrphans = [
      { key: 'uploads/audio/a.opus', sizeBytes: 0.75 * GIB, lastModified: null },
      { key: 'uploads/audio/b.opus', sizeBytes: 0.75 * GIB, lastModified: null },
    ];
    render(<AudioOrphanCleanup {...BASE} result={scan({ orphans: bigOrphans })} />);
    expect(
      screen.getByRole('button', { name: /delete 2 files \(1\.50 gb\)/i })
    ).toBeInTheDocument();
  });
});
