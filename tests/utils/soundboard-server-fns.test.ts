import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same "mock createServerFn too" fallback as tests/utils/audio-server-fns.test.ts:
// collapse `createServerFn(...).inputValidator(...).handler(fn)` (or, for
// `listPackagesFn`, the input-less `createServerFn(...).handler(fn)`) down to
// just `fn`, so each exported wrapper becomes directly callable in this test
// with no real TanStack Start server-fn machinery involved. Both `.handler`
// call shapes need a landing spot on the mock object: the six wrappers with
// input go through `.inputValidator().handler()`, `listPackagesFn` goes
// straight from `createServerFn(...)` to `.handler()`.
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
}));

vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
}));

vi.mock('~/server/db/models/User', () => ({
  User: { findOne: vi.fn() },
}));

// `PackageClientError`/`SoundboardClientError` are real classes rather than
// `vi.fn()`s because the wrappers' rate-limit gates construct one and the
// tests below assert `instanceof` on what comes back — that `instanceof` is
// the GlitchTip proof, since `reportPackageError`/`reportSoundboardError` in
// the real modules exclude exactly these classes. They mirror the real
// constructor signatures; `npm run typecheck` is what keeps the stand-ins from
// drifting, because the wrappers are typechecked against the real modules.
vi.mock('~/server/functions/packages', () => ({
  PackageClientError: class PackageClientError extends Error {
    readonly retryAfterMs?: number;
    constructor(message: string, options?: { retryAfterMs?: number }) {
      super(message);
      this.name = 'PackageClientError';
      this.retryAfterMs = options?.retryAfterMs;
    }
  },
  listPackages: vi.fn(),
  getPackage: vi.fn(),
  createPackage: vi.fn(),
  updatePackage: vi.fn(),
  deletePackage: vi.fn(),
  clonePackage: vi.fn(),
  listPackageAssets: vi.fn(),
}));

vi.mock('~/server/functions/soundboard', () => ({
  SoundboardClientError: class SoundboardClientError extends Error {
    readonly retryAfterMs?: number;
    constructor(message: string, options?: { retryAfterMs?: number }) {
      super(message);
      this.name = 'SoundboardClientError';
      this.retryAfterMs = options?.retryAfterMs;
    }
  },
  loadBoardState: vi.fn(),
  saveBoardState: vi.fn(),
}));

// Not in the wrappers' import graph (the server functions that would call it
// are mocked above), so this assertion cannot fail today — which is the
// point. It fails the day someone reports a rate-limit rejection from the
// wrapper itself, which would hand an attacker a telemetry-volume lever.
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import {
  PackageClientError,
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  clonePackage,
  listPackageAssets,
} from '~/server/functions/packages';
import {
  SoundboardClientError,
  loadBoardState,
  saveBoardState,
} from '~/server/functions/soundboard';
import { serverCaptureException } from '~/server/utils/telemetry';
import {
  listPackagesFn,
  getPackageFn,
  createPackageFn,
  updatePackageFn,
  deletePackageFn,
  clonePackageFn,
  listPackageAssetsFn,
  loadBoardStateFn,
  saveBoardStateFn,
} from '~/utils/soundboard-server-fns';

const SESSION_USER = {
  id: 'user-1',
  provider: 'google',
  name: null,
  email: null,
  avatar: null,
  role: 'gm',
  tokenIssuedAt: 0,
};

/**
 * Deliberately distinct from `SESSION_USER.id` — same reasoning as
 * `tests/utils/audio-server-fns.test.ts`'s `DB_USER_ID`: a test that
 * accidentally asserts on the provider id (the phase-1 bug) fails loudly
 * instead of silently passing.
 */
const DB_USER_ID = 'mongo-user-1';

/** Stubs `User.findOne(...).select(...).lean()` — mirrors `requireActor`'s chain. */
function mockDbUser(id: string | null) {
  vi.mocked(User.findOne).mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(id ? { _id: id } : null) }),
  } as unknown as ReturnType<typeof User.findOne>);
}

const FAKE_PACKAGE = {
  id: 'p1',
  ownerId: DB_USER_ID,
  name: 'Storm Set',
  description: null,
  items: [],
  moods: [],
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

/**
 * What `listPackages` returns — a SUMMARY row (`itemCount`/`moodCount`), not
 * a full package. The two shapes are deliberately different: the list view
 * never renders an item or a mood, and a maxed package is ~410 KiB of
 * embedded arrays it would otherwise ship per row.
 */
const FAKE_PACKAGE_SUMMARY = {
  id: 'p1',
  ownerId: DB_USER_ID,
  name: 'Storm Set',
  description: null,
  itemCount: 0,
  moodCount: 0,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

const FAKE_BOARD_STATE = {
  campaignId: 'c1',
  packageId: null,
  moodId: null,
  items: [],
  masterVolume: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPackagesFn', () => {
  it('rejects with "Not authenticated" and never calls listPackages when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(listPackagesFn()).rejects.toThrow('Not authenticated');
    expect(listPackages).not.toHaveBeenCalled();
  });

  it("calls listPackages with the resolved Mongo userId (not the session's provider id) once authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(listPackages).mockResolvedValue({ items: [FAKE_PACKAGE_SUMMARY] });
    const r = await listPackagesFn();
    expect(listPackages).toHaveBeenCalledTimes(1);
    expect(listPackages).toHaveBeenCalledWith({
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual({ items: [FAKE_PACKAGE_SUMMARY] });
  });

  it('rejects with "User not found" and never calls listPackages when the session has no matching User doc', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(null);
    await expect(listPackagesFn()).rejects.toThrow('User not found');
    expect(listPackages).not.toHaveBeenCalled();
  });
});

describe('getPackageFn', () => {
  const data = { id: 'p1' };

  it('rejects with "Not authenticated" and never calls getPackage when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(getPackageFn({ data })).rejects.toThrow('Not authenticated');
    expect(getPackage).not.toHaveBeenCalled();
  });

  it('calls getPackage with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(getPackage).mockResolvedValue(FAKE_PACKAGE);
    const r = await getPackageFn({ data });
    expect(getPackage).toHaveBeenCalledTimes(1);
    expect(getPackage).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual(FAKE_PACKAGE);
  });
});

describe('createPackageFn', () => {
  const data = { name: 'Storm Set', items: [], moods: [] };

  it('rejects with "Not authenticated" and never calls createPackage when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(createPackageFn({ data })).rejects.toThrow('Not authenticated');
    expect(createPackage).not.toHaveBeenCalled();
  });

  it('calls createPackage with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(createPackage).mockResolvedValue(FAKE_PACKAGE);
    const r = await createPackageFn({ data });
    expect(createPackage).toHaveBeenCalledTimes(1);
    expect(createPackage).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual(FAKE_PACKAGE);
  });
});

describe('updatePackageFn', () => {
  const data = { id: 'p1', name: 'Renamed' };

  it('rejects with "Not authenticated" and never calls updatePackage when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(updatePackageFn({ data })).rejects.toThrow('Not authenticated');
    expect(updatePackage).not.toHaveBeenCalled();
  });

  it('calls updatePackage with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(updatePackage).mockResolvedValue(FAKE_PACKAGE);
    const r = await updatePackageFn({ data });
    expect(updatePackage).toHaveBeenCalledTimes(1);
    expect(updatePackage).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual(FAKE_PACKAGE);
  });
});

describe('deletePackageFn', () => {
  const data = { id: 'p1' };

  it('rejects with "Not authenticated" and never calls deletePackage when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(deletePackageFn({ data })).rejects.toThrow('Not authenticated');
    expect(deletePackage).not.toHaveBeenCalled();
  });

  it('calls deletePackage with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(deletePackage).mockResolvedValue({ deleted: true });
    const r = await deletePackageFn({ data });
    expect(deletePackage).toHaveBeenCalledTimes(1);
    expect(deletePackage).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual({ deleted: true });
  });
});

describe('clonePackageFn', () => {
  const data = { id: 'p1' };

  it('rejects with "Not authenticated" and never calls clonePackage when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(clonePackageFn({ data })).rejects.toThrow('Not authenticated');
    expect(clonePackage).not.toHaveBeenCalled();
  });

  it('calls clonePackage with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(clonePackage).mockResolvedValue({ ...FAKE_PACKAGE, id: 'p2', ownerId: DB_USER_ID });
    const r = await clonePackageFn({ data });
    expect(clonePackage).toHaveBeenCalledTimes(1);
    expect(clonePackage).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual({ ...FAKE_PACKAGE, id: 'p2', ownerId: DB_USER_ID });
  });
});

describe('listPackageAssetsFn', () => {
  const data = { packageId: 'p1' };

  it('rejects with "Not authenticated" and never calls listPackageAssets when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(listPackageAssetsFn({ data })).rejects.toThrow('Not authenticated');
    expect(listPackageAssets).not.toHaveBeenCalled();
  });

  it('calls listPackageAssets with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(listPackageAssets).mockResolvedValue({ items: [] });
    const r = await listPackageAssetsFn({ data });
    expect(listPackageAssets).toHaveBeenCalledTimes(1);
    expect(listPackageAssets).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual({ items: [] });
  });
});

describe('loadBoardStateFn', () => {
  const data = { campaignId: 'c1' };

  it('rejects with "Not authenticated" and never calls loadBoardState when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(loadBoardStateFn({ data })).rejects.toThrow('Not authenticated');
    expect(loadBoardState).not.toHaveBeenCalled();
  });

  it("calls loadBoardState with the data and resolved userId once authenticated (campaign membership is loadBoardState's own job, not this wrapper's)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(loadBoardState).mockResolvedValue(FAKE_BOARD_STATE);
    const r = await loadBoardStateFn({ data });
    expect(loadBoardState).toHaveBeenCalledTimes(1);
    expect(loadBoardState).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual(FAKE_BOARD_STATE);
  });
});

/**
 * The wrapper-layer rate limits (`packageWriteLimiter` /`boardStateLimiter`,
 * see `~/lib/audio-rate-limits.ts`).
 *
 * As in `tests/utils/audio-server-fns.test.ts`, every test uses its OWN
 * `DB_USER_ID`: the limiters are module-scope singletons with no reset hook,
 * `vi.clearAllMocks()` cannot empty their buckets, and the bucket key IS the
 * resolved Mongo `_id`. A distinct id per test is a fresh, full bucket.
 *
 * The `15` and `40` below are the two capacities, written as literals on
 * purpose: raising a capacity makes the "next call is refused" assertion
 * fail, lowering it makes the drain loop throw early. Both directions pinned.
 */
describe('package-write rate limit', () => {
  const createData = { name: 'Storm Set', items: [], moods: [] };

  /** Spends the whole package-write bucket for `userId` via `createPackageFn`. */
  async function drainPackageBucket(userId: string) {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(userId);
    vi.mocked(createPackage).mockResolvedValue(FAKE_PACKAGE);
    for (let i = 0; i < 15; i++) {
      await createPackageFn({ data: createData });
    }
    expect(createPackage).toHaveBeenCalledTimes(15);
    vi.mocked(createPackage).mockClear();
  }

  it('lets a full 15-call burst through, then refuses the 16th without calling createPackage', async () => {
    await drainPackageBucket('mongo-pkg-create');

    await expect(createPackageFn({ data: createData })).rejects.toThrow(
      /Too many sound package requests/
    );
    // Without this, the test would still pass with the gate deleted.
    expect(createPackage).not.toHaveBeenCalled();
  });

  it('refuses with PackageClientError carrying retryAfterMs, and files no GlitchTip event', async () => {
    await drainPackageBucket('mongo-pkg-shape');

    const err = await createPackageFn({ data: createData }).catch((e: unknown) => e);
    // `reportPackageError` excludes exactly this class from
    // `serverCaptureException` — the class is the no-telemetry contract.
    expect(err).toBeInstanceOf(PackageClientError);
    expect((err as PackageClientError).retryAfterMs).toBeGreaterThan(0);
    expect(serverCaptureException).not.toHaveBeenCalled();
    expect(createPackage).not.toHaveBeenCalled();
  });

  it('shares one bucket with clonePackageFn, so a drained bucket refuses a clone too', async () => {
    await drainPackageBucket('mongo-pkg-clone');

    await expect(clonePackageFn({ data: { id: 'p1' } })).rejects.toThrow(
      /Too many sound package requests/
    );
    expect(clonePackage).not.toHaveBeenCalled();
    expect(serverCaptureException).not.toHaveBeenCalled();
  });

  it('is keyed per account: draining one user does not refuse another', async () => {
    await drainPackageBucket('mongo-pkg-victim');

    mockDbUser('mongo-pkg-bystander');
    vi.mocked(createPackage).mockResolvedValue(FAKE_PACKAGE);
    await expect(createPackageFn({ data: createData })).resolves.toEqual(FAKE_PACKAGE);
  });

  it('does not gate updatePackageFn or deletePackageFn — neither can grow the footprint', async () => {
    await drainPackageBucket('mongo-pkg-update-delete');

    vi.mocked(updatePackage).mockResolvedValue(FAKE_PACKAGE);
    vi.mocked(deletePackage).mockResolvedValue({ deleted: true });
    await expect(updatePackageFn({ data: { id: 'p1', name: 'Renamed' } })).resolves.toEqual(
      FAKE_PACKAGE
    );
    await expect(deletePackageFn({ data: { id: 'p1' } })).resolves.toEqual({ deleted: true });
  });

  it('does not gate reads: listPackagesFn/getPackageFn/listPackageAssetsFn survive past the capacity', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser('mongo-pkg-reader');
    vi.mocked(listPackages).mockResolvedValue({ items: [FAKE_PACKAGE_SUMMARY] });
    vi.mocked(getPackage).mockResolvedValue(FAKE_PACKAGE);
    vi.mocked(listPackageAssets).mockResolvedValue({ items: [] });
    for (let i = 0; i < 40; i++) {
      await listPackagesFn();
      await getPackageFn({ data: { id: 'p1' } });
      await listPackageAssetsFn({ data: { packageId: 'p1' } });
    }
    expect(listPackages).toHaveBeenCalledTimes(40);
    expect(getPackage).toHaveBeenCalledTimes(40);
    expect(listPackageAssets).toHaveBeenCalledTimes(40);
  });
});

describe('board-save rate limit', () => {
  const saveData = { campaignId: 'c1', items: [], masterVolume: 1 };

  /** Spends the whole board-state bucket for `userId`. */
  async function drainBoardBucket(userId: string) {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(userId);
    vi.mocked(saveBoardState).mockResolvedValue(FAKE_BOARD_STATE);
    for (let i = 0; i < 40; i++) {
      await saveBoardStateFn({ data: saveData });
    }
    expect(saveBoardState).toHaveBeenCalledTimes(40);
    vi.mocked(saveBoardState).mockClear();
  }

  it('lets a full 40-call burst through, then refuses the 41st without calling saveBoardState', async () => {
    await drainBoardBucket('mongo-board-save');

    await expect(saveBoardStateFn({ data: saveData })).rejects.toThrow(
      /Too many board save requests/
    );
    // Without this, the test would still pass with the gate deleted.
    expect(saveBoardState).not.toHaveBeenCalled();
  });

  it('refuses with SoundboardClientError carrying retryAfterMs, and files no GlitchTip event', async () => {
    await drainBoardBucket('mongo-board-shape');

    const err = await saveBoardStateFn({ data: saveData }).catch((e: unknown) => e);
    // `reportSoundboardError` excludes exactly this class from
    // `serverCaptureException` — the class is the no-telemetry contract.
    expect(err).toBeInstanceOf(SoundboardClientError);
    expect((err as SoundboardClientError).retryAfterMs).toBeGreaterThan(0);
    expect(serverCaptureException).not.toHaveBeenCalled();
    expect(saveBoardState).not.toHaveBeenCalled();
  });

  it('is a separate bucket from the package writes: a drained board bucket still allows createPackage', async () => {
    await drainBoardBucket('mongo-board-vs-package');

    vi.mocked(createPackage).mockResolvedValue(FAKE_PACKAGE);
    await expect(
      createPackageFn({ data: { name: 'Storm Set', items: [], moods: [] } })
    ).resolves.toEqual(FAKE_PACKAGE);
  });

  it('is keyed per account: draining one GM does not refuse another', async () => {
    await drainBoardBucket('mongo-board-victim');

    mockDbUser('mongo-board-bystander');
    vi.mocked(saveBoardState).mockResolvedValue(FAKE_BOARD_STATE);
    await expect(saveBoardStateFn({ data: saveData })).resolves.toEqual(FAKE_BOARD_STATE);
  });

  it('does not gate loadBoardStateFn — a board reload must not be refused', async () => {
    await drainBoardBucket('mongo-board-reload');

    vi.mocked(loadBoardState).mockResolvedValue(FAKE_BOARD_STATE);
    await expect(loadBoardStateFn({ data: { campaignId: 'c1' } })).resolves.toEqual(
      FAKE_BOARD_STATE
    );
  });
});

describe('saveBoardStateFn', () => {
  const data = { campaignId: 'c1', items: [], masterVolume: 1 };

  it('rejects with "Not authenticated" and never calls saveBoardState when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(saveBoardStateFn({ data })).rejects.toThrow('Not authenticated');
    expect(saveBoardState).not.toHaveBeenCalled();
  });

  it("calls saveBoardState with the data and resolved userId once authenticated (the GM gate is saveBoardState's own job, not this wrapper's)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(saveBoardState).mockResolvedValue(FAKE_BOARD_STATE);
    const r = await saveBoardStateFn({ data });
    expect(saveBoardState).toHaveBeenCalledTimes(1);
    expect(saveBoardState).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual(FAKE_BOARD_STATE);
  });
});
