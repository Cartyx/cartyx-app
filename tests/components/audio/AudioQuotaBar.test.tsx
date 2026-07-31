import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioQuotaBar } from '~/components/audio/AudioQuotaBar';

const GIB = 1024 * 1024 * 1024;

describe('AudioQuotaBar', () => {
  it('renders usage and the limit', () => {
    render(<AudioQuotaBar usageBytes={512 * 1024 * 1024} assetCount={12} limitBytes={2 * GIB} />);
    expect(screen.getByText(/512\.0 MB of 2\.00 GB used/i)).toBeInTheDocument();
    expect(screen.getByText(/12 assets/i)).toBeInTheDocument();
  });

  it('renders a singular asset count for exactly one asset', () => {
    render(<AudioQuotaBar usageBytes={1024} assetCount={1} limitBytes={2 * GIB} />);
    expect(screen.getByText(/1 asset$/i)).toBeInTheDocument();
  });

  it('exposes an accessible progressbar with a numeric value and a human-readable value text', () => {
    render(<AudioQuotaBar usageBytes={GIB} assetCount={10} limitBytes={2 * GIB} />);
    const bar = screen.getByRole('progressbar', { name: /storage used/i });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/1\.00 GB of 2\.00 GB used/i)
    );
  });

  /**
   * The core "near-limit must be visually distinct from healthy" assertion
   * the brief calls out. A healthy bar (well under 90%) renders no warning
   * icon and no "approaching" copy at all — checked via `queryBy`, not just
   * "the near case has one", so this fails if healthy ever grows one too.
   */
  it('is visually distinct from healthy once usage crosses the near-limit threshold', () => {
    const { rerender } = render(
      <AudioQuotaBar usageBytes={Math.round(2 * GIB * 0.5)} assetCount={20} limitBytes={2 * GIB} />
    );
    expect(screen.queryByText(/approaching your storage limit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/storage limit reached/i)).not.toBeInTheDocument();

    rerender(
      <AudioQuotaBar usageBytes={Math.round(2 * GIB * 0.91)} assetCount={20} limitBytes={2 * GIB} />
    );
    expect(screen.getByText(/approaching your storage limit/i)).toBeInTheDocument();
  });

  // Not colour alone: the near and over states each carry their own sentence
  // (not just a different className), so the distinction survives a
  // stylesheet-stripped or screen-reader read of the DOM.
  it('gives the over-limit state its own distinct copy, not just a different colour', () => {
    render(<AudioQuotaBar usageBytes={2 * GIB} assetCount={57} limitBytes={2 * GIB} />);
    expect(screen.getByText(/storage limit reached/i)).toBeInTheDocument();
    expect(screen.queryByText(/approaching your storage limit/i)).not.toBeInTheDocument();
  });

  /**
   * Matches `assertUnderStorageQuota`'s own boundary in
   * `~/server/functions/audio.ts`: `usage.bytes >= limitBytes` is refused,
   * not merely "close". Usage sitting exactly AT the limit must read as
   * "over", not "near" — a user reading "near" at the exact number the
   * server already refuses at would be misled about their own state.
   */
  it('treats usage exactly at the limit as over, not near', () => {
    render(<AudioQuotaBar usageBytes={2 * GIB} assetCount={57} limitBytes={2 * GIB} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/storage limit reached/i)).toBeInTheDocument();
  });

  it('clamps the progressbar value at 100 when usage has overshot the limit', () => {
    render(<AudioQuotaBar usageBytes={3 * GIB} assetCount={80} limitBytes={2 * GIB} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows a loading state instead of the bar while usage has not resolved', () => {
    render(<AudioQuotaBar usageBytes={null} assetCount={0} limitBytes={null} />);
    expect(screen.getByText(/checking storage usage/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('surfaces a failed usage query as an alert instead of the bar', () => {
    render(
      <AudioQuotaBar
        usageBytes={null}
        assetCount={0}
        limitBytes={null}
        error="Failed to load storage usage."
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load storage usage/i);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders a zero-usage empty library without warning', () => {
    render(<AudioQuotaBar usageBytes={0} assetCount={0} limitBytes={2 * GIB} />);
    expect(screen.getByText(/0 assets/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByText(/approaching your storage limit/i)).not.toBeInTheDocument();
  });
});
