import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Schema-only tests — validate Zod schemas from ~/types/schemas/tabletop
// No mocking needed since we are only testing schema parsing.
// ---------------------------------------------------------------------------

describe('tabletop schemas', () => {
  // -----------------------------------------------------------------------
  // listTabletopScreensSchema
  // -----------------------------------------------------------------------

  describe('listTabletopScreensSchema', () => {
    it('rejects empty campaignId', async () => {
      const { listTabletopScreensSchema } = await import('~/types/schemas/tabletop');
      const result = listTabletopScreensSchema.safeParse({ campaignId: '' });
      expect(result.success).toBe(false);
    });

    it('accepts valid campaignId', async () => {
      const { listTabletopScreensSchema } = await import('~/types/schemas/tabletop');
      const result = listTabletopScreensSchema.safeParse({ campaignId: 'abc123' });
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // createTabletopScreenSchema
  // -----------------------------------------------------------------------

  describe('createTabletopScreenSchema', () => {
    it('rejects empty name', async () => {
      const { createTabletopScreenSchema } = await import('~/types/schemas/tabletop');
      const result = createTabletopScreenSchema.safeParse({
        campaignId: 'abc123',
        name: '',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid input', async () => {
      const { createTabletopScreenSchema } = await import('~/types/schemas/tabletop');
      const result = createTabletopScreenSchema.safeParse({
        campaignId: 'abc123',
        name: 'Battle Map',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        campaignId: 'abc123',
        name: 'Battle Map',
      });
    });
  });

  // -----------------------------------------------------------------------
  // updateTabletopScreenSettingsSchema
  // -----------------------------------------------------------------------

  describe('updateTabletopScreenSettingsSchema', () => {
    it('rejects invalid gridStyle', async () => {
      const { updateTabletopScreenSettingsSchema } = await import('~/types/schemas/tabletop');
      const result = updateTabletopScreenSettingsSchema.safeParse({
        id: 'screen-1',
        campaignId: 'abc123',
        gridStyle: 'neon',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid gridStyle', async () => {
      const { updateTabletopScreenSettingsSchema } = await import('~/types/schemas/tabletop');
      const result = updateTabletopScreenSettingsSchema.safeParse({
        id: 'screen-1',
        campaignId: 'abc123',
        gridStyle: 'hex',
      });
      expect(result.success).toBe(true);
      expect(result.data?.gridStyle).toBe('hex');
    });

    it('accepts partial settings', async () => {
      const { updateTabletopScreenSettingsSchema } = await import('~/types/schemas/tabletop');
      const result = updateTabletopScreenSettingsSchema.safeParse({
        id: 'screen-1',
        campaignId: 'abc123',
        gridSize: 60,
        gridVisible: false,
      });
      expect(result.success).toBe(true);
      expect(result.data?.gridSize).toBe(60);
      expect(result.data?.gridVisible).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // openTabletopWindowSchema
  // -----------------------------------------------------------------------

  describe('openTabletopWindowSchema', () => {
    it('rejects invalid collection name', async () => {
      const { openTabletopWindowSchema } = await import('~/types/schemas/tabletop');
      const result = openTabletopWindowSchema.safeParse({
        screenId: 'screen-1',
        campaignId: 'abc123',
        collection: 'spell',
        documentId: 'doc-1',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid input', async () => {
      const { openTabletopWindowSchema } = await import('~/types/schemas/tabletop');
      const result = openTabletopWindowSchema.safeParse({
        screenId: 'screen-1',
        campaignId: 'abc123',
        collection: 'note',
        documentId: 'doc-1',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        screenId: 'screen-1',
        campaignId: 'abc123',
        collection: 'note',
        documentId: 'doc-1',
      });
    });

    it('accepts all valid collection names', async () => {
      const { openTabletopWindowSchema } = await import('~/types/schemas/tabletop');
      for (const collection of ['note', 'character', 'race', 'rule', 'player']) {
        const result = openTabletopWindowSchema.safeParse({
          screenId: 'screen-1',
          campaignId: 'abc123',
          collection,
          documentId: 'doc-1',
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // updatePlayerStateSchema
  // -----------------------------------------------------------------------

  describe('updatePlayerStateSchema', () => {
    it('accepts viewport update', async () => {
      const { updatePlayerStateSchema } = await import('~/types/schemas/tabletop');
      const result = updatePlayerStateSchema.safeParse({
        campaignId: 'abc123',
        viewport: {
          screenId: 'screen-1',
          zoom: 1.5,
          panX: 100,
          panY: -50,
        },
      });
      expect(result.success).toBe(true);
      expect(result.data?.viewport?.zoom).toBe(1.5);
      expect(result.data?.viewport?.panX).toBe(100);
      expect(result.data?.viewport?.panY).toBe(-50);
    });

    it('accepts windowOverride', async () => {
      const { updatePlayerStateSchema } = await import('~/types/schemas/tabletop');
      const result = updatePlayerStateSchema.safeParse({
        campaignId: 'abc123',
        windowOverride: {
          windowId: 'win-1',
          x: 200,
          y: 150,
          width: 400,
          height: 300,
          state: 'minimized',
        },
      });
      expect(result.success).toBe(true);
      expect(result.data?.windowOverride?.state).toBe('minimized');
    });

    it('accepts activeScreenId update', async () => {
      const { updatePlayerStateSchema } = await import('~/types/schemas/tabletop');
      const result = updatePlayerStateSchema.safeParse({
        campaignId: 'abc123',
        activeScreenId: 'screen-2',
      });
      expect(result.success).toBe(true);
      expect(result.data?.activeScreenId).toBe('screen-2');
    });

    it('accepts null activeScreenId', async () => {
      const { updatePlayerStateSchema } = await import('~/types/schemas/tabletop');
      const result = updatePlayerStateSchema.safeParse({
        campaignId: 'abc123',
        activeScreenId: null,
      });
      expect(result.success).toBe(true);
      expect(result.data?.activeScreenId).toBeNull();
    });

    it('rejects invalid windowOverride state', async () => {
      const { updatePlayerStateSchema } = await import('~/types/schemas/tabletop');
      const result = updatePlayerStateSchema.safeParse({
        campaignId: 'abc123',
        windowOverride: {
          windowId: 'win-1',
          x: 200,
          y: 150,
          width: 400,
          height: 300,
          state: 'invalid',
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
