import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Schema-only tests — validate Zod schemas from ~/types/schemas/tabletop
// No mocking needed since we are only testing schema parsing.
// ---------------------------------------------------------------------------

describe('session event schemas', () => {
  // -----------------------------------------------------------------------
  // createSessionEventSchema
  // -----------------------------------------------------------------------

  describe('createSessionEventSchema', () => {
    it('rejects missing eventType', async () => {
      const { createSessionEventSchema } = await import('~/types/schemas/tabletop');
      const result = createSessionEventSchema.safeParse({
        campaignId: 'abc123',
        sessionId: 'sess-1',
        documentId: 'doc-1',
        collection: 'note',
        tabletopScreenId: 'screen-1',
        displayName: 'My Note',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid eventType', async () => {
      const { createSessionEventSchema } = await import('~/types/schemas/tabletop');
      const result = createSessionEventSchema.safeParse({
        campaignId: 'abc123',
        sessionId: 'sess-1',
        eventType: 'invalid_type',
        documentId: 'doc-1',
        collection: 'note',
        tabletopScreenId: 'screen-1',
        displayName: 'My Note',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid input', async () => {
      const { createSessionEventSchema } = await import('~/types/schemas/tabletop');
      const result = createSessionEventSchema.safeParse({
        campaignId: 'abc123',
        sessionId: 'sess-1',
        eventType: 'reveal_document',
        documentId: 'doc-1',
        collection: 'note',
        tabletopScreenId: 'screen-1',
        displayName: 'My Note',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        campaignId: 'abc123',
        sessionId: 'sess-1',
        eventType: 'reveal_document',
        documentId: 'doc-1',
        collection: 'note',
        tabletopScreenId: 'screen-1',
        displayName: 'My Note',
      });
    });
  });

  // -----------------------------------------------------------------------
  // listSessionEventsSchema
  // -----------------------------------------------------------------------

  describe('listSessionEventsSchema', () => {
    it('rejects empty sessionId', async () => {
      const { listSessionEventsSchema } = await import('~/types/schemas/tabletop');
      const result = listSessionEventsSchema.safeParse({
        campaignId: 'abc123',
        sessionId: '',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid input', async () => {
      const { listSessionEventsSchema } = await import('~/types/schemas/tabletop');
      const result = listSessionEventsSchema.safeParse({
        campaignId: 'abc123',
        sessionId: 'sess-1',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        campaignId: 'abc123',
        sessionId: 'sess-1',
      });
    });
  });
});
