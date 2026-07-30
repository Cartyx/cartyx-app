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

vi.mock('~/server/functions/packages', () => ({
  listPackages: vi.fn(),
  getPackage: vi.fn(),
  createPackage: vi.fn(),
  updatePackage: vi.fn(),
  deletePackage: vi.fn(),
  clonePackage: vi.fn(),
}));

vi.mock('~/server/functions/soundboard', () => ({
  loadBoardState: vi.fn(),
  saveBoardState: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  clonePackage,
} from '~/server/functions/packages';
import { loadBoardState, saveBoardState } from '~/server/functions/soundboard';
import {
  listPackagesFn,
  getPackageFn,
  createPackageFn,
  updatePackageFn,
  deletePackageFn,
  clonePackageFn,
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
    vi.mocked(listPackages).mockResolvedValue({ items: [FAKE_PACKAGE] });
    const r = await listPackagesFn();
    expect(listPackages).toHaveBeenCalledTimes(1);
    expect(listPackages).toHaveBeenCalledWith({
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual({ items: [FAKE_PACKAGE] });
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
