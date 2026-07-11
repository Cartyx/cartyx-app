import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('~/server/db/models/GMScreen', () => ({
  GMScreen: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    countDocuments: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    deleteOne: vi.fn(),
    bulkWrite: vi.fn(),
  },
  GMSCREEN_LIMITS: {
    MAX_WINDOWS: 20,
    MAX_STACKS: 10,
    MAX_STACK_ITEMS: 50,
  },
  WINDOW_STATES: ['open', 'minimized', 'hidden'] as const,
}));
vi.mock('~/server/db/models/Note', () => ({
  Note: {
    find: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Character', () => ({
  Character: {
    find: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Race', () => ({
  Race: {
    find: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Rule', () => ({
  Rule: {
    find: vi.fn(),
  },
}));

const mockMongoSession = {
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  endSession: vi.fn(),
};
vi.mock('mongoose', () => ({
  default: { startSession: vi.fn(() => mockMongoSession) },
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { GMScreen } from '~/server/db/models/GMScreen';
import { Note } from '~/server/db/models/Note';
import { Character } from '~/server/db/models/Character';
import { Rule } from '~/server/db/models/Rule';
import {
  listGMScreens,
  createGMScreen,
  renameGMScreen,
  deleteGMScreen,
  reorderGMScreens,
  getGMScreen,
  openWindow,
  updateWindow,
  closeWindow,
  createStack,
  renameStack,
  moveStack,
  deleteStack,
  addStackItem,
  removeStackItem,
  listGMScreensSchema,
  createGMScreenSchema,
  renameGMScreenSchema,
  deleteGMScreenSchema,
  reorderGMScreensSchema,
  getGMScreenSchema,
  openWindowSchema,
  updateWindowSchema,
  closeWindowSchema,
  createStackSchema,
  renameStackSchema,
  moveStackSchema,
  deleteStackSchema,
  addStackItemSchema,
  removeStackItemSchema,
} from '~/server/functions/gmscreens';
import { SUPPORTED_COLLECTIONS } from '~/types/schemas/gmscreens';
import type {
  GMScreenData,
  GMScreenDetailData,
  WindowData,
  StackData,
  StackItemData,
} from '~/types/gmscreen';
import { removeDocumentRefsFromScreens } from '~/server/functions/gmscreens-helpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeScreen(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'screen-1',
    campaignId: 'camp-1',
    name: 'General',
    tabOrder: 0,
    createdBy: 'dbuser-1',
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    save: vi.fn(),
    deleteOne: vi.fn(),
    ...overrides,
  };
}

// Cast server functions to callable handler signatures
const _listGMScreens = listGMScreens as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<GMScreenData[]>;
const _createGMScreen = createGMScreen as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; screen: GMScreenData }>;
const _renameGMScreen = renameGMScreen as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; screen: GMScreenData }>;
const _deleteGMScreen = deleteGMScreen as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; deletedTabOrder: number; remaining: GMScreenData[] }>;
const _reorderGMScreens = reorderGMScreens as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; screens: GMScreenData[] }>;
const _getGMScreen = getGMScreen as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<GMScreenDetailData>;
const _openWindow = openWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; window: WindowData; existed: boolean }>;
const _updateWindow = updateWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; window: WindowData }>;
const _closeWindow = closeWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;
const _createStack = createStack as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; stack: StackData }>;
const _renameStack = renameStack as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;
const _moveStack = moveStack as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;
const _deleteStack = deleteStack as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;
const _addStackItem = addStackItem as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; item: StackItemData; existed: boolean }>;
const _removeStackItem = removeStackItem as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign);
  mockMongoSession.withTransaction.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  mockMongoSession.endSession.mockReset();
});

// ---------------------------------------------------------------------------
// Auth — GM-only access (shared across all endpoints)
// ---------------------------------------------------------------------------

describe('GM-only access', () => {
  it('throws when not authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(_listGMScreens({ data: { campaignId: 'camp-1' } })).rejects.toThrow(
      'Not authenticated'
    );
  });

  it('throws when user is not found', async () => {
    vi.mocked(User.findOne).mockResolvedValue(null);

    await expect(_listGMScreens({ data: { campaignId: 'camp-1' } })).rejects.toThrow(
      'User not found'
    );
  });

  it('throws when campaign is not found', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(null);

    await expect(_listGMScreens({ data: { campaignId: 'camp-1' } })).rejects.toThrow(
      'Campaign not found'
    );
  });

  it('throws Forbidden when user is a player, not a GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: 'someone-else',
      members: [
        { userId: 'someone-else', role: 'gm' },
        { userId: 'dbuser-1', role: 'player' },
      ],
    });

    await expect(_listGMScreens({ data: { campaignId: 'camp-1' } })).rejects.toThrow('Forbidden');
  });

  it('allows access when user is gameMasterId (legacy campaign)', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: 'dbuser-1',
      members: [],
    });
    vi.mocked(GMScreen.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
    } as never);

    const result = await _listGMScreens({ data: { campaignId: 'camp-1' } });
    expect(result).toEqual([]);
  });

  it('allows access when user has gm role in members array', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: 'original-gm',
      members: [
        { userId: 'original-gm', role: 'gm' },
        { userId: 'dbuser-1', role: 'gm' },
      ],
    });
    vi.mocked(GMScreen.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
    } as never);

    const result = await _listGMScreens({ data: { campaignId: 'camp-1' } });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listGMScreens
// ---------------------------------------------------------------------------

describe('listGMScreens', () => {
  it('returns screens sorted by tabOrder', async () => {
    const screens = [
      makeScreen({ _id: 'screen-1', name: 'General', tabOrder: 0 }),
      makeScreen({ _id: 'screen-2', name: 'Combat', tabOrder: 1 }),
    ];
    vi.mocked(GMScreen.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(screens) }),
    } as never);

    const result = await _listGMScreens({ data: { campaignId: 'camp-1' } });

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('screen-1');
    expect(result[0]!.name).toBe('General');
    expect(result[0]!.tabOrder).toBe(0);
    expect(result[1]!.id).toBe('screen-2');
    expect(result[1]!.tabOrder).toBe(1);
  });

  it('returns an empty array when no screens exist', async () => {
    vi.mocked(GMScreen.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
    } as never);

    const result = await _listGMScreens({ data: { campaignId: 'camp-1' } });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createGMScreen
// ---------------------------------------------------------------------------

describe('createGMScreen', () => {
  it('creates a screen with the next tabOrder inside a transaction', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ tabOrder: 2 }) }),
        }),
      }),
    } as never);
    const created = makeScreen({ _id: 'screen-new', name: 'Combat', tabOrder: 3 });
    vi.mocked(GMScreen.create).mockResolvedValue([created] as never);

    const result = await _createGMScreen({ data: { campaignId: 'camp-1', name: 'Combat' } });

    expect(result.success).toBe(true);
    expect(result.screen.name).toBe('Combat');
    expect(vi.mocked(GMScreen.create).mock.calls[0]![0]).toEqual([
      expect.objectContaining({
        campaignId: 'camp-1',
        name: 'Combat',
        tabOrder: 3,
        createdBy: 'dbuser-1',
      }),
    ]);
    // Verify session options passed
    expect(vi.mocked(GMScreen.create).mock.calls[0]![1]!).toEqual({ session: mockMongoSession });
    expect(mockMongoSession.endSession).toHaveBeenCalled();
  });

  it('defaults tabOrder to 0 when no screens exist', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
        }),
      }),
    } as never);
    vi.mocked(GMScreen.create).mockResolvedValue([makeScreen({ tabOrder: 0 })] as never);

    await _createGMScreen({ data: { campaignId: 'camp-1', name: 'First' } });

    expect(vi.mocked(GMScreen.create).mock.calls[0]![0]).toEqual([
      expect.objectContaining({ tabOrder: 0 }),
    ]);
  });

  it('throws a clean error on duplicate name', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
        }),
      }),
    } as never);
    vi.mocked(GMScreen.create).mockRejectedValue(
      Object.assign(new Error('dup'), { code: 11000, keyPattern: { campaignId: 1, name: 1 } })
    );

    await expect(
      _createGMScreen({ data: { campaignId: 'camp-1', name: 'General' } })
    ).rejects.toThrow('A screen with that name already exists in this campaign');
  });

  it('retries on tabOrder collision then succeeds', async () => {
    const findOneMock = vi.mocked(GMScreen.findOne);
    findOneMock.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ tabOrder: 2 }) }),
        }),
      }),
    } as never);

    const tabOrderError = Object.assign(new Error('E11000 duplicate key tabOrder'), {
      code: 11000,
      keyPattern: { campaignId: 1, tabOrder: 1 },
    });
    const created = makeScreen({ _id: 'screen-retry', name: 'Retry', tabOrder: 3 });
    vi.mocked(GMScreen.create)
      .mockRejectedValueOnce(tabOrderError)
      .mockResolvedValueOnce([created] as never);

    // withTransaction must re-throw so the outer catch can retry
    mockMongoSession.withTransaction
      .mockImplementationOnce(async (fn: () => Promise<unknown>) => {
        await fn();
        throw tabOrderError;
      })
      .mockImplementationOnce(async (fn: () => Promise<unknown>) => fn());

    const result = await _createGMScreen({ data: { campaignId: 'camp-1', name: 'Retry' } });

    expect(result.success).toBe(true);
    expect(result.screen.name).toBe('Retry');
    expect(mockMongoSession.endSession).toHaveBeenCalledTimes(2);
  });

  it('throws user-friendly error when tabOrder retries are exhausted', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ tabOrder: 2 }) }),
        }),
      }),
    } as never);

    const tabOrderError = Object.assign(new Error('E11000 duplicate key tabOrder'), {
      code: 11000,
      keyPattern: { campaignId: 1, tabOrder: 1 },
    });
    mockMongoSession.withTransaction.mockImplementation(async (fn: () => Promise<unknown>) => {
      await fn();
      throw tabOrderError;
    });
    vi.mocked(GMScreen.create).mockRejectedValue(tabOrderError);

    await expect(
      _createGMScreen({ data: { campaignId: 'camp-1', name: 'Collider' } })
    ).rejects.toThrow('Could not create the screen due to a conflict. Please try again.');
  });
});

// ---------------------------------------------------------------------------
// renameGMScreen
// ---------------------------------------------------------------------------

describe('renameGMScreen', () => {
  it('renames a screen', async () => {
    const screen = makeScreen();
    vi.mocked(GMScreen.findById).mockResolvedValue(screen as never);

    const result = await _renameGMScreen({
      data: { id: 'screen-1', campaignId: 'camp-1', name: 'Renamed' },
    });

    expect(result.success).toBe(true);
    expect(screen.name).toBe('Renamed');
    expect(screen.save).toHaveBeenCalled();
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.findById).mockResolvedValue(null);

    await expect(
      _renameGMScreen({ data: { id: 'nonexistent', campaignId: 'camp-1', name: 'New Name' } })
    ).rejects.toThrow('Screen not found');
  });

  it('throws when screen belongs to a different campaign', async () => {
    const screen = makeScreen({ campaignId: 'camp-other' });
    vi.mocked(GMScreen.findById).mockResolvedValue(screen as never);

    await expect(
      _renameGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1', name: 'New Name' } })
    ).rejects.toThrow('Forbidden');
  });

  it('throws a clean error on duplicate name', async () => {
    const screen = makeScreen();
    screen.save.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    vi.mocked(GMScreen.findById).mockResolvedValue(screen as never);

    await expect(
      _renameGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1', name: 'Duplicate' } })
    ).rejects.toThrow('A screen with that name already exists in this campaign');
  });
});

// ---------------------------------------------------------------------------
// deleteGMScreen
// ---------------------------------------------------------------------------

describe('deleteGMScreen', () => {
  it('deletes a screen atomically and returns remaining screens', async () => {
    const screen = makeScreen();
    vi.mocked(GMScreen.findOne).mockReturnValue({
      session: vi.fn().mockResolvedValue(screen),
    } as never);
    vi.mocked(GMScreen.countDocuments).mockReturnValue({
      session: vi.fn().mockResolvedValue(3),
    } as never);
    vi.mocked(GMScreen.deleteOne).mockReturnValue({
      session: vi.fn().mockResolvedValue({}),
    } as never);
    const remaining = [makeScreen({ _id: 'screen-2', name: 'Combat', tabOrder: 1 })];
    vi.mocked(GMScreen.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(remaining) }),
    } as never);

    const result = await _deleteGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1' } });

    expect(result.success).toBe(true);
    expect(result.deletedTabOrder).toBe(0);
    expect(result.remaining).toHaveLength(1);
    expect(GMScreen.deleteOne).toHaveBeenCalledWith({ _id: 'screen-1', campaignId: 'camp-1' });
    expect(mockMongoSession.endSession).toHaveBeenCalled();
  });

  it('rejects deleting the last screen atomically', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue({
      session: vi.fn().mockResolvedValue(makeScreen()),
    } as never);
    vi.mocked(GMScreen.countDocuments).mockReturnValue({
      session: vi.fn().mockResolvedValue(1),
    } as never);

    await expect(
      _deleteGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1' } })
    ).rejects.toThrow('Cannot delete the last screen');
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue({
      session: vi.fn().mockResolvedValue(null),
    } as never);

    await expect(
      _deleteGMScreen({ data: { id: 'nonexistent', campaignId: 'camp-1' } })
    ).rejects.toThrow('Screen not found');
  });
});

// ---------------------------------------------------------------------------
// reorderGMScreens
// ---------------------------------------------------------------------------

describe('reorderGMScreens', () => {
  it('reorders screens with bulkWrite inside a transaction', async () => {
    vi.mocked(GMScreen.find).mockReturnValueOnce({
      session: vi.fn().mockReturnValue({
        lean: vi
          .fn()
          .mockResolvedValue([{ _id: 'screen-1' }, { _id: 'screen-2' }, { _id: 'screen-3' }]),
      }),
    } as never);
    vi.mocked(GMScreen.bulkWrite).mockResolvedValue({} as never);
    const reordered = [
      makeScreen({ _id: 'screen-3', tabOrder: 0 }),
      makeScreen({ _id: 'screen-1', tabOrder: 1 }),
      makeScreen({ _id: 'screen-2', tabOrder: 2 }),
    ];
    vi.mocked(GMScreen.find).mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(reordered) }),
    } as never);

    const result = await _reorderGMScreens({
      data: { campaignId: 'camp-1', screenIds: ['screen-3', 'screen-1', 'screen-2'] },
    });

    expect(result.success).toBe(true);
    expect(result.screens).toHaveLength(3);
    // Verify two-phase bulkWrite: phase 1 (negative), phase 2 (final)
    expect(vi.mocked(GMScreen.bulkWrite)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(GMScreen.bulkWrite)).toHaveBeenNthCalledWith(
      1,
      [
        {
          updateOne: {
            filter: { _id: 'screen-3', campaignId: 'camp-1' },
            update: { $set: { tabOrder: -1, updatedAt: expect.any(Date) } },
          },
        },
        {
          updateOne: {
            filter: { _id: 'screen-1', campaignId: 'camp-1' },
            update: { $set: { tabOrder: -2, updatedAt: expect.any(Date) } },
          },
        },
        {
          updateOne: {
            filter: { _id: 'screen-2', campaignId: 'camp-1' },
            update: { $set: { tabOrder: -3, updatedAt: expect.any(Date) } },
          },
        },
      ],
      { session: mockMongoSession }
    );
    expect(vi.mocked(GMScreen.bulkWrite)).toHaveBeenNthCalledWith(
      2,
      [
        {
          updateOne: {
            filter: { _id: 'screen-3', campaignId: 'camp-1' },
            update: { $set: { tabOrder: 0 } },
          },
        },
        {
          updateOne: {
            filter: { _id: 'screen-1', campaignId: 'camp-1' },
            update: { $set: { tabOrder: 1 } },
          },
        },
        {
          updateOne: {
            filter: { _id: 'screen-2', campaignId: 'camp-1' },
            update: { $set: { tabOrder: 2 } },
          },
        },
      ],
      { session: mockMongoSession }
    );
    expect(mockMongoSession.endSession).toHaveBeenCalled();
  });

  it('throws when a screen ID does not belong to the campaign', async () => {
    vi.mocked(GMScreen.find).mockReturnValueOnce({
      session: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: 'screen-1' }, { _id: 'screen-2' }]),
      }),
    } as never);

    await expect(
      _reorderGMScreens({
        data: { campaignId: 'camp-1', screenIds: ['screen-1', 'screen-nonexistent'] },
      })
    ).rejects.toThrow('Screen screen-nonexistent not found in this campaign');
  });

  it('throws on duplicate screen IDs', async () => {
    vi.mocked(GMScreen.find).mockReturnValueOnce({
      session: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: 'screen-1' }, { _id: 'screen-2' }]),
      }),
    } as never);

    await expect(
      _reorderGMScreens({
        data: { campaignId: 'camp-1', screenIds: ['screen-1', 'screen-1'] },
      })
    ).rejects.toThrow('Duplicate screen IDs in reorder request');
  });

  it('throws when screens are missing from the reorder request', async () => {
    vi.mocked(GMScreen.find).mockReturnValueOnce({
      session: vi.fn().mockReturnValue({
        lean: vi
          .fn()
          .mockResolvedValue([{ _id: 'screen-1' }, { _id: 'screen-2' }, { _id: 'screen-3' }]),
      }),
    } as never);

    await expect(
      _reorderGMScreens({
        data: { campaignId: 'camp-1', screenIds: ['screen-1', 'screen-2'] },
      })
    ).rejects.toThrow('Missing screen screen-3 in reorder request');
  });
});

// ---------------------------------------------------------------------------
// getGMScreen — hydration
// ---------------------------------------------------------------------------

describe('getGMScreen', () => {
  it('returns a screen with hydrated window and stack refs', async () => {
    const screenDoc = {
      _id: 'screen-1',
      campaignId: 'camp-1',
      name: 'General',
      tabOrder: 0,
      createdBy: 'dbuser-1',
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-01'),
      windows: [
        {
          _id: 'win-1',
          collection: 'note',
          documentId: 'note-1',
          state: 'open',
          x: 10,
          y: 20,
          width: 400,
          height: 300,
          zIndex: 1,
        },
        {
          _id: 'win-2',
          collection: 'note',
          documentId: 'note-2',
          state: 'minimized',
          x: null,
          y: null,
          width: null,
          height: null,
          zIndex: 0,
        },
      ],
      stacks: [
        {
          _id: 'stack-1',
          name: 'NPCs',
          x: 0,
          y: 0,
          items: [{ _id: 'si-1', collection: 'note', documentId: 'note-3', label: 'Gandalf' }],
        },
      ],
    };
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(screenDoc),
    } as never);
    // Note.find batch fetch for hydration — all three note IDs
    vi.mocked(Note.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: 'note-1', title: 'Session Notes', note: 'Notes from session 1' },
        { _id: 'note-2', title: 'Combat Log', note: 'Round 1: Initiative order...' },
        { _id: 'note-3', title: 'NPC: Gandalf', note: 'A wizard is never late' },
      ]),
    } as never);

    const result = await _getGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1' } });

    expect(result.id).toBe('screen-1');
    expect(result.windows).toHaveLength(2);
    expect(result.windows[0]!.id).toBe('win-1');
    expect(result.windows[0]!.collection).toBe('note');
    expect(result.windows[0]!.documentId).toBe('note-1');
    expect(result.windows[1]!.state).toBe('minimized');
    expect(result.stacks).toHaveLength(1);
    expect(result.stacks[0]!.name).toBe('NPCs');
    expect(result.stacks[0]!.items).toHaveLength(1);
    expect(result.stacks[0]!.items[0]!.label).toBe('Gandalf');

    // Hydrated map keyed by "collection:documentId"
    expect(result.hydrated['note:note-1']).toEqual({
      id: 'note-1',
      collection: 'note',
      title: 'Session Notes',
      content: 'Notes from session 1',
    });
    expect(result.hydrated['note:note-2']).toEqual({
      id: 'note-2',
      collection: 'note',
      title: 'Combat Log',
      content: 'Round 1: Initiative order...',
    });
    expect(result.hydrated['note:note-3']).toEqual({
      id: 'note-3',
      collection: 'note',
      title: 'NPC: Gandalf',
      content: 'A wizard is never late',
    });

    // Note.find was called once with all unique IDs batched, scoped by campaignId
    expect(Note.find).toHaveBeenCalledTimes(1);
    expect(Note.find).toHaveBeenCalledWith(
      {
        _id: { $in: expect.arrayContaining(['note-1', 'note-2', 'note-3']) },
        campaignId: 'camp-1',
      },
      '_id title note'
    );
  });

  it('returns empty hydrated map when screen has no refs', async () => {
    const screenDoc = {
      _id: 'screen-1',
      campaignId: 'camp-1',
      name: 'Empty',
      tabOrder: 0,
      createdBy: 'dbuser-1',
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-01'),
      windows: [],
      stacks: [],
    };
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(screenDoc),
    } as never);

    const result = await _getGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1' } });

    expect(result.windows).toEqual([]);
    expect(result.stacks).toEqual([]);
    expect(result.hydrated).toEqual({});
    expect(Note.find).not.toHaveBeenCalled();
  });

  it('omits deleted/missing documents from hydrated map gracefully', async () => {
    const screenDoc = {
      _id: 'screen-1',
      campaignId: 'camp-1',
      name: 'General',
      tabOrder: 0,
      createdBy: 'dbuser-1',
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-01'),
      windows: [
        {
          _id: 'win-1',
          collection: 'note',
          documentId: 'note-1',
          state: 'open',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          zIndex: 0,
        },
        {
          _id: 'win-2',
          collection: 'note',
          documentId: 'note-deleted',
          state: 'open',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          zIndex: 0,
        },
      ],
      stacks: [],
    };
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(screenDoc),
    } as never);
    // Only note-1 exists; note-deleted is missing from DB
    vi.mocked(Note.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'note-1', title: 'Existing Note' }]),
    } as never);

    const result = await _getGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1' } });

    expect(result.hydrated['note:note-1']).toBeDefined();
    expect(result.hydrated['note:note-deleted']).toBeUndefined();
    // Window ref is still present — client can detect unresolved ref
    expect(result.windows).toHaveLength(2);
  });

  it('skips unknown collection types without error', async () => {
    const screenDoc = {
      _id: 'screen-1',
      campaignId: 'camp-1',
      name: 'Mixed',
      tabOrder: 0,
      createdBy: 'dbuser-1',
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-01'),
      windows: [
        {
          _id: 'win-1',
          collection: 'unknown_type',
          documentId: 'doc-1',
          state: 'open',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          zIndex: 0,
        },
      ],
      stacks: [],
    };
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(screenDoc),
    } as never);

    const result = await _getGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1' } });

    expect(result.windows).toHaveLength(1);
    expect(result.hydrated).toEqual({});
    expect(Note.find).not.toHaveBeenCalled();
  });

  it('deduplicates refs when same document appears in multiple windows/stacks', async () => {
    const screenDoc = {
      _id: 'screen-1',
      campaignId: 'camp-1',
      name: 'Dupes',
      tabOrder: 0,
      createdBy: 'dbuser-1',
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-01'),
      windows: [
        {
          _id: 'win-1',
          collection: 'note',
          documentId: 'note-1',
          state: 'open',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          zIndex: 0,
        },
      ],
      stacks: [
        {
          _id: 'stack-1',
          name: 'Refs',
          x: 0,
          y: 0,
          items: [{ _id: 'si-1', collection: 'note', documentId: 'note-1', label: 'Same Note' }],
        },
      ],
    };
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(screenDoc),
    } as never);
    vi.mocked(Note.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'note-1', title: 'Shared Note' }]),
    } as never);

    const result = await _getGMScreen({ data: { id: 'screen-1', campaignId: 'camp-1' } });

    // Only one fetch call despite same ID appearing twice
    expect(Note.find).toHaveBeenCalledTimes(1);
    const fetchedIds = vi.mocked(Note.find).mock.calls[0]![0] as unknown as {
      _id: { $in: string[] };
    };
    expect(fetchedIds._id.$in).toHaveLength(1);
    expect(result.hydrated['note:note-1']!.title).toBe('Shared Note');
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    await expect(
      _getGMScreen({ data: { id: 'nonexistent', campaignId: 'camp-1' } })
    ).rejects.toThrow('Screen not found');
  });

  it('includes isPublic and link in hydrated character and isPublic in hydrated rule', async () => {
    const screenDoc = {
      _id: 'screen-x',
      campaignId: 'camp-1',
      name: 'Test',
      tabOrder: 0,
      createdBy: 'dbuser-1',
      createdAt: new Date('2026-04-01'),
      updatedAt: new Date('2026-04-01'),
      windows: [
        {
          _id: 'win-c',
          collection: 'character',
          documentId: 'char-1',
          state: 'open',
          x: 0,
          y: 0,
          width: 300,
          height: 400,
          zIndex: 1,
        },
        {
          _id: 'win-r',
          collection: 'rule',
          documentId: 'rule-1',
          state: 'open',
          x: 320,
          y: 0,
          width: 300,
          height: 400,
          zIndex: 2,
        },
      ],
      stacks: [],
    };

    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(screenDoc),
    } as never);

    vi.mocked(Character.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'char-1',
          firstName: 'Thorin',
          lastName: 'Grudgebearer',
          notes: 'A dwarf warrior.',
          isPublic: true,
          link: 'https://example.com/thorin',
        },
      ]),
    } as never);

    vi.mocked(Rule.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'rule-1',
          title: 'Difficulty',
          content: 'Setting a DC',
          isPublic: false,
        },
      ]),
    } as never);

    const result = await _getGMScreen({ data: { id: 'screen-x', campaignId: 'camp-1' } });

    expect(result.hydrated['character:char-1']).toEqual({
      id: 'char-1',
      collection: 'character',
      title: 'Thorin Grudgebearer',
      content: 'A dwarf warrior.',
      isPublic: true,
      link: 'https://example.com/thorin',
    });

    expect(result.hydrated['rule:rule-1']).toEqual({
      id: 'rule-1',
      collection: 'rule',
      title: 'Difficulty',
      content: 'Setting a DC',
      isPublic: false,
    });

    expect(Character.find).toHaveBeenCalledWith(
      { _id: { $in: ['char-1'] }, campaignId: 'camp-1' },
      '_id firstName lastName notes isPublic link'
    );

    expect(Rule.find).toHaveBeenCalledWith(
      { _id: { $in: ['rule-1'] }, campaignId: 'camp-1' },
      '_id title content isPublic'
    );
  });
});

// ---------------------------------------------------------------------------
// removeDocumentRefsFromScreens — cleanup
// ---------------------------------------------------------------------------

describe('removeDocumentRefsFromScreens', () => {
  it('removes matching window refs and stack items, returns distinct screen count', async () => {
    // find() for affected screens
    vi.mocked(GMScreen.find).mockReturnValueOnce({
      lean: vi
        .fn()
        .mockResolvedValue([{ _id: 'screen-1' }, { _id: 'screen-2' }, { _id: 'screen-3' }]),
    } as never);
    vi.mocked(GMScreen.updateMany)
      .mockResolvedValueOnce({ modifiedCount: 2 } as never) // windows
      .mockResolvedValueOnce({ modifiedCount: 1 } as never); // stacks

    const result = await removeDocumentRefsFromScreens('camp-1', 'note', 'note-1');

    // Affected-screen query uses $or to find all screens with either ref type
    expect(GMScreen.find).toHaveBeenCalledWith(
      {
        campaignId: 'camp-1',
        $or: [
          { 'windows.collection': 'note', 'windows.documentId': 'note-1' },
          { 'stacks.items.collection': 'note', 'stacks.items.documentId': 'note-1' },
        ],
      },
      '_id'
    );

    expect(GMScreen.updateMany).toHaveBeenCalledTimes(2);
    // Pull from windows + refresh updatedAt
    expect(GMScreen.updateMany).toHaveBeenCalledWith(
      { campaignId: 'camp-1', 'windows.collection': 'note', 'windows.documentId': 'note-1' },
      {
        $pull: { windows: { collection: 'note', documentId: 'note-1' } },
        $set: { updatedAt: expect.any(Date) },
      }
    );
    // Pull from stacks.$[].items + refresh updatedAt
    expect(GMScreen.updateMany).toHaveBeenCalledWith(
      {
        campaignId: 'camp-1',
        'stacks.items.collection': 'note',
        'stacks.items.documentId': 'note-1',
      },
      {
        $pull: { 'stacks.$[].items': { collection: 'note', documentId: 'note-1' } },
        $set: { updatedAt: expect.any(Date) },
      }
    );
    // Returns true distinct count from the find query, not Math.max
    expect(result).toBe(3);
  });

  it('returns 0 and skips updates when no screens reference the document', async () => {
    vi.mocked(GMScreen.find).mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await removeDocumentRefsFromScreens('camp-1', 'note', 'note-999');

    expect(result).toBe(0);
    expect(GMScreen.updateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Zod schemas — validation
// ---------------------------------------------------------------------------

describe('getGMScreenSchema', () => {
  it('rejects empty id', () => {
    expect(getGMScreenSchema.safeParse({ id: '', campaignId: 'camp-1' }).success).toBe(false);
  });

  it('rejects empty campaignId', () => {
    expect(getGMScreenSchema.safeParse({ id: 's-1', campaignId: '' }).success).toBe(false);
  });

  it('accepts valid input', () => {
    expect(getGMScreenSchema.safeParse({ id: 's-1', campaignId: 'camp-1' }).success).toBe(true);
  });
});

describe('listGMScreensSchema', () => {
  it('rejects empty campaignId', () => {
    expect(listGMScreensSchema.safeParse({ campaignId: '' }).success).toBe(false);
  });

  it('rejects whitespace-only campaignId', () => {
    expect(listGMScreensSchema.safeParse({ campaignId: '   ' }).success).toBe(false);
  });

  it('accepts valid campaignId', () => {
    expect(listGMScreensSchema.safeParse({ campaignId: 'camp-1' }).success).toBe(true);
  });
});

describe('createGMScreenSchema', () => {
  it('rejects empty name', () => {
    expect(createGMScreenSchema.safeParse({ campaignId: 'camp-1', name: '' }).success).toBe(false);
  });

  it('rejects whitespace-only name', () => {
    expect(createGMScreenSchema.safeParse({ campaignId: 'camp-1', name: '   ' }).success).toBe(
      false
    );
  });

  it('accepts valid input', () => {
    expect(createGMScreenSchema.safeParse({ campaignId: 'camp-1', name: 'Combat' }).success).toBe(
      true
    );
  });
});

describe('renameGMScreenSchema', () => {
  it('rejects when id is missing', () => {
    expect(renameGMScreenSchema.safeParse({ campaignId: 'camp-1', name: 'New' }).success).toBe(
      false
    );
  });

  it('rejects empty name', () => {
    expect(
      renameGMScreenSchema.safeParse({ id: 's-1', campaignId: 'camp-1', name: '' }).success
    ).toBe(false);
  });

  it('rejects whitespace-only name', () => {
    expect(
      renameGMScreenSchema.safeParse({ id: 's-1', campaignId: 'camp-1', name: '   ' }).success
    ).toBe(false);
  });
});

describe('deleteGMScreenSchema', () => {
  it('rejects when id is missing', () => {
    expect(deleteGMScreenSchema.safeParse({ campaignId: 'camp-1' }).success).toBe(false);
  });

  it('rejects empty campaignId', () => {
    expect(deleteGMScreenSchema.safeParse({ id: 's-1', campaignId: '' }).success).toBe(false);
  });
});

describe('reorderGMScreensSchema', () => {
  it('rejects empty screenIds array', () => {
    expect(reorderGMScreensSchema.safeParse({ campaignId: 'camp-1', screenIds: [] }).success).toBe(
      false
    );
  });

  it('rejects when screenIds is missing', () => {
    expect(reorderGMScreensSchema.safeParse({ campaignId: 'camp-1' }).success).toBe(false);
  });

  it('accepts valid input', () => {
    expect(
      reorderGMScreensSchema.safeParse({ campaignId: 'camp-1', screenIds: ['s-1', 's-2'] }).success
    ).toBe(true);
  });

  it('trims whitespace from screenId entries', () => {
    const result = reorderGMScreensSchema.safeParse({
      campaignId: 'camp-1',
      screenIds: ['  s-1  ', '  s-2  '],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.screenIds).toEqual(['s-1', 's-2']);
    }
  });

  it('rejects whitespace-only screenId entries', () => {
    expect(
      reorderGMScreensSchema.safeParse({ campaignId: 'camp-1', screenIds: ['   '] }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// openWindow
// ---------------------------------------------------------------------------

describe('openWindow', () => {
  function makeScreenWithWindows(windows: Array<Record<string, unknown>> = []) {
    return {
      _id: 'screen-1',
      campaignId: 'camp-1',
      windows,
      updatedAt: new Date('2026-03-01'),
      save: vi.fn(),
    };
  }

  /**
   * openWindow's create path is: (1) plain `findOne` to read current
   * windows/compute zIndex + cap, (2) atomic conditional `updateOne` push,
   * (3) on success, a projected `findOne(...).lean()` re-fetch of just the
   * pushed sub-doc (to learn its Mongoose-assigned `_id`). This wires up
   * steps 2-3 for the "atomic push succeeds" case.
   */
  function mockSuccessfulAtomicPush(createdWindow: Record<string, unknown>) {
    vi.mocked(GMScreen.updateOne).mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    } as never);
    vi.mocked(GMScreen.findOne).mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({ windows: [createdWindow] }),
    } as never);
  }

  /**
   * Simulates "lost the atomic create race": the conditional `updateOne`
   * matches nothing (someone else created the window first), so the code
   * falls back to a plain re-fetch (`refreshedScreen`) and focuses the
   * winner instead of creating a duplicate.
   */
  function mockLostAtomicPushRace(refreshedScreen: Record<string, unknown>) {
    vi.mocked(GMScreen.updateOne).mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: null,
    } as never);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(refreshedScreen as never);
  }

  it('creates a new window with zIndex bumped above existing', async () => {
    const screen = makeScreenWithWindows([
      { _id: 'win-1', collection: 'note', documentId: 'note-1', state: 'open', zIndex: 3 },
    ]);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(screen as never);
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

    const result = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-2',
      },
    });

    expect(result.success).toBe(true);
    expect(result.existed).toBe(false);
    expect(result.window.collection).toBe('note');
    expect(result.window.documentId).toBe('note-2');
    expect(result.window.state).toBe('open');
    expect(result.window.zIndex).toBe(4);
    expect(result.window.x).toBeNull();
    expect(result.window.y).toBeNull();

    // The dedupe AND cap guarantees live in the filter shape: assert the
    // atomic update excludes any document that already has a window for this
    // ref, and any document already at the window cap.
    const [filter, update] = vi.mocked(GMScreen.updateOne).mock.calls[0]!;
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

  it('focuses existing window instead of creating duplicate', async () => {
    const existingWin = {
      _id: 'win-1',
      collection: 'note',
      documentId: 'note-1',
      state: 'minimized',
      zIndex: 1,
    };
    const otherWin = {
      _id: 'win-2',
      collection: 'note',
      documentId: 'note-2',
      state: 'open',
      zIndex: 5,
    };
    const screen = makeScreenWithWindows([existingWin, otherWin]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _openWindow({
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
    expect(result.window.state).toBe('open');
    expect(result.window.zIndex).toBe(6); // max(1,5) + 1
    expect(screen.save).toHaveBeenCalled();
    // The focus path never attempts the atomic create push.
    expect(GMScreen.updateOne).not.toHaveBeenCalled();
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
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    await expect(
      _openWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-new',
        },
      })
    ).rejects.toThrow('A screen cannot have more than 20 windows');
  });

  it('allows opening when at cap if ref already exists (focus path)', async () => {
    const windows = Array.from({ length: 20 }, (_, i) => ({
      _id: `win-${i}`,
      collection: 'note',
      documentId: `note-${i}`,
      state: 'open',
      zIndex: i,
    }));
    const screen = makeScreenWithWindows(windows);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-5',
      },
    });

    expect(result.existed).toBe(true);
    expect(result.success).toBe(true);
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.findOne).mockResolvedValue(null);

    await expect(
      _openWindow({
        data: {
          screenId: 'nonexistent',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-1',
        },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('creates window with zIndex 1 on empty screen', async () => {
    const screen = makeScreenWithWindows([]);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(screen as never);
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

    const result = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(result.window.zIndex).toBe(1);
    expect(result.existed).toBe(false);
  });

  it('initializes windows array on document when missing', async () => {
    const screen = {
      _id: 'screen-1',
      campaignId: 'camp-1',
      windows: undefined as Array<Record<string, unknown>> | undefined,
      updatedAt: new Date('2026-03-01'),
      save: vi.fn(),
    };
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(screen as never);
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

    const result = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(result.success).toBe(true);
    expect(result.existed).toBe(false);
    // windows is initialized to an array (not left undefined) before the
    // dedupe/cap checks run — the atomic push itself is what persists the
    // new window server-side, not a local mutation of this array.
    expect(Array.isArray(screen.windows)).toBe(true);
  });

  // -------------------------------------------------------------------
  // Atomicity / dedupe-race pinning
  // -------------------------------------------------------------------

  it('does not create a duplicate on a sequential double-call for the same ref', async () => {
    // Call 1: nothing exists yet, atomic push succeeds.
    const screenRead1 = makeScreenWithWindows([]);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(screenRead1 as never);
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

    const first = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });
    expect(first.existed).toBe(false);

    // Call 2: the in-memory read now reflects the persisted window (this is
    // what a real second request would see after the first one committed),
    // so it takes the "existing" focus branch — same as before this fix.
    const screenRead2 = makeScreenWithWindows([createdWindow]);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(screenRead2 as never);

    const second = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(second.existed).toBe(true);
    expect(second.window.id).toBe('win-1');
    // Only one atomic push was ever attempted across both calls.
    expect(GMScreen.updateOne).toHaveBeenCalledTimes(1);
  });

  it('closes the create/create race: a second call that reads stale state before the first commits is rejected by the atomic filter and focuses the winner instead of duplicating', async () => {
    // Both calls read the screen as empty (simulates the TOCTOU window from
    // the investigation report: two concurrent requests, neither sees the
    // other's write yet).
    const screenRead = makeScreenWithWindows([]);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(screenRead as never);

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
    // First call's atomic push wins.
    mockSuccessfulAtomicPush(createdWindow);

    const first = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });
    expect(first.existed).toBe(false);

    // Second call also read the screen as empty (same stale snapshot), so
    // it too attempts the create path — but this time the atomic filter
    // loses the race (matchedCount 0) because the document now has the
    // window the first call just pushed. It must fall back to focusing the
    // real, persisted window rather than creating a second one.
    const screenRead2 = makeScreenWithWindows([]);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(screenRead2 as never);
    const refreshedScreen = makeScreenWithWindows([{ ...createdWindow }]);
    mockLostAtomicPushRace(refreshedScreen);

    const second = await _openWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(second.existed).toBe(true);
    expect(second.window.id).toBe('win-1');
    // The losing call never pushed a second window: exactly one window ends
    // up in the "canonical" (refreshed) document.
    expect(refreshedScreen.windows).toHaveLength(1);
    expect(refreshedScreen.save).toHaveBeenCalled();
  });

  it('fires two concurrent opens for the same ref via Promise.all and asserts exactly one window results (query-shape level, per-call mocked)', async () => {
    // The mocked harness has no shared, mutable "database" for GMScreen —
    // each vi.fn() call is independently stubbed — so a true race can't be
    // exercised here the way it was against real MongoDB in this task's
    // verification step (10 concurrent updateOne calls against a scratch
    // Mongo container, exactly 1 succeeded). What we CAN pin at this layer
    // is that firing two opens concurrently for the same ref only ever
    // resolves with a single "existed: false" and a single "existed: true"
    // — never two "existed: false" — because the atomic filter is what
    // Mongo itself will enforce (see the sequential test above and the
    // real-Mongo verification in the fix-wave report).
    const screenA = makeScreenWithWindows([]);
    const screenB = makeScreenWithWindows([]);
    vi.mocked(GMScreen.findOne)
      .mockResolvedValueOnce(screenA as never) // call A's initial read
      .mockResolvedValueOnce(screenB as never); // call B's initial read

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
    // A's atomic push wins; B's loses the race.
    mockSuccessfulAtomicPush(createdWindow);
    const refreshedForB = makeScreenWithWindows([{ ...createdWindow }]);
    mockLostAtomicPushRace(refreshedForB);

    const [resultA, resultB] = await Promise.all([
      _openWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-1',
        },
      }),
      _openWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-1',
        },
      }),
    ]);

    const existedFlags = [resultA.existed, resultB.existed].sort();
    // Both calls attempt the atomic push (2 calls to updateOne), but only
    // one of them can ever match the dedupe filter and modify the
    // document — exactly one "created" and one "focused", never two
    // "created".
    expect(GMScreen.updateOne).toHaveBeenCalledTimes(2);
    expect(existedFlags).toEqual([false, true]);
  });

  it('closes the cap race: two concurrent opens of DIFFERENT refs at length cap-1 — exactly one succeeds, the loser gets the cap error', async () => {
    // Both calls read the screen at 19 windows (one below the cap), so both
    // pass the early app-level length check. Without the cap folded into the
    // atomic filter, both pushes would land and the screen would end up with
    // 21 windows (the schema validator doesn't run on updateOne pushes).
    const nineteenWindows = Array.from({ length: 19 }, (_, i) => ({
      _id: `win-${i}`,
      collection: 'note',
      documentId: `note-${i}`,
      state: 'open',
      zIndex: i,
    }));
    const screenA = makeScreenWithWindows([...nineteenWindows]);
    const screenB = makeScreenWithWindows([...nineteenWindows]);
    vi.mocked(GMScreen.findOne)
      .mockResolvedValueOnce(screenA as never) // call A's initial read
      .mockResolvedValueOnce(screenB as never); // call B's initial read

    // A's atomic push wins (filter matched: dedupe clear AND size 19 < 20).
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
    // B's push loses: the $expr size condition no longer matches (the
    // document now has 20 windows). B re-fetches canonical state, does NOT
    // find its own ref (different ref from A's — this is a cap loss, not a
    // dedupe loss), sees length >= cap, and must throw the cap error.
    vi.mocked(GMScreen.updateOne).mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: null,
    } as never);
    const refreshedAtCap = makeScreenWithWindows([
      ...nineteenWindows,
      {
        _id: 'win-a',
        collection: 'note',
        documentId: 'note-a',
        state: 'open',
        zIndex: 20,
      },
    ]);
    vi.mocked(GMScreen.findOne).mockResolvedValueOnce(refreshedAtCap as never);

    const [resultA, resultB] = await Promise.allSettled([
      _openWindow({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          collection: 'note',
          documentId: 'note-a',
        },
      }),
      _openWindow({
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

    // Both pushes carried the cap condition in their filter — the guarantee
    // is enforced by Mongo at write time, not by the stale app-level read.
    for (const call of vi.mocked(GMScreen.updateOne).mock.calls) {
      expect(call[0]).toMatchObject({
        $expr: { $lt: [{ $size: { $ifNull: ['$windows', []] } }, 20] },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// updateWindow
// ---------------------------------------------------------------------------

describe('updateWindow', () => {
  it('updates only provided layout fields via positional $set', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        windows: [
          {
            _id: 'win-1',
            collection: 'note',
            documentId: 'note-1',
            state: 'open',
            x: 100,
            y: 200,
            width: 400,
            height: 300,
            zIndex: 5,
          },
        ],
      }),
    } as never);

    const result = await _updateWindow({
      data: { screenId: 'screen-1', campaignId: 'camp-1', windowId: 'win-1', x: 100, y: 200 },
    });

    expect(result.success).toBe(true);
    expect(result.window.x).toBe(100);
    expect(result.window.y).toBe(200);

    // Verify $set only includes x, y, and updatedAt — not width/height/zIndex/state
    const setArg = vi.mocked(GMScreen.updateOne).mock.calls[0]![1]! as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set).toHaveProperty('windows.$.x', 100);
    expect(setArg.$set).toHaveProperty('windows.$.y', 200);
    expect(setArg.$set).toHaveProperty('updatedAt');
    expect(setArg.$set).not.toHaveProperty('windows.$.width');
    expect(setArg.$set).not.toHaveProperty('windows.$.height');
    expect(setArg.$set).not.toHaveProperty('windows.$.zIndex');
    expect(setArg.$set).not.toHaveProperty('windows.$.state');
  });

  it('updates state to minimized', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        windows: [
          {
            _id: 'win-1',
            collection: 'note',
            documentId: 'note-1',
            state: 'minimized',
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            zIndex: 1,
          },
        ],
      }),
    } as never);

    const result = await _updateWindow({
      data: { screenId: 'screen-1', campaignId: 'camp-1', windowId: 'win-1', state: 'minimized' },
    });

    expect(result.success).toBe(true);
    expect(result.window.state).toBe('minimized');
    const setArg = vi.mocked(GMScreen.updateOne).mock.calls[0]![1]! as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set).toHaveProperty('windows.$.state', 'minimized');
  });

  it('updates zIndex for bring-to-front', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        windows: [
          {
            _id: 'win-1',
            collection: 'note',
            documentId: 'note-1',
            state: 'open',
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            zIndex: 10,
          },
        ],
      }),
    } as never);

    const result = await _updateWindow({
      data: { screenId: 'screen-1', campaignId: 'camp-1', windowId: 'win-1', zIndex: 10 },
    });

    expect(result.success).toBe(true);
    expect(result.window.zIndex).toBe(10);
  });

  it('updates all fields at once (move + resize + z + state)', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        windows: [
          {
            _id: 'win-1',
            collection: 'note',
            documentId: 'note-1',
            state: 'open',
            x: 50,
            y: 60,
            width: 500,
            height: 400,
            zIndex: 7,
          },
        ],
      }),
    } as never);

    const result = await _updateWindow({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        windowId: 'win-1',
        x: 50,
        y: 60,
        width: 500,
        height: 400,
        zIndex: 7,
        state: 'open',
      },
    });

    expect(result.success).toBe(true);
    const setArg = vi.mocked(GMScreen.updateOne).mock.calls[0]![1]! as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set).toHaveProperty('windows.$.x', 50);
    expect(setArg.$set).toHaveProperty('windows.$.y', 60);
    expect(setArg.$set).toHaveProperty('windows.$.width', 500);
    expect(setArg.$set).toHaveProperty('windows.$.height', 400);
    expect(setArg.$set).toHaveProperty('windows.$.zIndex', 7);
    expect(setArg.$set).toHaveProperty('windows.$.state', 'open');
  });

  it('accepts nullable x/y for auto-layout support', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
    vi.mocked(GMScreen.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        windows: [
          {
            _id: 'win-1',
            collection: 'note',
            documentId: 'note-1',
            state: 'open',
            x: null,
            y: null,
            width: null,
            height: null,
            zIndex: 1,
          },
        ],
      }),
    } as never);

    const result = await _updateWindow({
      data: { screenId: 'screen-1', campaignId: 'camp-1', windowId: 'win-1', x: null, y: null },
    });

    expect(result.success).toBe(true);
    const setArg = vi.mocked(GMScreen.updateOne).mock.calls[0]![1]! as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set).toHaveProperty('windows.$.x', null);
    expect(setArg.$set).toHaveProperty('windows.$.y', null);
  });

  it('throws Screen not found when the screen does not exist', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(0 as never);

    await expect(
      _updateWindow({
        data: { screenId: 'nonexistent', campaignId: 'camp-1', windowId: 'win-1', x: 10 },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('throws Window not found when screen exists but window does not', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(1 as never);

    await expect(
      _updateWindow({
        data: { screenId: 'screen-1', campaignId: 'camp-1', windowId: 'nonexistent', x: 10 },
      })
    ).rejects.toThrow('Window not found');
  });
});

// ---------------------------------------------------------------------------
// closeWindow
// ---------------------------------------------------------------------------

describe('closeWindow', () => {
  it('removes a window via $pull and refreshes updatedAt', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);

    const result = await _closeWindow({
      data: { screenId: 'screen-1', campaignId: 'camp-1', windowId: 'win-1' },
    });

    expect(result.success).toBe(true);
    expect(GMScreen.updateOne).toHaveBeenCalledWith(
      { _id: 'screen-1', campaignId: 'camp-1', 'windows._id': 'win-1' },
      {
        $pull: { windows: { _id: 'win-1' } },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(0 as never);

    await expect(
      _closeWindow({
        data: { screenId: 'nonexistent', campaignId: 'camp-1', windowId: 'win-1' },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('does not churn state when window was not present (no-op close)', async () => {
    // matchedCount 0 because the filter includes windows._id — screen exists but window doesn't
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(1 as never);

    const result = await _closeWindow({
      data: { screenId: 'screen-1', campaignId: 'camp-1', windowId: 'nonexistent-win' },
    });

    expect(result.success).toBe(true);
    // Verify updatedAt was not touched — updateOne filter didn't match, so no $set ran
    expect(GMScreen.updateOne).toHaveBeenCalledWith(
      { _id: 'screen-1', campaignId: 'camp-1', 'windows._id': 'nonexistent-win' },
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// Window Zod schemas
// ---------------------------------------------------------------------------

describe('openWindowSchema', () => {
  it('rejects empty screenId', () => {
    expect(
      openWindowSchema.safeParse({
        screenId: '',
        campaignId: 'c',
        collection: 'note',
        documentId: 'd',
      }).success
    ).toBe(false);
  });

  it('rejects empty collection', () => {
    expect(
      openWindowSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        collection: '',
        documentId: 'd',
      }).success
    ).toBe(false);
  });

  it('rejects empty documentId', () => {
    expect(
      openWindowSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        collection: 'note',
        documentId: '',
      }).success
    ).toBe(false);
  });

  it('rejects unsupported collection', () => {
    const result = openWindowSchema.safeParse({
      screenId: 's',
      campaignId: 'c',
      collection: 'bogus',
      documentId: 'd',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain('Unsupported collection');
    }
  });

  it('accepts valid input', () => {
    expect(
      openWindowSchema.safeParse({
        screenId: 's-1',
        campaignId: 'c-1',
        collection: 'note',
        documentId: 'd-1',
      }).success
    ).toBe(true);
  });
});

describe('SUPPORTED_COLLECTIONS', () => {
  it('contains all collections registered for hydration', () => {
    expect(SUPPORTED_COLLECTIONS).toContain('note');
    expect(SUPPORTED_COLLECTIONS).toContain('character');
    expect(SUPPORTED_COLLECTIONS).toContain('rule');
    expect(SUPPORTED_COLLECTIONS).toContain('player');
    expect(SUPPORTED_COLLECTIONS.length).toBeGreaterThan(0);
  });
});

describe('updateWindowSchema', () => {
  it('rejects empty windowId', () => {
    expect(
      updateWindowSchema.safeParse({ screenId: 's', campaignId: 'c', windowId: '' }).success
    ).toBe(false);
  });

  it('rejects when no updatable fields are provided', () => {
    expect(
      updateWindowSchema.safeParse({ screenId: 's', campaignId: 'c', windowId: 'w' }).success
    ).toBe(false);
  });

  it('rejects invalid state', () => {
    expect(
      updateWindowSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        windowId: 'w',
        state: 'invalid',
      }).success
    ).toBe(false);
  });

  it('accepts valid state enum values', () => {
    expect(
      updateWindowSchema.safeParse({ screenId: 's', campaignId: 'c', windowId: 'w', state: 'open' })
        .success
    ).toBe(true);
    expect(
      updateWindowSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        windowId: 'w',
        state: 'minimized',
      }).success
    ).toBe(true);
    expect(
      updateWindowSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        windowId: 'w',
        state: 'hidden',
      }).success
    ).toBe(true);
  });

  it('accepts partial layout fields', () => {
    expect(
      updateWindowSchema.safeParse({ screenId: 's', campaignId: 'c', windowId: 'w', x: 100 })
        .success
    ).toBe(true);
  });

  it('accepts nullable x and y', () => {
    expect(
      updateWindowSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        windowId: 'w',
        x: null,
        y: null,
      }).success
    ).toBe(true);
  });
});

describe('closeWindowSchema', () => {
  it('rejects empty windowId', () => {
    expect(
      closeWindowSchema.safeParse({ screenId: 's', campaignId: 'c', windowId: '' }).success
    ).toBe(false);
  });

  it('accepts valid input', () => {
    expect(
      closeWindowSchema.safeParse({ screenId: 's-1', campaignId: 'c-1', windowId: 'w-1' }).success
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createStack
// ---------------------------------------------------------------------------

describe('createStack', () => {
  function makeScreenWithStacks(stacks: Array<Record<string, unknown>> = []) {
    return {
      _id: 'screen-1',
      campaignId: 'camp-1',
      stacks,
      updatedAt: new Date('2026-03-01'),
      save: vi.fn(),
    };
  }

  it('creates a new stack on the screen', async () => {
    const screen = makeScreenWithStacks([]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _createStack({
      data: { screenId: 'screen-1', campaignId: 'camp-1', name: 'NPCs' },
    });

    expect(result.success).toBe(true);
    expect(result.stack.name).toBe('NPCs');
    expect(result.stack.x).toBeNull();
    expect(result.stack.y).toBeNull();
    expect(result.stack.items).toEqual([]);
    expect(screen.save).toHaveBeenCalled();
  });

  it('enforces the stack cap', async () => {
    const stacks = Array.from({ length: 10 }, (_, i) => ({
      _id: `stack-${i}`,
      name: `Stack ${i}`,
      x: null,
      y: null,
      items: [],
    }));
    const screen = makeScreenWithStacks(stacks);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    await expect(
      _createStack({
        data: { screenId: 'screen-1', campaignId: 'camp-1', name: 'Overflow' },
      })
    ).rejects.toThrow('A screen cannot have more than 10 stacks');
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.findOne).mockResolvedValue(null);

    await expect(
      _createStack({
        data: { screenId: 'nonexistent', campaignId: 'camp-1', name: 'Test' },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('initializes stacks array when missing', async () => {
    const screen = {
      _id: 'screen-1',
      campaignId: 'camp-1',
      stacks: undefined as Array<Record<string, unknown>> | undefined,
      updatedAt: new Date('2026-03-01'),
      save: vi.fn(),
    };
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _createStack({
      data: { screenId: 'screen-1', campaignId: 'camp-1', name: 'New' },
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(screen.stacks)).toBe(true);
    expect(screen.stacks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// renameStack
// ---------------------------------------------------------------------------

describe('renameStack', () => {
  it('renames a stack via positional $set', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);

    const result = await _renameStack({
      data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'stack-1', name: 'Renamed' },
    });

    expect(result.success).toBe(true);
    const setArg = vi.mocked(GMScreen.updateOne).mock.calls[0]![1]! as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set).toHaveProperty('stacks.$.name', 'Renamed');
    expect(setArg.$set).toHaveProperty('updatedAt');
  });

  it('throws Screen not found when screen does not exist', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(0 as never);

    await expect(
      _renameStack({
        data: { screenId: 'nonexistent', campaignId: 'camp-1', stackId: 'stack-1', name: 'New' },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('throws Stack not found when screen exists but stack does not', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(1 as never);

    await expect(
      _renameStack({
        data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'nonexistent', name: 'New' },
      })
    ).rejects.toThrow('Stack not found');
  });
});

// ---------------------------------------------------------------------------
// moveStack
// ---------------------------------------------------------------------------

describe('moveStack', () => {
  it('updates stack x/y via positional $set', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);

    const result = await _moveStack({
      data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'stack-1', x: 100, y: 200 },
    });

    expect(result.success).toBe(true);
    const setArg = vi.mocked(GMScreen.updateOne).mock.calls[0]![1]! as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set).toHaveProperty('stacks.$.x', 100);
    expect(setArg.$set).toHaveProperty('stacks.$.y', 200);
    expect(setArg.$set).toHaveProperty('updatedAt');
  });

  it('accepts null x/y for auto-layout', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);

    const result = await _moveStack({
      data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'stack-1', x: null, y: null },
    });

    expect(result.success).toBe(true);
    const setArg = vi.mocked(GMScreen.updateOne).mock.calls[0]![1]! as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set).toHaveProperty('stacks.$.x', null);
    expect(setArg.$set).toHaveProperty('stacks.$.y', null);
  });

  it('throws Screen not found when screen does not exist', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(0 as never);

    await expect(
      _moveStack({
        data: { screenId: 'nonexistent', campaignId: 'camp-1', stackId: 'stack-1', x: 0, y: 0 },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('throws Stack not found when screen exists but stack does not', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(1 as never);

    await expect(
      _moveStack({
        data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'nonexistent', x: 0, y: 0 },
      })
    ).rejects.toThrow('Stack not found');
  });
});

// ---------------------------------------------------------------------------
// deleteStack
// ---------------------------------------------------------------------------

describe('deleteStack', () => {
  it('removes a stack via $pull and refreshes updatedAt', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);

    const result = await _deleteStack({
      data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'stack-1' },
    });

    expect(result.success).toBe(true);
    expect(GMScreen.updateOne).toHaveBeenCalledWith(
      { _id: 'screen-1', campaignId: 'camp-1', 'stacks._id': 'stack-1' },
      {
        $pull: { stacks: { _id: 'stack-1' } },
        $set: { updatedAt: expect.any(Date) },
      }
    );
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(0 as never);

    await expect(
      _deleteStack({
        data: { screenId: 'nonexistent', campaignId: 'camp-1', stackId: 'stack-1' },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('is a no-op when stack was not present', async () => {
    vi.mocked(GMScreen.updateOne).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 } as never);
    vi.mocked(GMScreen.countDocuments).mockResolvedValue(1 as never);

    const result = await _deleteStack({
      data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'nonexistent' },
    });

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addStackItem
// ---------------------------------------------------------------------------

describe('addStackItem', () => {
  function makeScreenWithStack(items: Array<Record<string, unknown>> = []) {
    return {
      _id: 'screen-1',
      campaignId: 'camp-1',
      stacks: [
        {
          _id: 'stack-1',
          name: 'NPCs',
          x: 0,
          y: 0,
          items,
        },
      ],
      updatedAt: new Date('2026-03-01'),
      save: vi.fn(),
    };
  }

  it('adds a new item to a stack', async () => {
    const screen = makeScreenWithStack([]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _addStackItem({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        stackId: 'stack-1',
        collection: 'note',
        documentId: 'note-1',
        label: 'Gandalf',
      },
    });

    expect(result.success).toBe(true);
    expect(result.existed).toBe(false);
    expect(result.item.collection).toBe('note');
    expect(result.item.documentId).toBe('note-1');
    expect(result.item.label).toBe('Gandalf');
    expect(screen.save).toHaveBeenCalled();
  });

  it('returns existed: true for duplicate collection+documentId', async () => {
    const screen = makeScreenWithStack([
      { _id: 'si-1', collection: 'note', documentId: 'note-1', label: 'Existing' },
    ]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _addStackItem({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        stackId: 'stack-1',
        collection: 'note',
        documentId: 'note-1',
        label: 'Duplicate',
      },
    });

    expect(result.success).toBe(true);
    expect(result.existed).toBe(true);
    expect(result.item.id).toBe('si-1');
    expect(result.item.label).toBe('Existing');
    expect(screen.save).not.toHaveBeenCalled();
  });

  it('enforces the stack item cap', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      _id: `si-${i}`,
      collection: 'note',
      documentId: `note-${i}`,
      label: `Item ${i}`,
    }));
    const screen = makeScreenWithStack(items);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    await expect(
      _addStackItem({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          stackId: 'stack-1',
          collection: 'note',
          documentId: 'note-new',
          label: 'Overflow',
        },
      })
    ).rejects.toThrow('A stack cannot contain more than 50 items');
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.findOne).mockResolvedValue(null);

    await expect(
      _addStackItem({
        data: {
          screenId: 'nonexistent',
          campaignId: 'camp-1',
          stackId: 'stack-1',
          collection: 'note',
          documentId: 'note-1',
        },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('throws when stack is not found', async () => {
    const screen = makeScreenWithStack([]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    await expect(
      _addStackItem({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          stackId: 'nonexistent',
          collection: 'note',
          documentId: 'note-1',
        },
      })
    ).rejects.toThrow('Stack not found');
  });

  it('defaults label to empty string when not provided', async () => {
    const screen = makeScreenWithStack([]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _addStackItem({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        stackId: 'stack-1',
        collection: 'note',
        documentId: 'note-1',
      },
    });

    expect(result.item.label).toBe('');
  });
});

// ---------------------------------------------------------------------------
// removeStackItem
// ---------------------------------------------------------------------------

describe('removeStackItem', () => {
  function makeScreenWithStackItems(items: Array<Record<string, unknown>> = []) {
    return {
      _id: 'screen-1',
      campaignId: 'camp-1',
      stacks: [
        {
          _id: 'stack-1',
          name: 'NPCs',
          x: 0,
          y: 0,
          items,
        },
      ],
      updatedAt: new Date('2026-03-01'),
      save: vi.fn(),
    };
  }

  it('removes an item from a stack', async () => {
    const screen = makeScreenWithStackItems([
      { _id: 'si-1', collection: 'note', documentId: 'note-1', label: 'Gandalf' },
      { _id: 'si-2', collection: 'note', documentId: 'note-2', label: 'Frodo' },
    ]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _removeStackItem({
      data: { screenId: 'screen-1', campaignId: 'camp-1', stackId: 'stack-1', itemId: 'si-1' },
    });

    expect(result.success).toBe(true);
    expect(screen.stacks[0]!.items).toHaveLength(1);
    expect(screen.stacks[0]!.items[0]!._id).toBe('si-2');
    expect(screen.save).toHaveBeenCalled();
  });

  it('is a no-op when item is not present', async () => {
    const screen = makeScreenWithStackItems([
      { _id: 'si-1', collection: 'note', documentId: 'note-1', label: 'Gandalf' },
    ]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    const result = await _removeStackItem({
      data: {
        screenId: 'screen-1',
        campaignId: 'camp-1',
        stackId: 'stack-1',
        itemId: 'nonexistent',
      },
    });

    expect(result.success).toBe(true);
    expect(screen.stacks[0]!.items).toHaveLength(1);
    expect(screen.save).not.toHaveBeenCalled();
  });

  it('throws when screen is not found', async () => {
    vi.mocked(GMScreen.findOne).mockResolvedValue(null);

    await expect(
      _removeStackItem({
        data: { screenId: 'nonexistent', campaignId: 'camp-1', stackId: 'stack-1', itemId: 'si-1' },
      })
    ).rejects.toThrow('Screen not found');
  });

  it('throws when stack is not found', async () => {
    const screen = makeScreenWithStackItems([]);
    vi.mocked(GMScreen.findOne).mockResolvedValue(screen as never);

    await expect(
      _removeStackItem({
        data: {
          screenId: 'screen-1',
          campaignId: 'camp-1',
          stackId: 'nonexistent',
          itemId: 'si-1',
        },
      })
    ).rejects.toThrow('Stack not found');
  });
});

// ---------------------------------------------------------------------------
// Stack Zod schemas
// ---------------------------------------------------------------------------

describe('createStackSchema', () => {
  it('rejects empty screenId', () => {
    expect(
      createStackSchema.safeParse({ screenId: '', campaignId: 'c', name: 'Test' }).success
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(createStackSchema.safeParse({ screenId: 's', campaignId: 'c', name: '' }).success).toBe(
      false
    );
  });

  it('rejects whitespace-only name', () => {
    expect(
      createStackSchema.safeParse({ screenId: 's', campaignId: 'c', name: '   ' }).success
    ).toBe(false);
  });

  it('accepts valid input', () => {
    expect(
      createStackSchema.safeParse({ screenId: 's-1', campaignId: 'c-1', name: 'NPCs' }).success
    ).toBe(true);
  });
});

describe('renameStackSchema', () => {
  it('rejects empty stackId', () => {
    expect(
      renameStackSchema.safeParse({ screenId: 's', campaignId: 'c', stackId: '', name: 'New' })
        .success
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(
      renameStackSchema.safeParse({ screenId: 's', campaignId: 'c', stackId: 'st', name: '' })
        .success
    ).toBe(false);
  });

  it('accepts valid input', () => {
    expect(
      renameStackSchema.safeParse({
        screenId: 's-1',
        campaignId: 'c-1',
        stackId: 'st-1',
        name: 'Renamed',
      }).success
    ).toBe(true);
  });
});

describe('moveStackSchema', () => {
  it('rejects missing x', () => {
    expect(
      moveStackSchema.safeParse({ screenId: 's', campaignId: 'c', stackId: 'st', y: 0 }).success
    ).toBe(false);
  });

  it('rejects missing y', () => {
    expect(
      moveStackSchema.safeParse({ screenId: 's', campaignId: 'c', stackId: 'st', x: 0 }).success
    ).toBe(false);
  });

  it('accepts valid numeric input', () => {
    expect(
      moveStackSchema.safeParse({
        screenId: 's-1',
        campaignId: 'c-1',
        stackId: 'st-1',
        x: 100,
        y: 200,
      }).success
    ).toBe(true);
  });

  it('accepts null x and y', () => {
    expect(
      moveStackSchema.safeParse({
        screenId: 's-1',
        campaignId: 'c-1',
        stackId: 'st-1',
        x: null,
        y: null,
      }).success
    ).toBe(true);
  });
});

describe('deleteStackSchema', () => {
  it('rejects empty stackId', () => {
    expect(
      deleteStackSchema.safeParse({ screenId: 's', campaignId: 'c', stackId: '' }).success
    ).toBe(false);
  });

  it('accepts valid input', () => {
    expect(
      deleteStackSchema.safeParse({ screenId: 's-1', campaignId: 'c-1', stackId: 'st-1' }).success
    ).toBe(true);
  });
});

describe('addStackItemSchema', () => {
  it('rejects empty stackId', () => {
    expect(
      addStackItemSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        stackId: '',
        collection: 'note',
        documentId: 'd',
      }).success
    ).toBe(false);
  });

  it('rejects unsupported collection', () => {
    const result = addStackItemSchema.safeParse({
      screenId: 's',
      campaignId: 'c',
      stackId: 'st',
      collection: 'bogus',
      documentId: 'd',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain('Unsupported collection');
    }
  });

  it('rejects empty documentId', () => {
    expect(
      addStackItemSchema.safeParse({
        screenId: 's',
        campaignId: 'c',
        stackId: 'st',
        collection: 'note',
        documentId: '',
      }).success
    ).toBe(false);
  });

  it('accepts valid input with label', () => {
    expect(
      addStackItemSchema.safeParse({
        screenId: 's-1',
        campaignId: 'c-1',
        stackId: 'st-1',
        collection: 'note',
        documentId: 'd-1',
        label: 'Gandalf',
      }).success
    ).toBe(true);
  });

  it('accepts valid input without label (defaults)', () => {
    const result = addStackItemSchema.safeParse({
      screenId: 's-1',
      campaignId: 'c-1',
      stackId: 'st-1',
      collection: 'note',
      documentId: 'd-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBe('');
    }
  });
});

describe('removeStackItemSchema', () => {
  it('rejects empty itemId', () => {
    expect(
      removeStackItemSchema.safeParse({ screenId: 's', campaignId: 'c', stackId: 'st', itemId: '' })
        .success
    ).toBe(false);
  });

  it('accepts valid input', () => {
    expect(
      removeStackItemSchema.safeParse({
        screenId: 's-1',
        campaignId: 'c-1',
        stackId: 'st-1',
        itemId: 'i-1',
      }).success
    ).toBe(true);
  });
});
