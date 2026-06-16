import { describe, it, expect } from 'vitest';
import { openTabletopWindowSchema } from '~/types/schemas/tabletop';
import { openWindowSchema } from '~/types/schemas/gmscreens';

/**
 * Regression guard: `'lore'` must be an accepted window collection so that
 * dragging a lore card onto the tabletop / GM screens opens a window. This was
 * missing from both allowlists (TABLETOP_COLLECTIONS / SUPPORTED_COLLECTIONS),
 * which silently rejected lore drops server-side — caught by e2e, not units.
 */
describe('lore is an accepted tabletop/GM-screen window collection', () => {
  it('openTabletopWindowSchema accepts collection "lore"', () => {
    const result = openTabletopWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'lore',
      documentId: 'l1',
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it('gmscreens openWindowSchema accepts collection "lore"', () => {
    const result = openWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'lore',
      documentId: 'l1',
    });
    expect(result.success).toBe(true);
  });
});
