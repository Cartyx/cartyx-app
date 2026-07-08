import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for the openTabletopWindow handler-level tests below. These only
// affect the `describe('openTabletopWindow (handler)', ...)` block further
// down — the schema-only tests above use dynamic `import()` of the zod
// schemas directly and are unaffected by mocking the server modules.
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));
vi.mock('~/server/db/models/User', () => ({
  User: { findOne: vi.fn() },
}));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findById: vi.fn() },
}));
vi.mock('~/server/db/models/TabletopScreen', () => ({
  TabletopScreen: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    countDocuments: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    deleteOne: vi.fn(),
  },
  TABLETOP_LIMITS: { MAX_WINDOWS: 20 },
}));
vi.mock('~/server/db/models/TabletopPlayerState', () => ({
  TabletopPlayerState: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Note', () => ({ Note: { find: vi.fn() } }));
vi.mock('~/server/db/models/Character', () => ({ Character: { find: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { find: vi.fn() } }));
vi.mock('~/server/db/models/Rule', () => ({ Rule: { find: vi.fn() } }));
vi.mock('~/server/utils/posthog', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('mongoose', () => ({
  default: { startSession: vi.fn() },
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { TabletopScreen } from '~/server/db/models/TabletopScreen';
import { openTabletopWindow } from '~/server/functions/tabletop';
import { serverCaptureEvent } from '~/server/utils/posthog';

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

// ---------------------------------------------------------------------------
// openTabletopWindow (handler) — mirrors the atomic dedupe fix + tests in
// tests/server/functions/gmscreens.test.ts's `describe('openWindow', ...)`.
// See that file for the fuller rationale comments; kept terser here to
// avoid duplicating the same essay twice.
// ---------------------------------------------------------------------------

describe('openTabletopWindow (handler)', () => {
  const mockSession = {
    id: 'session-user-1',
    provider: 'google',
    name: 'Test User',
    email: 'test@example.com',
    avatar: null,
    role: 'gm',
    accessToken: null,
    refreshToken: null,
    tokenIssuedAt: 0,
  };
  const mockDbUser = { _id: 'dbuser-1', firstName: 'Test', lastName: 'User' };
  const mockCampaign = {
    _id: 'camp-1',
    gameMasterId: 'dbuser-1',
    members: [{ userId: 'dbuser-1', role: 'gm' }],
  };

  const _openTabletopWindow = openTabletopWindow as unknown as (args: {
    data: Record<string, unknown>;
  }) => Promise<{
    success: boolean;
    window: {
      id: string;
      collection: string;
      documentId: string;
      state: string;
      zIndex: number;
      x: number | null;
      y: number | null;
    };
    existed: boolean;
  }>;

  function makeScreenWithWindows(windows: Array<Record<string, unknown>> = []) {
    return {
      _id: 'screen-1',
      campaignId: 'camp-1',
      windows,
      updatedAt: new Date('2026-03-01'),
      save: vi.fn(),
    };
  }

  function mockSuccessfulAtomicPush(createdWindow: Record<string, unknown>) {
    vi.mocked(TabletopScreen.updateOne).mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    } as never);
    vi.mocked(TabletopScreen.findOne).mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({ windows: [createdWindow] }),
    } as never);
  }

  function mockLostAtomicPushRace(refreshedScreen: Record<string, unknown>) {
    vi.mocked(TabletopScreen.updateOne).mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: null,
    } as never);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(refreshedScreen as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
    vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign as never);
  });

  it('creates a new window with zIndex bumped above existing', async () => {
    const screen = makeScreenWithWindows([
      { _id: 'win-1', collection: 'note', documentId: 'note-1', state: 'open', zIndex: 3 },
    ]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screen as never);
    mockSuccessfulAtomicPush({
      _id: 'win-2',
      collection: 'note',
      documentId: 'note-2',
      state: 'open',
      x: null,
      y: null,
      width: null,
      height: null,
      zIndex: 4,
    });

    const result = await _openTabletopWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-2',
      },
    });

    expect(result.success).toBe(true);
    expect(result.existed).toBe(false);
    expect(result.window.zIndex).toBe(4);

    const [filter, update] = vi.mocked(TabletopScreen.updateOne).mock.calls[0]!;
    expect(filter).toMatchObject({
      _id: 'screen-1',
      campaignId: 'camp-1',
      $nor: [{ windows: { $elemMatch: { collection: 'note', documentId: 'note-2' } } }],
    });
    expect(update).toMatchObject({
      $push: { windows: expect.objectContaining({ collection: 'note', documentId: 'note-2' }) },
    });
  });

  it('focuses existing window instead of creating a duplicate', async () => {
    const existingWin = {
      _id: 'win-1',
      collection: 'note',
      documentId: 'note-1',
      state: 'minimized',
      zIndex: 1,
    };
    const screen = makeScreenWithWindows([existingWin]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screen as never);

    const result = await _openTabletopWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(result.success).toBe(true);
    expect(result.existed).toBe(true);
    expect(result.window.id).toBe('win-1');
    expect(result.window.zIndex).toBe(2);
    expect(screen.save).toHaveBeenCalled();
    expect(TabletopScreen.updateOne).not.toHaveBeenCalled();
  });

  it('enforces the 20-window cap', async () => {
    const windows = Array.from({ length: 20 }, (_, i) => ({
      _id: `win-${i}`,
      collection: 'note',
      documentId: `note-${i}`,
      state: 'open',
      zIndex: i,
    }));
    const screen = makeScreenWithWindows(windows);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screen as never);

    await expect(
      _openTabletopWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-new',
        },
      })
    ).rejects.toThrow('A screen cannot have more than 20 windows');
  });

  it('throws when screen is not found', async () => {
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(null as never);

    await expect(
      _openTabletopWindow({
        data: {
          screenId: 'nonexistent',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-1',
        },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('fires tabletop_window_opened analytics event for new window', async () => {
    const screen = makeScreenWithWindows([]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screen as never);
    mockSuccessfulAtomicPush({
      _id: 'win-1',
      collection: 'note',
      documentId: 'note-1',
      state: 'open',
      x: null,
      y: null,
      width: null,
      height: null,
      zIndex: 1,
    });

    await _openTabletopWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(serverCaptureEvent).toHaveBeenCalledWith(
      'session-user-1',
      'tabletop_window_opened',
      expect.objectContaining({ campaign_id: 'camp-1', screen_id: 'screen-1' })
    );
  });

  // -------------------------------------------------------------------
  // Atomicity / dedupe-race pinning (mirrors gmscreens.test.ts)
  // -------------------------------------------------------------------

  it('does not create a duplicate on a sequential double-call for the same ref', async () => {
    const screenRead1 = makeScreenWithWindows([]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screenRead1 as never);
    const createdWindow = {
      _id: 'win-1',
      collection: 'note',
      documentId: 'note-1',
      state: 'open',
      x: null,
      y: null,
      width: null,
      height: null,
      zIndex: 1,
    };
    mockSuccessfulAtomicPush(createdWindow);

    const first = await _openTabletopWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });
    expect(first.existed).toBe(false);

    const screenRead2 = makeScreenWithWindows([createdWindow]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screenRead2 as never);

    const second = await _openTabletopWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(second.existed).toBe(true);
    expect(second.window.id).toBe('win-1');
    expect(TabletopScreen.updateOne).toHaveBeenCalledTimes(1);
  });

  it('closes the create/create race: a second call that read stale (empty) state is rejected by the atomic filter and focuses the winner instead of duplicating', async () => {
    const screenRead = makeScreenWithWindows([]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screenRead as never);

    const createdWindow = {
      _id: 'win-1',
      collection: 'note',
      documentId: 'note-1',
      state: 'open',
      x: null,
      y: null,
      width: null,
      height: null,
      zIndex: 1,
    };
    mockSuccessfulAtomicPush(createdWindow);

    const first = await _openTabletopWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });
    expect(first.existed).toBe(false);

    const screenRead2 = makeScreenWithWindows([]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(screenRead2 as never);
    const refreshedScreen = makeScreenWithWindows([{ ...createdWindow }]);
    mockLostAtomicPushRace(refreshedScreen);

    const second = await _openTabletopWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(second.existed).toBe(true);
    expect(second.window.id).toBe('win-1');
    expect(refreshedScreen.windows).toHaveLength(1);
    expect(refreshedScreen.save).toHaveBeenCalled();
  });

  it('fires two concurrent opens for the same ref via Promise.all and asserts exactly one "created" result', async () => {
    const screenA = makeScreenWithWindows([]);
    const screenB = makeScreenWithWindows([]);
    vi.mocked(TabletopScreen.findOne)
      .mockResolvedValueOnce(screenA as never)
      .mockResolvedValueOnce(screenB as never);

    const createdWindow = {
      _id: 'win-1',
      collection: 'note',
      documentId: 'note-1',
      state: 'open',
      x: null,
      y: null,
      width: null,
      height: null,
      zIndex: 1,
    };
    mockSuccessfulAtomicPush(createdWindow);
    const refreshedForB = makeScreenWithWindows([{ ...createdWindow }]);
    mockLostAtomicPushRace(refreshedForB);

    const [resultA, resultB] = await Promise.all([
      _openTabletopWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-1',
        },
      }),
      _openTabletopWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-1',
        },
      }),
    ]);

    const existedFlags = [resultA.existed, resultB.existed].sort();
    expect(TabletopScreen.updateOne).toHaveBeenCalledTimes(2);
    expect(existedFlags).toEqual([false, true]);
  });
});
