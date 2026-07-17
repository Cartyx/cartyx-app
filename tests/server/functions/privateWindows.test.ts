import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock scaffolding mirrors tests/server/functions/tabletop.test.ts — this repo
// mocks mongoose per-model rather than running an in-memory Mongo.
//
// `~/server/utils/telemetry` is mocked here (tabletop.test.ts leaves it as a
// real no-op) because the "does not broadcast" test asserts on `fetch`, and
// the real telemetry helpers POST to Umami via `fetch`. Mocking it keeps that
// assertion unambiguous.
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

vi.mock('~/server/session', () => ({
  getSession: vi.fn(),
  createPartyBroadcastToken: vi.fn(),
}));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
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
vi.mock('mongoose', () => ({
  default: { startSession: vi.fn() },
}));

import { getSession, createPartyBroadcastToken } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { TabletopPlayerState } from '~/server/db/models/TabletopPlayerState';
import {
  addPrivateWindow,
  removePrivateWindow,
  MAX_PRIVATE_WINDOWS,
} from '~/server/functions/tabletop';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The authenticated caller: a plain PLAYER, deliberately not the GM. */
const CALLER_DB_ID = 'dbuser-player-1';
const OTHER_DB_ID = 'dbuser-victim-2';

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'Player One',
  email: 'player@example.com',
  avatar: null,
  role: 'player',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};

const mockDbUser = { _id: CALLER_DB_ID, firstName: 'Player', lastName: 'One' };

/** Caller is a member with role 'player'; someone else is the GM. */
const mockCampaign = {
  _id: 'camp-1',
  gameMasterId: 'dbuser-gm-9',
  members: [
    { userId: 'dbuser-gm-9', role: 'gm' },
    { userId: CALLER_DB_ID, role: 'player' },
    { userId: OTHER_DB_ID, role: 'player' },
  ],
};

type Lean<T> = { lean: () => Promise<T> };
function leanResult<T>(value: T): Lean<T> {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function makePrivateWindow(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'pw-1',
    surface: 'tabletop',
    screenId: 'screen-1',
    collection: 'character',
    documentId: 'char-1',
    x: 0,
    y: 0,
    width: null,
    height: null,
    zIndex: 0,
    state: 'open',
    ...overrides,
  };
}

function makeStateDoc(privateWindows: Array<Record<string, unknown>> = []) {
  return {
    _id: 'state-1',
    campaignId: 'camp-1',
    userId: CALLER_DB_ID,
    activeScreenId: null,
    activeGMScreenId: null,
    viewports: [],
    windowOverrides: [],
    privateWindows,
  };
}

const validAddPayload = {
  campaignId: 'camp-1',
  surface: 'tabletop' as const,
  screenId: 'screen-1',
  collection: 'character' as const,
  documentId: 'char-1',
};

// The real server fn is wrapped by createServerFn (mocked to identity above),
// so the export is the bare handler.
const _addPrivateWindow = addPrivateWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ id: string; privateWindows: Array<{ id: string }> }>;
const _removePrivateWindow = removePrivateWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ id: string; privateWindows: Array<{ id: string }> }>;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign as never);
  vi.mocked(TabletopPlayerState.updateOne).mockResolvedValue({
    acknowledged: true,
    matchedCount: 1,
    modifiedCount: 1,
    upsertedCount: 0,
    upsertedId: null,
  } as never);
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// addPrivateWindow
// ---------------------------------------------------------------------------

describe('addPrivateWindow', () => {
  it('allows a non-GM member', async () => {
    // Arrange: session user is a plain member (role: 'player') of the campaign.
    vi.mocked(TabletopPlayerState.findOne)
      .mockReturnValueOnce(leanResult(null) as never) // cap read: no doc yet
      .mockReturnValueOnce(leanResult(makeStateDoc([makePrivateWindow()])) as never); // read-back

    // Act
    const result = await _addPrivateWindow({ data: { ...validAddPayload } });

    // Assert: resolved (did NOT throw Forbidden) and returned serialized state.
    expect(vi.mocked(Campaign.findById)).toHaveBeenCalledWith('camp-1');
    expect(result.privateWindows).toHaveLength(1);
    expect(result.privateWindows[0]).toMatchObject({
      id: 'pw-1',
      surface: 'tabletop',
      screenId: 'screen-1',
      collection: 'character',
      documentId: 'char-1',
      state: 'open',
    });
    expect(TabletopPlayerState.updateOne).toHaveBeenCalledTimes(1);
  });

  it("writes only to the calling user's own document", async () => {
    // Arrange: the payload carries a hostile `userId` (and `_id`) trying to
    // redirect the write at another member's player-state document. The fn
    // must ignore the payload entirely and use the authenticated userId.
    vi.mocked(TabletopPlayerState.findOne)
      .mockReturnValueOnce(leanResult(null) as never)
      .mockReturnValueOnce(leanResult(makeStateDoc([makePrivateWindow()])) as never);

    // Act
    await _addPrivateWindow({
      data: {
        ...validAddPayload,
        userId: OTHER_DB_ID,
        _id: 'state-victim',
      },
    });

    // Assert: EVERY filter is scoped by campaignId AND the authenticated userId.
    const [updateFilter, update] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    expect(updateFilter).toEqual({ campaignId: 'camp-1', userId: CALLER_DB_ID });
    expect(updateFilter).not.toMatchObject({ userId: OTHER_DB_ID });

    for (const call of vi.mocked(TabletopPlayerState.findOne).mock.calls) {
      expect(call[0]).toMatchObject({ campaignId: 'camp-1', userId: CALLER_DB_ID });
    }

    // The upsert branch must not be able to mint a doc for another user either.
    expect(update).toMatchObject({
      $setOnInsert: { campaignId: 'camp-1', userId: CALLER_DB_ID },
    });
    expect(JSON.stringify(update)).not.toContain(OTHER_DB_ID);
  });

  it('rejects past MAX_PRIVATE_WINDOWS for that surface+screen', async () => {
    // Arrange: the caller's doc is already at the cap for tabletop/screen-1.
    const atCap = Array.from({ length: MAX_PRIVATE_WINDOWS }, (_, i) =>
      makePrivateWindow({ _id: `pw-${i}`, documentId: `char-${i}` })
    );
    vi.mocked(TabletopPlayerState.findOne).mockReturnValueOnce(
      leanResult(makeStateDoc(atCap)) as never
    );

    // Act + Assert
    await expect(
      _addPrivateWindow({ data: { ...validAddPayload, documentId: 'char-new' } })
    ).rejects.toThrow(/limit/i);

    // ...and no write was issued.
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('counts the cap per surface+screen, not across the whole document', async () => {
    // Arrange: MAX windows exist, but all on a DIFFERENT screen. The new one
    // targets screen-2 and must be allowed.
    const otherScreen = Array.from({ length: MAX_PRIVATE_WINDOWS }, (_, i) =>
      makePrivateWindow({ _id: `pw-${i}`, screenId: 'screen-1', documentId: `char-${i}` })
    );
    vi.mocked(TabletopPlayerState.findOne)
      .mockReturnValueOnce(leanResult(makeStateDoc(otherScreen)) as never)
      .mockReturnValueOnce(
        leanResult(
          makeStateDoc([...otherScreen, makePrivateWindow({ screenId: 'screen-2' })])
        ) as never
      );

    // Act + Assert
    await expect(
      _addPrivateWindow({ data: { ...validAddPayload, screenId: 'screen-2' } })
    ).resolves.toBeDefined();
    expect(TabletopPlayerState.updateOne).toHaveBeenCalledTimes(1);
  });

  it('does not broadcast', async () => {
    // Arrange
    vi.mocked(TabletopPlayerState.findOne)
      .mockReturnValueOnce(leanResult(null) as never)
      .mockReturnValueOnce(leanResult(makeStateDoc([makePrivateWindow()])) as never);

    // Act
    await _addPrivateWindow({ data: { ...validAddPayload } });

    // Assert: private windows are never relayed. The only realtime path out of
    // the server functions is an authenticated HTTP POST to the party host, so
    // neither the token minter nor `fetch` may be touched.
    expect(createPartyBroadcastToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removePrivateWindow
// ---------------------------------------------------------------------------

describe('removePrivateWindow', () => {
  it("pulls only the matching id from the caller's own document", async () => {
    // Arrange
    vi.mocked(TabletopPlayerState.findOne).mockReturnValueOnce(
      leanResult(makeStateDoc([])) as never
    );

    // Act: again with a hostile userId in the payload.
    const result = await _removePrivateWindow({
      data: { campaignId: 'camp-1', privateWindowId: 'pw-1', userId: OTHER_DB_ID },
    });

    // Assert: $pull is scoped by campaignId + authenticated userId + the id.
    const [filter, update] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    expect(filter).toEqual({ campaignId: 'camp-1', userId: CALLER_DB_ID });
    expect(update).toEqual({ $pull: { privateWindows: { _id: 'pw-1' } } });
    expect(JSON.stringify(filter)).not.toContain(OTHER_DB_ID);

    expect(vi.mocked(TabletopPlayerState.findOne).mock.calls[0]![0]).toMatchObject({
      campaignId: 'camp-1',
      userId: CALLER_DB_ID,
    });
    expect(result.privateWindows).toEqual([]);
  });

  it('allows a non-GM member and does not broadcast', async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValueOnce(
      leanResult(makeStateDoc([])) as never
    );

    await expect(
      _removePrivateWindow({ data: { campaignId: 'camp-1', privateWindowId: 'pw-1' } })
    ).resolves.toBeDefined();

    expect(createPartyBroadcastToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-member', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: 'camp-1',
      gameMasterId: 'dbuser-gm-9',
      members: [{ userId: 'dbuser-gm-9', role: 'gm' }],
    } as never);

    await expect(
      _removePrivateWindow({ data: { campaignId: 'camp-1', privateWindowId: 'pw-1' } })
    ).rejects.toThrow('Forbidden');
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });
});
