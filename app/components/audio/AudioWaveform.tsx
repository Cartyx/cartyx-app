import React from 'react';

/** Props for the AudioWaveform component. */
export interface AudioWaveformProps {
  /** Stored peak buckets (0..1 amplitude), pre-computed server-side at upload time. */
  peaks: number[];
  /** Pixel height of the rendered waveform. */
  height?: number;
  /** Additional CSS classes applied to the root element. */
  className?: string;
}

/**
 * Renders the asset's stored `peaks[]` as an SVG bar chart.
 *
 * This component MUST NOT fetch audio — the entire point of persisting
 * ~400 peak buckets on the asset at ingest time is that the library list can
 * draw a waveform preview without downloading a single audio file.
 */
export function AudioWaveform({ peaks, height = 28, className = '' }: AudioWaveformProps) {
  if (peaks.length === 0) {
    // No peaks yet (still uploading/processing) — a blank bar, not an
    // announced image with nothing to describe.
    return <div className={className} style={{ height }} aria-hidden="true" />;
  }

  const width = peaks.length;
  const mid = height / 2;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height, width: '100%' }}
      role="img"
      aria-label="Audio waveform"
    >
      {peaks.map((peak, i) => {
        const amplitude = Math.min(1, Math.max(0, peak));
        const barHeight = Math.max(1, amplitude * height);
        return (
          <rect
            key={i}
            x={i}
            y={mid - barHeight / 2}
            width={0.8}
            height={barHeight}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
