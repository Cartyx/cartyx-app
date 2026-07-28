import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock scaffolding mirrors tests/server/functions/tabletop.test.ts — this repo
// mocks mongoose per-model rather than running an in-memory Mongo.
//
// `~/server/utils/telemetry` is mocked here (tabletop.test.ts leaves it as a
// real no-op) because the "does not broadcast" test asserts on `fetch`, and
// the real telemetry helpers POST to Umami via `fetch`. Mocking it keeps that
// assertion unambiguous.
//
// `mongoose.Types` is the REAL implementation: addPrivateWindow validates
// screen ids with ObjectId.isValid and builds an ObjectId for the $expr cap
// filter (which mongoose does not cast). A stubbed ObjectId would make those
// tests assert against the stub instead of the behaviour, so every id fixture
// below is a genuine 24-hex ObjectId.
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
vi.mock('~/server/db/models/GMScreen', () => ({
  GMScreen: { findOne: vi.fn() },
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
vi.mock('~/server/db/models/Lore', () => ({ Lore: { find: vi.fn() } }));
vi.mock('mongoose', async () => {
  const actual = await vi.importActual<typeof import('mongoose')>('mongoose');
  return { default: { startSession: vi.fn(), Types: actual.Types } };
});

import mongoose from 'mongoose';
import { getSession, createPartyBroadcastToken } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { TabletopScreen } from '~/server/db/models/TabletopScreen';
import { GMScreen } from '~/server/db/models/GMScreen';
import { TabletopPlayerState } from '~/server/db/models/TabletopPlayerState';
import { Character } from '~/server/db/models/Character';
import { Rule } from '~/server/db/models/Rule';
import { Lore } from '~/server/db/models/Lore';
import {
  addPrivateWindow,
  removePrivateWindow,
  updatePrivateWindow,
  MAX_PRIVATE_WINDOWS,
} from '~/server/functions/tabletop';

// ---------------------------------------------------------------------------
// Fixtures — real ObjectIds, because the implementation validates them.
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = '65a0000000000000000000c1';
/** The authenticated caller: a plain PLAYER, deliberately not the GM. */
const CALLER_DB_ID = '65a0000000000000000000a1';
const OTHER_DB_ID = '65a0000000000000000000a2';
const GM_DB_ID = '65a0000000000000000000a9';
const SCREEN_ID = '65a0000000000000000000e1';
const SCREEN_2_ID = '65a0000000000000000000e2';
const CHAR_ID = '65a0000000000000000000f1';
const LORE_ID = '65a0000000000000000000f2';
const RULE_ID = '65a0000000000000000000f3';
const PW_ID = '65a0000000000000000000d1';

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
  _id: CAMPAIGN_ID,
  gameMasterId: GM_DB_ID,
  members: [
    { userId: GM_DB_ID, role: 'gm' },
    { userId: CALLER_DB_ID, role: 'player' },
    { userId: OTHER_DB_ID, role: 'player' },
  ],
};

/** Re-point the campaign so the authenticated caller IS the GM. */
function callerIsGM() {
  vi.mocked(Campaign.findById).mockResolvedValue({
    ...mockCampaign,
    gameMasterId: CALLER_DB_ID,
    members: [{ userId: CALLER_DB_ID, role: 'gm' }],
  } as never);
}

type Lean<T> = { lean: () => Promise<T> };
function leanResult<T>(value: T): Lean<T> {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function makePrivateWindow(overrides: Record<string, unknown> = {}) {
  return {
    _id: PW_ID,
    surface: 'tabletop',
    screenId: SCREEN_ID,
    collection: 'character',
    documentId: CHAR_ID,
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
    campaignId: CAMPAIGN_ID,
    userId: CALLER_DB_ID,
    activeScreenId: null,
    activeGMScreenId: null,
    viewports: [],
    windowOverrides: [],
    privateWindows,
  };
}

const validAddPayload = {
  campaignId: CAMPAIGN_ID,
  surface: 'tabletop' as const,
  screenId: SCREEN_ID,
  collection: 'character' as const,
  documentId: CHAR_ID,
};

// The real server fn is wrapped by createServerFn (mocked to identity above),
// so the export is the bare handler.
const _addPrivateWindow = addPrivateWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ id: string; privateWindows: Array<{ id: string }> }>;
const _removePrivateWindow = removePrivateWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ id: string; privateWindows: Array<{ id: string }> }>;
const _updatePrivateWindow = updatePrivateWindow as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ id: string; privateWindows: Array<{ id: string }> }>;

let fetchSpy: ReturnType<typeof vi.fn>;

/** `updateOne` result standing for "the guarded push landed". */
const PUSH_APPLIED = {
  acknowledged: true,
  matchedCount: 1,
  modifiedCount: 1,
  upsertedCount: 0,
  upsertedId: null,
};
/** ...and for "the $nor/$expr guard rejected it" (duplicate, or at cap). */
const PUSH_REJECTED = { ...PUSH_APPLIED, matchedCount: 0, modifiedCount: 0 };

/** The two updateOne calls addPrivateWindow makes: [ensure-exists, guarded push]. */
function pushCall() {
  return vi.mocked(TabletopPlayerState.updateOne).mock.calls[1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser as never);
  vi.mocked(Campaign.findById).mockResolvedValue(mockCampaign as never);
  vi.mocked(TabletopPlayerState.updateOne).mockResolvedValue(PUSH_APPLIED as never);

  // Screens exist by default.
  vi.mocked(TabletopScreen.findOne).mockReturnValue(leanResult({ _id: SCREEN_ID }) as never);
  vi.mocked(GMScreen.findOne).mockReturnValue(leanResult({ _id: SCREEN_ID }) as never);

  // The default target document (a PUBLIC character) hydrates for anyone.
  vi.mocked(Character.find).mockReturnValue(
    leanResult([
      {
        _id: CHAR_ID,
        firstName: 'Vex',
        lastName: 'Ravenlight',
        isPublic: true,
        createdBy: GM_DB_ID,
      },
    ]) as never
  );
  vi.mocked(Lore.find).mockReturnValue(leanResult([]) as never);
  vi.mocked(Rule.find).mockReturnValue(leanResult([]) as never);

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
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    const result = await _addPrivateWindow({ data: { ...validAddPayload } });

    expect(vi.mocked(Campaign.findById)).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(result.privateWindows).toHaveLength(1);
    expect(result.privateWindows[0]).toMatchObject({
      id: PW_ID,
      surface: 'tabletop',
      screenId: SCREEN_ID,
      collection: 'character',
      documentId: CHAR_ID,
      state: 'open',
    });
  });

  it("writes only to the calling user's own document", async () => {
    // The payload carries a hostile `userId` (and `_id`) trying to redirect the
    // write at another member's player-state document. The fn must ignore the
    // payload entirely and use the authenticated userId.
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _addPrivateWindow({
      data: { ...validAddPayload, userId: OTHER_DB_ID, _id: 'state-victim' },
    });

    // EVERY filter is scoped by campaignId AND the authenticated userId.
    for (const [filter, update] of vi.mocked(TabletopPlayerState.updateOne).mock.calls) {
      expect(filter).toMatchObject({ campaignId: CAMPAIGN_ID, userId: CALLER_DB_ID });
      expect(JSON.stringify(filter)).not.toContain(OTHER_DB_ID);
      expect(JSON.stringify(update)).not.toContain(OTHER_DB_ID);
    }
    for (const call of vi.mocked(TabletopPlayerState.findOne).mock.calls) {
      expect(call[0]).toMatchObject({ campaignId: CAMPAIGN_ID, userId: CALLER_DB_ID });
    }

    // The upsert branch must not be able to mint a doc for another user either.
    const [, ensureUpdate] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    expect(ensureUpdate).toMatchObject({
      $setOnInsert: { campaignId: CAMPAIGN_ID, userId: CALLER_DB_ID },
    });
  });

  it('caps and dedups atomically in the write filter, not from a stale read', async () => {
    // The regression this guards: a read-then-push cannot enforce either rule,
    // because two concurrent calls both read the array before either write
    // lands. Both guards must therefore ride on the update filter itself, where
    // Mongo re-evaluates them against the current document.
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _addPrivateWindow({ data: { ...validAddPayload } });

    const [filter] = pushCall();
    const f = filter as unknown as Record<string, unknown>;

    // $nor rejects a second window for this exact ref (dedup).
    expect(f.$nor).toEqual([
      {
        privateWindows: {
          $elemMatch: {
            surface: 'tabletop',
            screenId: SCREEN_ID,
            collection: 'character',
            documentId: CHAR_ID,
          },
        },
      },
    ]);

    // $expr counts only THIS surface+screen and rejects at the cap. The screen
    // id must be a real ObjectId: $expr is not cast by mongoose, so a string
    // would silently never match and the cap would count zero.
    const expr = f.$expr as { $lt: [{ $size: { $filter: { cond: unknown } } }, number] };
    expect(expr.$lt[1]).toBe(MAX_PRIVATE_WINDOWS);
    const cond = expr.$lt[0].$size.$filter.cond as { $and: Array<Record<string, unknown[]>> };
    expect(cond.$and[0]).toEqual({ $eq: ['$$this.surface', 'tabletop'] });
    const screenEq = cond.$and[1]!.$eq as unknown[];
    expect(screenEq[1]).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(screenEq[1])).toBe(SCREEN_ID);
  });

  it('scopes the cap filter to the screen being targeted, not the whole document', async () => {
    // The cap is per surface+screen: windows on screen 1 must not count against
    // screen 2. With the count living in the update filter, that scoping is the
    // $filter cond — so assert it tracks the REQUESTED screen.
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow({ screenId: SCREEN_2_ID })])) as never
    );
    vi.mocked(TabletopScreen.findOne).mockReturnValue(leanResult({ _id: SCREEN_2_ID }) as never);

    await _addPrivateWindow({ data: { ...validAddPayload, screenId: SCREEN_2_ID } });

    const [filter] = pushCall();
    const expr = (filter as unknown as Record<string, unknown>).$expr as {
      $lt: [{ $size: { $filter: { cond: { $and: Array<Record<string, unknown[]>> } } } }, number];
    };
    const screenEq = expr.$lt[0].$size.$filter.cond.$and[1]!.$eq as unknown[];
    expect(String(screenEq[1])).toBe(SCREEN_2_ID);
  });

  it('does not upsert on the guarded push (it would trip the unique index)', async () => {
    // The {campaignId, userId} index is unique. A guarded filter plus upsert
    // would try to INSERT whenever the guard rejects — a duplicate-key error
    // instead of a clean dedup — so existence is ensured by a separate,
    // unguarded upsert first.
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _addPrivateWindow({ data: { ...validAddPayload } });

    const [ensureFilter, , ensureOpts] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    expect(ensureFilter).toEqual({ campaignId: CAMPAIGN_ID, userId: CALLER_DB_ID });
    expect(ensureOpts).toMatchObject({ upsert: true });

    const [, , pushOpts] = pushCall();
    expect(pushOpts?.upsert).toBeUndefined();
  });

  it('reports the cap when the guard rejects and the ref is NOT already open', async () => {
    vi.mocked(TabletopPlayerState.updateOne)
      .mockResolvedValueOnce(PUSH_APPLIED as never) // ensure-exists
      .mockResolvedValueOnce(PUSH_REJECTED as never); // guarded push loses
    // Read-back shows the screen full of OTHER refs — so the loss was the cap.
    const atCap = Array.from({ length: MAX_PRIVATE_WINDOWS }, (_, i) =>
      makePrivateWindow({
        _id: `${PW_ID.slice(0, -2)}${String(i).padStart(2, '0')}`,
        documentId: `${LORE_ID.slice(0, -2)}${String(i).padStart(2, '0')}`,
      })
    );
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc(atCap)) as never
    );

    await expect(_addPrivateWindow({ data: { ...validAddPayload } })).rejects.toThrow(/limit/i);
  });

  it('is idempotent when the guard rejects because the ref is already open', async () => {
    // The double-click case: the first call landed, the second loses the $nor
    // guard. That is a success from the caller's point of view — one window.
    vi.mocked(TabletopPlayerState.updateOne)
      .mockResolvedValueOnce(PUSH_APPLIED as never)
      .mockResolvedValueOnce(PUSH_REJECTED as never);
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    const result = await _addPrivateWindow({ data: { ...validAddPayload } });

    expect(result.privateWindows).toHaveLength(1);
    expect(result.privateWindows[0]).toMatchObject({ id: PW_ID });
  });

  it('does not broadcast', async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _addPrivateWindow({ data: { ...validAddPayload } });

    // Private windows are never relayed. The only realtime path out of the
    // server functions is an authenticated HTTP POST to the party host, so
    // neither the token minter nor `fetch` may be touched.
    expect(createPartyBroadcastToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Screen validation
  // -------------------------------------------------------------------------

  it('rejects a screen id that does not exist in this campaign', async () => {
    // Without this the per-surface+screen cap is meaningless: a caller could
    // park MAX_PRIVATE_WINDOWS rows against each of unlimited invented screen
    // ids and grow their own document without bound.
    vi.mocked(TabletopScreen.findOne).mockReturnValue(leanResult(null) as never);

    await expect(_addPrivateWindow({ data: { ...validAddPayload } })).rejects.toThrow(
      'Screen not found'
    );
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a malformed screen id without a CastError', async () => {
    await expect(
      _addPrivateWindow({ data: { ...validAddPayload, screenId: 'not-an-objectid' } })
    ).rejects.toThrow('Screen not found');
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('checks a gmscreen surface against GMScreen, not TabletopScreen', async () => {
    vi.mocked(GMScreen.findOne).mockReturnValue(leanResult(null) as never);

    await expect(
      _addPrivateWindow({ data: { ...validAddPayload, surface: 'gmscreen' } })
    ).rejects.toThrow('Screen not found');
    expect(GMScreen.findOne).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Document-level authorization — the write side must reject exactly what
  // getPlayerState's hydration would filter back out, or the caller ends up
  // with rows they can neither see nor delete.
  // -------------------------------------------------------------------------

  it("allows a player's OWN non-public document (the creator exception)", async () => {
    // listLore shows a player their own private lore, and getLore returns it to
    // the creator — so a window on it must be accepted AND hydrate. Filtering
    // on isPublic alone would be stricter than the getters and would make the
    // card's menu action silently do nothing.
    vi.mocked(Lore.find).mockReturnValue(
      leanResult([
        {
          _id: LORE_ID,
          title: 'My secret',
          content: '...',
          isPublic: false,
          createdBy: CALLER_DB_ID,
        },
      ]) as never
    );
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(
        makeStateDoc([makePrivateWindow({ collection: 'lore', documentId: LORE_ID })])
      ) as never
    );

    await expect(
      _addPrivateWindow({
        data: { ...validAddPayload, collection: 'lore', documentId: LORE_ID },
      })
    ).resolves.toBeDefined();
  });

  it('rejects a non-public document created by SOMEONE ELSE', async () => {
    vi.mocked(Lore.find).mockReturnValue(
      leanResult([
        { _id: LORE_ID, title: 'GM plot', content: 'secret', isPublic: false, createdBy: GM_DB_ID },
      ]) as never
    );

    await expect(
      _addPrivateWindow({
        data: { ...validAddPayload, collection: 'lore', documentId: LORE_ID },
      })
    ).rejects.toThrow(/not authorized/i);
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('grants NO creator exception for rules (listRules/getRule give none)', async () => {
    vi.mocked(Rule.find).mockReturnValue(
      leanResult([
        {
          _id: RULE_ID,
          title: 'House rule',
          content: '...',
          isPublic: false,
          createdBy: CALLER_DB_ID,
        },
      ]) as never
    );

    await expect(
      _addPrivateWindow({
        data: { ...validAddPayload, collection: 'rule', documentId: RULE_ID },
      })
    ).rejects.toThrow(/not authorized/i);
  });

  it('rejects a document that does not exist in this campaign', async () => {
    vi.mocked(Character.find).mockReturnValue(leanResult([]) as never);

    await expect(_addPrivateWindow({ data: { ...validAddPayload } })).rejects.toThrow(
      /not authorized/i
    );
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('lets a GM open a non-public document they did not create', async () => {
    callerIsGM();
    vi.mocked(Lore.find).mockReturnValue(
      leanResult([
        {
          _id: LORE_ID,
          title: 'GM plot',
          content: 'secret',
          isPublic: false,
          createdBy: OTHER_DB_ID,
        },
      ]) as never
    );
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(
        makeStateDoc([makePrivateWindow({ collection: 'lore', documentId: LORE_ID })])
      ) as never
    );

    await expect(
      _addPrivateWindow({
        data: { ...validAddPayload, collection: 'lore', documentId: LORE_ID },
      })
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updatePrivateWindow — layout only, on the caller's own document
// ---------------------------------------------------------------------------

describe('updatePrivateWindow', () => {
  it("sets layout fields positionally on the caller's own window", async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _updatePrivateWindow({
      data: {
        campaignId: CAMPAIGN_ID,
        privateWindowId: PW_ID,
        x: 120,
        y: 240,
        width: 400,
        height: 300,
        zIndex: 3,
        state: 'minimized',
      },
    });

    const [filter, update] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    // The positional `$` only resolves against an element matched by the
    // filter — and the filter is scoped by the AUTHENTICATED userId.
    expect(filter).toEqual({
      campaignId: CAMPAIGN_ID,
      userId: CALLER_DB_ID,
      'privateWindows._id': PW_ID,
    });
    expect(update).toEqual({
      $set: {
        'privateWindows.$.x': 120,
        'privateWindows.$.y': 240,
        'privateWindows.$.width': 400,
        'privateWindows.$.height': 300,
        'privateWindows.$.zIndex': 3,
        'privateWindows.$.state': 'minimized',
      },
    });
  });

  it('cannot re-point a window at another document', async () => {
    // The schema carries no collection/documentId/screenId, so a "move" can
    // never smuggle in a document the caller was never allowed to open — the
    // visibility check only runs at creation.
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _updatePrivateWindow({
      data: {
        campaignId: CAMPAIGN_ID,
        privateWindowId: PW_ID,
        x: 10,
        collection: 'monster',
        documentId: LORE_ID,
        screenId: SCREEN_2_ID,
      },
    });

    const [, update] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    expect(update).toEqual({ $set: { 'privateWindows.$.x': 10 } });
    expect(JSON.stringify(update)).not.toContain('monster');
    expect(JSON.stringify(update)).not.toContain(SCREEN_2_ID);
  });

  it('ignores a hostile userId in the payload', async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _updatePrivateWindow({
      data: { campaignId: CAMPAIGN_ID, privateWindowId: PW_ID, x: 1, userId: OTHER_DB_ID },
    });

    const [filter] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    expect(filter).toMatchObject({ userId: CALLER_DB_ID });
    expect(JSON.stringify(filter)).not.toContain(OTHER_DB_ID);
  });

  it('writes nothing when no layout field is supplied', async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _updatePrivateWindow({ data: { campaignId: CAMPAIGN_ID, privateWindowId: PW_ID } });

    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('treats a malformed id as a no-op rather than a CastError', async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(leanResult(makeStateDoc([])) as never);

    await expect(
      _updatePrivateWindow({ data: { campaignId: CAMPAIGN_ID, privateWindowId: 'nope', x: 5 } })
    ).resolves.toBeDefined();
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a non-member', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: CAMPAIGN_ID,
      gameMasterId: GM_DB_ID,
      members: [{ userId: GM_DB_ID, role: 'gm' }],
    } as never);

    await expect(
      _updatePrivateWindow({ data: { campaignId: CAMPAIGN_ID, privateWindowId: PW_ID, x: 1 } })
    ).rejects.toThrow('Forbidden');
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('does not broadcast', async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValue(
      leanResult(makeStateDoc([makePrivateWindow()])) as never
    );

    await _updatePrivateWindow({
      data: { campaignId: CAMPAIGN_ID, privateWindowId: PW_ID, x: 1 },
    });

    expect(createPartyBroadcastToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removePrivateWindow
// ---------------------------------------------------------------------------

describe('removePrivateWindow', () => {
  it("pulls only the matching id from the caller's own document", async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValueOnce(
      leanResult(makeStateDoc([])) as never
    );

    // Again with a hostile userId in the payload.
    const result = await _removePrivateWindow({
      data: { campaignId: CAMPAIGN_ID, privateWindowId: PW_ID, userId: OTHER_DB_ID },
    });

    const [filter, update] = vi.mocked(TabletopPlayerState.updateOne).mock.calls[0]!;
    expect(filter).toEqual({ campaignId: CAMPAIGN_ID, userId: CALLER_DB_ID });
    expect(update).toEqual({ $pull: { privateWindows: { _id: PW_ID } } });
    expect(JSON.stringify(filter)).not.toContain(OTHER_DB_ID);

    expect(vi.mocked(TabletopPlayerState.findOne).mock.calls[0]![0]).toMatchObject({
      campaignId: CAMPAIGN_ID,
      userId: CALLER_DB_ID,
    });
    expect(result.privateWindows).toEqual([]);
  });

  it('treats a malformed id as a no-op rather than a CastError', async () => {
    // Closing a window that isn't there should never surface as a 500.
    vi.mocked(TabletopPlayerState.findOne).mockReturnValueOnce(
      leanResult(makeStateDoc([])) as never
    );

    await expect(
      _removePrivateWindow({ data: { campaignId: CAMPAIGN_ID, privateWindowId: 'nope' } })
    ).resolves.toBeDefined();
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });

  it('allows a non-GM member and does not broadcast', async () => {
    vi.mocked(TabletopPlayerState.findOne).mockReturnValueOnce(
      leanResult(makeStateDoc([])) as never
    );

    await expect(
      _removePrivateWindow({ data: { campaignId: CAMPAIGN_ID, privateWindowId: PW_ID } })
    ).resolves.toBeDefined();

    expect(createPartyBroadcastToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-member', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue({
      _id: CAMPAIGN_ID,
      gameMasterId: GM_DB_ID,
      members: [{ userId: GM_DB_ID, role: 'gm' }],
    } as never);

    await expect(
      _removePrivateWindow({ data: { campaignId: CAMPAIGN_ID, privateWindowId: PW_ID } })
    ).rejects.toThrow('Forbidden');
    expect(TabletopPlayerState.updateOne).not.toHaveBeenCalled();
  });
});
