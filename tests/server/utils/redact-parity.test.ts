import { describe, it, expect } from 'vitest';
import { REDACT_PATHS as webPaths } from '~/server/utils/logger';
import { REDACT_PATHS as realtimePaths } from '../../../realtime/src/logger';

describe('redact list parity', () => {
  it('keeps the two services PII lists identical', () => {
    // Duplicated on purpose — realtime/ is a separate build unit and cannot
    // import from app/. This guard makes drift fail CI instead of silently
    // leaking from whichever service was not updated.
    expect([...webPaths].sort()).toEqual([...realtimePaths].sort());
  });
});
