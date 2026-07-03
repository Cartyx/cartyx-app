import { describe, it, expect } from 'vitest';
import { toOrdinal } from '~/utils/calendarEngine';
import { HARPTOS_CONFIG } from '~/utils/harptos';

// These ordinals are produced by scripts/seed_calendar_data.py:to_ordinal for the
// seeded sample-event dates. If the TS engine and Python port diverge, this fails.
const EXPECTED: Array<[{ year: number; monthIndex: number; day: number }, number]> = [
  [{ year: 1491, monthIndex: 6, day: 15 }, 43601],
  [{ year: 1488, monthIndex: 10, day: 1 }, 42582],
  [{ year: 1358, monthIndex: 0, day: 1 }, -5113],
];

describe('calendar engine parity (TS vs Python seed port)', () => {
  it('matches the Python to_ordinal for seed dates', () => {
    for (const [date, expected] of EXPECTED) {
      expect(toOrdinal(HARPTOS_CONFIG, date)).toBe(expected);
    }
  });
});
