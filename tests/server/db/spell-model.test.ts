import { describe, it, expect } from 'vitest';
import { Spell } from '~/server/db/models/Spell';

// Mongoose is globally mocked in tests/setup.ts (MockSchema is a no-op, model()
// returns a mock), so schema pre-hooks and indexes do not run in unit tests.
// This verifies the model module imports and exports cleanly under the mock —
// the schema must not call any Schema API the mock lacks (the `typeof
// spellSchema.index === 'function'` guard skips indexing under the mock).
// Tag normalization is covered by tests/server/utils/normalizeTags.test.ts and
// the full spell shape is exercised by the spell server-function tests.
describe('Spell model', () => {
  it('is exported and defined', () => {
    expect(Spell).toBeDefined();
  });
});
