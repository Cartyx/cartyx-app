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
    updateOne: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Note', () => ({ Note: { find: vi.fn() } }));
vi.mock('~/server/db/models/Character', () => ({ Character: { find: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { find: vi.fn() } }));
vi.mock('~/server/db/models/Rule', () => ({ Rule: { find: vi.fn() } }));
// hydrateRefs lazily `await import`s these — getPlayerState now hydrates the
// caller's private windows, so they get pulled in by that path.
vi.mock('~/server/db/models/Lore', () => ({ Lore: { find: vi.fn() } }));
vi.mock('~/server/db/models/Monster', () => ({ Monster: { find: vi.fn() } }));
vi.mock('~/server/db/models/Event', () => ({ Event: { find: vi.fn() } }));
// `Types` is the real implementation: addPrivateWindow validates screen ids
// with ObjectId.isValid and builds a real ObjectId for its $expr cap filter.
vi.mock('mongoose', async () => {
  const actual = await vi.importActual<typeof import('mongoose')>('mongoose');
  return { default: { startSession: vi.fn(), Types: actual.Types } };
});
vi.mock('~/server/db/models/GMScreen', () => ({ GMScreen: { findOne: vi.fn() } }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { TabletopScreen } from '~/server/db/models/TabletopScreen';
import { TabletopPlayerState } from '~/server/db/models/TabletopPlayerState';
import { Lore } from '~/server/db/models/Lore';
import { Monster } from '~/server/db/models/Monster';
import { Note } from '~/server/db/models/Note';
import { Event } from '~/server/db/models/Event';
import { Character } from '~/server/db/models/Character';
import { Race } from '~/server/db/models/Race';
import { Rule } from '~/server/db/models/Rule';
import { openTabletopWindow, getPlayerState, addPrivateWindow } from '~/server/functions/tabletop';

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
        collection: 'not-a-real-collection',
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
      $expr: { $lt: [{ $size: { $ifNull: ['$windows', []] } }, 20] },
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

  it('closes the cap race: two concurrent opens of DIFFERENT refs at length cap-1 — exactly one succeeds, the loser gets the cap error', async () => {
    // Mirrors the gmscreens cap-race test — see that file for the fuller
    // rationale. Both calls read 19 windows (below the cap), both pass the
    // early length check; the cap folded into the atomic filter is what
    // stops the second push from landing a 21st window.
    const nineteenWindows = Array.from({ length: 19 }, (_, i) => ({
      _id: `win-${i}`,
      collection: 'note',
      documentId: `note-${i}`,
      state: 'open',
      zIndex: i,
    }));
    const screenA = makeScreenWithWindows([...nineteenWindows]);
    const screenB = makeScreenWithWindows([...nineteenWindows]);
    vi.mocked(TabletopScreen.findOne)
      .mockResolvedValueOnce(screenA as never)
      .mockResolvedValueOnce(screenB as never);

    // A's atomic push wins.
    mockSuccessfulAtomicPush({
      _id: 'win-a',
      collection: 'note',
      documentId: 'note-a',
      state: 'open',
      x: null,
      y: null,
      width: null,
      height: null,
      zIndex: 20,
    });
    // B's push loses on the $expr size condition (doc now has 20 windows);
    // B's re-fetch does not contain B's ref → cap error, not a focus.
    vi.mocked(TabletopScreen.updateOne).mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: null,
    } as never);
    const refreshedAtCap = makeScreenWithWindows([
      ...nineteenWindows,
      { _id: 'win-a', collection: 'note', documentId: 'note-a', state: 'open', zIndex: 20 },
    ]);
    vi.mocked(TabletopScreen.findOne).mockResolvedValueOnce(refreshedAtCap as never);

    const [resultA, resultB] = await Promise.allSettled([
      _openTabletopWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-a',
        },
      }),
      _openTabletopWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-b',
        },
      }),
    ]);

    expect(resultA.status).toBe('fulfilled');
    if (resultA.status === 'fulfilled') {
      expect(resultA.value.existed).toBe(false);
      expect(resultA.value.window.documentId).toBe('note-a');
    }
    expect(resultB.status).toBe('rejected');
    if (resultB.status === 'rejected') {
      expect(String(resultB.reason)).toContain('A screen cannot have more than 20 windows');
    }

    // Both pushes carried the cap condition in their filter.
    for (const call of vi.mocked(TabletopScreen.updateOne).mock.calls) {
      expect(call[0]).toMatchObject({
        $expr: { $lt: [{ $size: { $ifNull: ['$windows', []] } }, 20] },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// getPlayerState hydrates the caller's private windows.
//
// Private windows hang off TabletopPlayerState, so getTabletopScreen's
// hydration (which only reads TabletopScreen.windows) never covers them. If
// this hydration regresses, private windows silently render titled
// "collection:documentId".
// ---------------------------------------------------------------------------

describe('getPlayerState (handler) — private-window hydration', () => {
  const mockDbUser = { _id: 'dbuser-1', firstName: 'Test', lastName: 'User' };

  const _getPlayerState = getPlayerState as unknown as (args: {
    data: Record<string, unknown>;
  }) => Promise<{
    privateWindows: Array<{ id: string; collection: string; documentId: string }>;
    hydrated: Record<string, { title: string; content: string }>;
  } | null>;

  function mockSessionAs(role: 'gm' | 'player') {
    const session = {
      id: 'session-user-1',
      provider: 'google',
      name: 'Test User',
      email: 'test@example.com',
      avatar: null,
      role,
      accessToken: null,
      refreshToken: null,
      tokenIssuedAt: 0,
    };
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: role === 'gm' ? 'dbuser-1' : 'someone-else',
      members: [{ userId: 'dbuser-1', role }],
    } as never);
  }

  function mockPlayerStateDoc(privateWindows: Array<Record<string, unknown>>) {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'ps-1',
        campaignId: 'camp-1',
        userId: 'dbuser-1',
        privateWindows,
      }),
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Lore.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'lore-1', title: 'The Sunken Crown', content: 'x' }]),
    } as never);
    vi.mocked(Monster.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'mon-1', name: 'Beholder', gmNotes: 'secret' }]),
    } as never);
    vi.mocked(Note.find).mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue([
          { _id: 'note-secret', title: 'GM Session Plan', note: 'TPK in act 3' },
        ]),
    } as never);
    vi.mocked(Event.find).mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue([
          { _id: 'evt-secret', title: 'The Ambush', content: 'goblins', isPublic: false },
        ]),
    } as never);
  });

  /** The security reviewer's reproduction payload: a non-public lore entry. */
  function mockSecretLore() {
    vi.mocked(Lore.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'lore-secret',
          title: 'The GM Twist',
          content: 'The duke is a lich',
          isPublic: false,
        },
      ]),
    } as never);
  }

  function privateWindow(collection: string, documentId: string) {
    return {
      _id: `pw-${documentId}`,
      surface: 'tabletop',
      screenId: 'ts-1',
      collection,
      documentId,
    };
  }

  it('hydrates a private window so the owner gets a real title', async () => {
    mockSessionAs('gm');
    mockPlayerStateDoc([
      {
        _id: 'pw-1',
        surface: 'tabletop',
        screenId: 'ts-1',
        collection: 'lore',
        documentId: 'lore-1',
      },
    ]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['lore:lore-1']).toMatchObject({ title: 'The Sunken Crown' });
  });

  it('never hydrates a monster private window for a player', async () => {
    // addPrivateWindow is member-level and does not constrain `collection`, so a
    // crafted call could park a monster on a player's own state. Hydrating it
    // would hand back the monster's name and gmNotes.
    mockSessionAs('player');
    mockPlayerStateDoc([
      {
        _id: 'pw-1',
        surface: 'tabletop',
        screenId: 'ts-1',
        collection: 'monster',
        documentId: 'mon-1',
      },
    ]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['monster:mon-1']).toBeUndefined();
    expect(Monster.find).not.toHaveBeenCalled();
  });

  it('does hydrate a monster private window for the GM', async () => {
    mockSessionAs('gm');
    mockPlayerStateDoc([
      {
        _id: 'pw-1',
        surface: 'tabletop',
        screenId: 'ts-1',
        collection: 'monster',
        documentId: 'mon-1',
      },
    ]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['monster:mon-1']).toMatchObject({ title: 'Beholder' });
  });

  // -------------------------------------------------------------------------
  // Private-window hydration is a second read path onto campaign documents.
  // addPrivateWindow is member-level and its schema accepts every collection,
  // so a player can craft a window pointing at any document id. Hydration must
  // therefore enforce the same visibility rules the sanctioned per-collection
  // getters do (e.g. getLore returns null for a non-public doc to a non-GM).
  // -------------------------------------------------------------------------

  it('never hydrates a non-public lore private window for a player', async () => {
    // Security reviewer's reproduction: a player crafts
    // addPrivateWindow({ collection: 'lore', documentId: <gm-only lore> }) and
    // getPlayerState hands back the full body of a non-public lore entry.
    mockSessionAs('player');
    mockSecretLore();
    mockPlayerStateDoc([privateWindow('lore', 'lore-secret')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['lore:lore-secret']).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('The duke is a lich');
  });

  it('drops the disallowed lore private window rather than leaving a ghost', async () => {
    mockSessionAs('player');
    mockSecretLore();
    mockPlayerStateDoc([privateWindow('lore', 'lore-secret')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.privateWindows).toEqual([]);
  });

  it('still hydrates a public lore private window for a player', async () => {
    // Do not over-block: public docs must keep working for players.
    mockSessionAs('player');
    vi.mocked(Lore.find).mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue([
          { _id: 'lore-1', title: 'The Sunken Crown', content: 'x', isPublic: true },
        ]),
    } as never);
    mockPlayerStateDoc([privateWindow('lore', 'lore-1')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['lore:lore-1']).toMatchObject({ title: 'The Sunken Crown' });
    expect(result?.privateWindows).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // The creator exception. `listLore` shows a player their OWN non-public lore
  // (`$or: [{isPublic: true}, {createdBy: userId}]`) and `getLore` returns it
  // to the creator — so the wiki legitimately renders that card with a full
  // overflow menu. Filtering on `isPublic === false` alone is STRICTER than the
  // getters: Show on Tab would be accepted, then filtered back out on read, and
  // the row would be left orphaned — invisible to its owner, undeletable
  // (the client never receives its id), and still counting against the cap.
  // -------------------------------------------------------------------------

  it("hydrates a player's OWN non-public lore private window", async () => {
    mockSessionAs('player');
    vi.mocked(Lore.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'lore-mine',
          title: 'My Backstory',
          content: 'private but mine',
          isPublic: false,
          createdBy: 'dbuser-1',
        },
      ]),
    } as never);
    mockPlayerStateDoc([privateWindow('lore', 'lore-mine')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['lore:lore-mine']).toMatchObject({ title: 'My Backstory' });
    expect(result?.privateWindows).toHaveLength(1);
  });

  it('still blocks a non-public lore created by SOMEONE ELSE', async () => {
    mockSessionAs('player');
    vi.mocked(Lore.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'lore-theirs',
          title: 'The GM Twist',
          content: 'The duke is a lich',
          isPublic: false,
          createdBy: 'someone-else',
        },
      ]),
    } as never);
    mockPlayerStateDoc([privateWindow('lore', 'lore-theirs')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['lore:lore-theirs']).toBeUndefined();
    expect(result?.privateWindows).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('The duke is a lich');
  });

  it('grants NO creator exception for rules, matching listRules/getRule', async () => {
    // Rules are the one isPublic-bearing collection whose getters give a non-GM
    // public rules only — no `createdBy` branch. The private path must not be
    // more generous than the getter it mirrors.
    mockSessionAs('player');
    vi.mocked(Rule.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'rule-mine',
          title: 'My House Rule',
          content: 'hidden',
          isPublic: false,
          createdBy: 'dbuser-1',
        },
      ]),
    } as never);
    mockPlayerStateDoc([privateWindow('rule', 'rule-mine')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['rule:rule-mine']).toBeUndefined();
    expect(result?.privateWindows).toEqual([]);
  });

  it('does hydrate a non-public lore private window for the GM', async () => {
    mockSessionAs('gm');
    mockSecretLore();
    mockPlayerStateDoc([privateWindow('lore', 'lore-secret')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['lore:lore-secret']).toMatchObject({ title: 'The GM Twist' });
    expect(result?.privateWindows).toHaveLength(1);
  });

  it('never hydrates a note private window for a player', async () => {
    // Note.isPublic defaults to false and the note fetcher does not select it,
    // so a player's note window is never provably public — fail closed.
    mockSessionAs('player');
    mockPlayerStateDoc([privateWindow('note', 'note-secret')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['note:note-secret']).toBeUndefined();
    expect(result?.privateWindows).toEqual([]);
    expect(Note.find).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('TPK in act 3');
  });

  it('does hydrate a note private window for the GM', async () => {
    mockSessionAs('gm');
    mockPlayerStateDoc([privateWindow('note', 'note-secret')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['note:note-secret']).toMatchObject({ title: 'GM Session Plan' });
  });

  it('never hydrates an events private window for a player', async () => {
    // events is GM-only on the private path regardless of isPublic.
    mockSessionAs('player');
    mockPlayerStateDoc([privateWindow('events', 'evt-secret')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.hydrated['events:evt-secret']).toBeUndefined();
    expect(result?.privateWindows).toEqual([]);
    expect(Event.find).not.toHaveBeenCalled();
  });

  it('drops the disallowed monster private window rather than leaving a ghost', async () => {
    mockSessionAs('player');
    mockPlayerStateDoc([privateWindow('monster', 'mon-1')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.privateWindows).toEqual([]);
  });

  it('keeps allowed windows while dropping disallowed ones in the same state', async () => {
    mockSessionAs('player');
    vi.mocked(Lore.find).mockReturnValue({
      lean: vi
        .fn()
        .mockResolvedValue([
          { _id: 'lore-1', title: 'The Sunken Crown', content: 'x', isPublic: true },
        ]),
    } as never);
    mockPlayerStateDoc([privateWindow('lore', 'lore-1'), privateWindow('monster', 'mon-1')]);

    const result = await _getPlayerState({ data: { campaignId: 'camp-1' } });

    expect(result?.privateWindows.map((pw) => pw.collection)).toEqual(['lore']);
    expect(result?.hydrated['lore:lore-1']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// addPrivateWindow — defense in depth.
//
// The hydration filter in getPlayerState is the load-bearing fix (it protects
// rows already stored). This guard stops the GM-only rows being written at all.
// ---------------------------------------------------------------------------

describe('addPrivateWindow (handler) — GM-only collection guard', () => {
  // Real ObjectIds: the handler validates the screen id and rejects malformed
  // ones before it ever reaches the collection guard under test here.
  const CAMPAIGN_ID = '65b0000000000000000000c1';
  const SCREEN_ID = '65b0000000000000000000e1';
  const DOC_ID = '65b0000000000000000000f1';
  const mockDbUser = { _id: 'dbuser-1', firstName: 'Test', lastName: 'User' };

  const _addPrivateWindow = addPrivateWindow as unknown as (args: {
    data: Record<string, unknown>;
  }) => Promise<unknown>;

  function mockSessionAs(role: 'gm' | 'player') {
    const session = {
      id: 'session-user-1',
      provider: 'google',
      name: 'Test User',
      email: 'test@example.com',
      avatar: null,
      role,
      accessToken: null,
      refreshToken: null,
      tokenIssuedAt: 0,
    };
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: CAMPAIGN_ID,
      gameMasterId: role === 'gm' ? 'dbuser-1' : 'someone-else',
      members: [{ userId: 'dbuser-1', role }],
    } as never);
  }

  /** A lean() chain resolving to `value`. */
  function lean(value: unknown) {
    return { lean: vi.fn().mockResolvedValue(value) } as never;
  }

  /** Every hydration fetcher returns one PUBLIC doc, so only the collection
   *  guard under test can be the reason a call is rejected. */
  function stubHydrationDoc() {
    const doc = [{ _id: DOC_ID, title: 'Doc', name: 'Doc', content: '', isPublic: true }];
    for (const model of [Note, Character, Race, Rule, Lore, Monster, Event]) {
      (model as unknown as { find: ReturnType<typeof vi.fn> }).find.mockReturnValue(lean(doc));
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      lean({
        _id: 'ps-1',
        campaignId: CAMPAIGN_ID,
        userId: 'dbuser-1',
        privateWindows: [],
      })
    );
    vi.mocked(TabletopPlayerState.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
    vi.mocked(TabletopScreen.findOne).mockReturnValue(lean({ _id: SCREEN_ID }));
    stubHydrationDoc();
  });

  function payload(collection: string) {
    return {
      campaignId: CAMPAIGN_ID,
      surface: 'tabletop',
      screenId: SCREEN_ID,
      collection,
      documentId: DOC_ID,
    };
  }

  for (const collection of ['monster', 'events']) {
    it(`rejects a ${collection} private window from a player`, async () => {
      mockSessionAs('player');

      await expect(_addPrivateWindow({ data: payload(collection) })).rejects.toThrow();
      expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
    });

    it(`allows a ${collection} private window from the GM`, async () => {
      mockSessionAs('gm');

      await _addPrivateWindow({ data: payload(collection) });

      expect(TabletopPlayerState.updateOne).toHaveBeenCalled();
    });
  }

  it('still allows a non-GM-only collection from a player', async () => {
    mockSessionAs('player');

    await _addPrivateWindow({ data: payload('lore') });

    expect(TabletopPlayerState.updateOne).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // `note` is not in GM_ONLY_COLLECTIONS (it isn't "GM-only" — GMs and players
  // both have notes), but getPlayerState's hydration filter denies it on the
  // PRIVATE-window path for non-GMs (see tabletop-hydration.ts). Without a
  // matching guard here, a player's addPrivateWindow({ collection: 'note' })
  // succeeds, is never hydrated back, and still burns a MAX_PRIVATE_WINDOWS
  // slot — a silent void plus a quota leak.
  // -------------------------------------------------------------------------

  it('rejects a note private window from a player', async () => {
    mockSessionAs('player');

    await expect(_addPrivateWindow({ data: payload('note') })).rejects.toThrow();
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('allows a note private window from the GM', async () => {
    mockSessionAs('gm');

    await _addPrivateWindow({ data: payload('note') });

    expect(TabletopPlayerState.updateOne).toHaveBeenCalled();
  });
});
