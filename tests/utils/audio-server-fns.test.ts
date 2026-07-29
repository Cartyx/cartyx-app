import { describe, it, expect, vi, beforeEach } from 'vitest';

// `createServerFn(...).inputValidator(...).handler(fn)` is collapsed to just
// `fn` — the raw handler passed to `.handler()` — so each exported wrapper in
// audio-server-fns.ts becomes directly callable as `wrapperFn({ data })` in
// this test, with no real TanStack Start server-fn machinery involved. This
// is the "mock createServerFn too" fallback: the six wrappers are plain
// `createServerFn(...).inputValidator(schema).handler(async ({data}) => ...)`
// declarations with no interesting logic in the `createServerFn`/
// `inputValidator` plumbing itself (schema validation is already covered by
// tests/types/audio-schemas.test.ts) — the only behavior worth pinning here
// is inside the handler bodies: the `requireUserId()` auth gate and the
// pass-through of `{ data, userId }` to the right `~/server/functions/audio`
// function. Unwrapping to the raw handler lets the test call it directly and
// assert on exactly that, the same way tests/utils/uploadToR2.test.ts already
// unwraps createServerFn for the same reason.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
  }),
}));

vi.mock('~/server/session', () => ({
  getSession: vi.fn(),
}));

// `requireUserId()` resolves `SessionUser.id` (the OAuth provider's subject
// id) to this app's Mongo `_id` via `User.findOne({ providerId })` before
// handing it to `~/server/functions/audio` — `AudioAsset.ownerId` is a
// Mongoose `ObjectId`, and a provider id like `'user-1'`/`'google_...'`
// doesn't cast to one. Per this repo's "unit tests mock mongoose" convention
// (no in-memory Mongo), `User.findOne` is mocked per-test rather than hit
// for real.
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
}));

vi.mock('~/server/db/models/User', () => ({
  User: { findOne: vi.fn() },
}));

vi.mock('~/server/functions/audio', () => ({
  createAudioUpload: vi.fn(),
  confirmAudioUpload: vi.fn(),
  listAudioAssets: vi.fn(),
  updateAudioAsset: vi.fn(),
  bulkTagAudioAssets: vi.fn(),
  deleteAudioAsset: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import {
  createAudioUpload,
  confirmAudioUpload,
  listAudioAssets,
  updateAudioAsset,
  bulkTagAudioAssets,
  deleteAudioAsset,
} from '~/server/functions/audio';
import {
  createAudioUploadFn,
  confirmAudioUploadFn,
  listAudioAssetsFn,
  updateAudioAssetFn,
  bulkTagAudioAssetsFn,
  deleteAudioAssetFn,
} from '~/utils/audio-server-fns';

const SESSION_USER = {
  id: 'user-1',
  provider: 'google',
  name: null,
  email: null,
  avatar: null,
  role: 'gm',
  tokenIssuedAt: 0,
};

/** The resolved Mongo `_id` string `requireUserId()` should hand downstream — deliberately distinct from `SESSION_USER.id` so a test that accidentally asserts on the provider id (the bug this fix corrects) fails loudly. */
const DB_USER_ID = 'mongo-user-1';

/** Stubs `User.findOne(...).select(...).lean()` — mirrors requireUserId's chain. */
function mockDbUser(id: string | null) {
  vi.mocked(User.findOne).mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(id ? { _id: id } : null) }),
  } as unknown as ReturnType<typeof User.findOne>);
}

const FAKE_ASSET = {
  id: 'a1',
  ownerId: 'user-1',
  title: 'Storm',
  kind: 'ambience' as const,
  environment: [] as string[],
  mood: [] as string[],
  intensity: null,
  tags: [] as string[],
  status: 'ready' as const,
  durationMs: null,
  loudnessTargetLufs: null,
  peaks: [] as number[],
  renditions: {},
  lastError: null,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAudioUploadFn', () => {
  const data = {
    filename: 'storm.wav',
    contentType: 'audio/wav',
    bytes: 1024,
    kind: 'ambience' as const,
    environment: [],
    mood: [],
    tags: [] as string[],
  };

  it('rejects with "Not authenticated" and never calls createAudioUpload when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(createAudioUploadFn({ data })).rejects.toThrow('Not authenticated');
    expect(createAudioUpload).not.toHaveBeenCalled();
  });

  it("calls createAudioUpload with the data and the resolved Mongo userId (not the session's provider id) once authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(createAudioUpload).mockResolvedValue({
      assetId: 'a1',
      uploadUrl: 'https://put',
      key: 'k',
    });
    const r = await createAudioUploadFn({ data });
    expect(createAudioUpload).toHaveBeenCalledTimes(1);
    expect(createAudioUpload).toHaveBeenCalledWith({ data, userId: DB_USER_ID });
    expect(r).toEqual({ assetId: 'a1', uploadUrl: 'https://put', key: 'k' });
  });

  it('rejects with "User not found" and never calls createAudioUpload when the session has no matching User doc', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(null);
    await expect(createAudioUploadFn({ data })).rejects.toThrow('User not found');
    expect(createAudioUpload).not.toHaveBeenCalled();
  });
});

describe('confirmAudioUploadFn', () => {
  const data = { assetId: 'a1' };

  it('rejects with "Not authenticated" and never calls confirmAudioUpload when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(confirmAudioUploadFn({ data })).rejects.toThrow('Not authenticated');
    expect(confirmAudioUpload).not.toHaveBeenCalled();
  });

  it('calls confirmAudioUpload with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(confirmAudioUpload).mockResolvedValue({ assetId: 'a1', status: 'pending' });
    const r = await confirmAudioUploadFn({ data });
    expect(confirmAudioUpload).toHaveBeenCalledTimes(1);
    expect(confirmAudioUpload).toHaveBeenCalledWith({ data, userId: DB_USER_ID });
    expect(r).toEqual({ assetId: 'a1', status: 'pending' });
  });
});

describe('listAudioAssetsFn', () => {
  const data = { limit: 50 };

  it('rejects with "Not authenticated" and never calls listAudioAssets when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(listAudioAssetsFn({ data })).rejects.toThrow('Not authenticated');
    expect(listAudioAssets).not.toHaveBeenCalled();
  });

  it('calls listAudioAssets with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(listAudioAssets).mockResolvedValue({ items: [FAKE_ASSET], nextCursor: null });
    const r = await listAudioAssetsFn({ data });
    expect(listAudioAssets).toHaveBeenCalledTimes(1);
    expect(listAudioAssets).toHaveBeenCalledWith({ data, userId: DB_USER_ID });
    expect(r).toEqual({ items: [FAKE_ASSET], nextCursor: null });
  });
});

describe('updateAudioAssetFn', () => {
  const data = { id: 'a1', title: 'New title' };

  it('rejects with "Not authenticated" and never calls updateAudioAsset when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(updateAudioAssetFn({ data })).rejects.toThrow('Not authenticated');
    expect(updateAudioAsset).not.toHaveBeenCalled();
  });

  it('calls updateAudioAsset with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(updateAudioAsset).mockResolvedValue(FAKE_ASSET);
    const r = await updateAudioAssetFn({ data });
    expect(updateAudioAsset).toHaveBeenCalledTimes(1);
    expect(updateAudioAsset).toHaveBeenCalledWith({ data, userId: DB_USER_ID });
    expect(r).toEqual(FAKE_ASSET);
  });
});

describe('bulkTagAudioAssetsFn', () => {
  const data = { ids: ['a1', 'a2'], tags: ['storm'], tagMode: 'add' as const };

  it('rejects with "Not authenticated" and never calls bulkTagAudioAssets when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(bulkTagAudioAssetsFn({ data })).rejects.toThrow('Not authenticated');
    expect(bulkTagAudioAssets).not.toHaveBeenCalled();
  });

  it('calls bulkTagAudioAssets with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(bulkTagAudioAssets).mockResolvedValue({ modified: 2 });
    const r = await bulkTagAudioAssetsFn({ data });
    expect(bulkTagAudioAssets).toHaveBeenCalledTimes(1);
    expect(bulkTagAudioAssets).toHaveBeenCalledWith({ data, userId: DB_USER_ID });
    expect(r).toEqual({ modified: 2 });
  });
});

describe('deleteAudioAssetFn', () => {
  const data = { id: 'a1' };

  it('rejects with "Not authenticated" and never calls deleteAudioAsset when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(deleteAudioAssetFn({ data })).rejects.toThrow('Not authenticated');
    expect(deleteAudioAsset).not.toHaveBeenCalled();
  });

  it('calls deleteAudioAsset with the data and resolved userId once authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(DB_USER_ID);
    vi.mocked(deleteAudioAsset).mockResolvedValue({ deleted: true });
    const r = await deleteAudioAssetFn({ data });
    expect(deleteAudioAsset).toHaveBeenCalledTimes(1);
    expect(deleteAudioAsset).toHaveBeenCalledWith({ data, userId: DB_USER_ID });
    expect(r).toEqual({ deleted: true });
  });
});
