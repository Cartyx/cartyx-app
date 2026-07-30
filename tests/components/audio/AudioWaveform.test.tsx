import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioWaveform } from '~/components/audio/AudioWaveform';

describe('AudioWaveform', () => {
  it('renders one bar per peak, as an accessible image', () => {
    const { container } = render(<AudioWaveform peaks={[0.1, 0.9, 0.4]} />);
    const svg = screen.getByRole('img', { name: /audio waveform/i });
    expect(container.querySelectorAll('rect')).toHaveLength(3);
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('renders a decorative, non-announced placeholder when there are no peaks yet', () => {
    render(<AudioWaveform peaks={[]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('clamps out-of-range peak values instead of producing an invalid rect', () => {
    const { container } = render(<AudioWaveform peaks={[-5, 50]} height={28} />);
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      const h = Number(rect.getAttribute('height'));
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(28);
    }
  });
});
