import { describe, it, expect } from 'vitest';
import { formatBytes } from '~/utils/format-bytes';

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

describe('formatBytes', () => {
  it('renders sub-KB values as whole bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('renders the KB tier with 1 decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(MB - 1)).toBe('1024.0 KB');
  });

  it('renders the MB tier with 1 decimal', () => {
    expect(formatBytes(MB)).toBe('1.0 MB');
    expect(formatBytes(512 * MB)).toBe('512.0 MB');
    expect(formatBytes(GB - 1)).toBe('1024.0 MB');
  });

  /**
   * The GB tier is the whole point of B2's consolidation (see `~/utils/
   * format-bytes.ts`'s doc comment): `AudioOrphanCleanup`'s pre-consolidation
   * copy had no GB tier at all and would have rendered these as
   * "1024.0 MB"/"2048.0 MB" instead.
   */
  it('renders the GB tier with 2 decimals', () => {
    expect(formatBytes(GB)).toBe('1.00 GB');
    expect(formatBytes(2 * GB)).toBe('2.00 GB');
    expect(formatBytes(Math.round(1.5 * GB))).toBe('1.50 GB');
  });
});
