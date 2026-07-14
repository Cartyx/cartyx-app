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

/**
 * Regression guard: `'events'` must be an accepted window collection so that
 * dragging an event card onto the tabletop / GM screens opens a window.
 */
describe('events is an accepted tabletop/GM-screen window collection', () => {
  it('openTabletopWindowSchema accepts collection "events"', () => {
    const result = openTabletopWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'events',
      documentId: 'e1',
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it('gmscreens openWindowSchema accepts collection "events"', () => {
    const result = openWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'events',
      documentId: 'e1',
    });
    expect(result.success).toBe(true);
  });
});

/**
 * Regression guard: `'organization'` must be an accepted window collection so
 * that dragging an organization card onto the tabletop / GM screens opens a
 * window.
 */
describe('organization is an accepted tabletop/GM-screen window collection', () => {
  it('openTabletopWindowSchema accepts collection "organization"', () => {
    const result = openTabletopWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'organization',
      documentId: 'o1',
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it('gmscreens openWindowSchema accepts collection "organization"', () => {
    const result = openWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'organization',
      documentId: 'o1',
    });
    expect(result.success).toBe(true);
  });
});

/**
 * Regression guard: `'quest'` must be an accepted window collection so that
 * dragging a quest card onto the tabletop / GM screens opens a window.
 */
describe('quest is an accepted tabletop/GM-screen window collection', () => {
  it('openTabletopWindowSchema accepts collection "quest"', () => {
    const result = openTabletopWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'quest',
      documentId: 'q1',
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it('gmscreens openWindowSchema accepts collection "quest"', () => {
    const result = openWindowSchema.safeParse({
      screenId: 's1',
      campaignId: 'c1',
      collection: 'quest',
      documentId: 'q1',
    });
    expect(result.success).toBe(true);
  });
});
