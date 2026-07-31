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

// `AudioClientError` is a real class here rather than a `vi.fn()` because the
// wrapper's rate-limit gate constructs one (`new AudioClientError(msg, {
// retryAfterMs })`) and the tests below assert `instanceof` on what comes
// back — that `instanceof` is the whole GlitchTip proof, since
// `reportAudioError` in the real module excludes exactly this class. It
// mirrors the real constructor signature; `npm run typecheck` is what keeps
// the two from drifting, because the wrapper is typechecked against the real
// module, not this stand-in.
vi.mock('~/server/functions/audio', () => ({
  AudioClientError: class AudioClientError extends Error {
    readonly retryAfterMs?: number;
    constructor(message: string, options?: { retryAfterMs?: number }) {
      super(message);
      this.name = 'AudioClientError';
      this.retryAfterMs = options?.retryAfterMs;
    }
  },
  createAudioUpload: vi.fn(),
  confirmAudioUpload: vi.fn(),
  createOnceVariantUpload: vi.fn(),
  confirmOnceVariantUpload: vi.fn(),
  retryAudioAsset: vi.fn(),
  listAudioAssets: vi.fn(),
  updateAudioAsset: vi.fn(),
  bulkTagAudioAssets: vi.fn(),
  deleteAudioAsset: vi.fn(),
}));

// Not in the wrapper's import graph at all (the server functions that would
// call it are mocked above), so this assertion cannot fail today — which is
// the point. It fails the day someone "helpfully" reports a rate-limit
// rejection from the wrapper itself, which is the telemetry-amplification
// mistake this phase exists to avoid: the rejection volume is the attacker's
// parameter.
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import {
  AudioClientError,
  createAudioUpload,
  confirmAudioUpload,
  createOnceVariantUpload,
  confirmOnceVariantUpload,
  retryAudioAsset,
  listAudioAssets,
  updateAudioAsset,
  bulkTagAudioAssets,
  deleteAudioAsset,
} from '~/server/functions/audio';
import { serverCaptureException } from '~/server/utils/telemetry';
import {
  createAudioUploadFn,
  confirmAudioUploadFn,
  createOnceVariantUploadFn,
  confirmOnceVariantUploadFn,
  retryAudioAssetFn,
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

/**
 * The resolved Mongo `_id` string `requireActor()` should hand downstream —
 * deliberately distinct from `SESSION_USER.id` so a test that accidentally
 * asserts on the provider id (the bug this fix corrects) fails loudly.
 *
 * `requireActor` returns BOTH: `userId` for scoping the query and
 * `sessionUserId` (the provider id) for telemetry, so a single human is one
 * identity in GlitchTip/Umami across audio and everything else. Every
 * assertion below pins both, because dropping `sessionUserId` silently
 * reintroduces the split-identity bug — the functions fall back to the Mongo
 * id when it's absent, so nothing else would fail.
 */
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
  durationSamples: null,
  loudnessTargetLufs: null,
  peaks: [] as number[],
  renditions: {},
  lastError: null,
  permanentFailure: false,
  retryable: false,
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
    expect(createAudioUpload).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
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
    expect(confirmAudioUpload).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
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
    expect(listAudioAssets).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
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
    expect(updateAudioAsset).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
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
    expect(bulkTagAudioAssets).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual({ modified: 2 });
  });
});

/**
 * The wrapper-layer rate limit (`audioIngestLimiter`, see
 * `~/lib/audio-rate-limits.ts`).
 *
 * Every test here uses its OWN `DB_USER_ID`, because the limiter is a
 * module-scope singleton with no reset hook — `vi.clearAllMocks()` cannot
 * empty its buckets, and the bucket key IS the resolved Mongo `_id`. A shared
 * id would make these tests order-dependent and would poison the pass-through
 * tests above. A distinct id per test is a fresh, full bucket by construction.
 *
 * The `60` below is `audioIngestLimiter`'s capacity, written as a literal on
 * purpose: raising it makes the "61st is refused" assertion fail, and lowering
 * it makes the drain loop throw early. The number is pinned in both
 * directions rather than read from the module under test.
 */
describe('ingest rate limit', () => {
  const uploadData = {
    filename: 'storm.wav',
    contentType: 'audio/wav',
    bytes: 1024,
    kind: 'ambience' as const,
    environment: [],
    mood: [],
    tags: [] as string[],
  };

  /** Spends the whole ingest bucket for `userId` via `createAudioUploadFn`. */
  async function drainIngestBucket(userId: string) {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser(userId);
    vi.mocked(createAudioUpload).mockResolvedValue({
      assetId: 'a1',
      uploadUrl: 'https://put',
      key: 'k',
    });
    for (let i = 0; i < 60; i++) {
      await createAudioUploadFn({ data: uploadData });
    }
    expect(createAudioUpload).toHaveBeenCalledTimes(60);
    vi.mocked(createAudioUpload).mockClear();
  }

  it('lets a full 60-call burst through, then refuses the 61st without calling createAudioUpload', async () => {
    await drainIngestBucket('mongo-ingest-create');

    await expect(createAudioUploadFn({ data: uploadData })).rejects.toThrow(
      /Too many upload requests/
    );
    // The gate is the ONLY reason this call failed: the underlying server
    // function was never reached. Without this assertion the test would still
    // pass with the limiter deleted, because something further down throws.
    expect(createAudioUpload).not.toHaveBeenCalled();
  });

  it('refuses with AudioClientError carrying retryAfterMs, and files no GlitchTip event', async () => {
    await drainIngestBucket('mongo-ingest-shape');

    const err = await createAudioUploadFn({ data: uploadData }).catch((e: unknown) => e);
    // `reportAudioError` excludes exactly this class from
    // `serverCaptureException` — the class is the no-telemetry contract.
    expect(err).toBeInstanceOf(AudioClientError);
    expect((err as AudioClientError).retryAfterMs).toBeGreaterThan(0);
    expect(serverCaptureException).not.toHaveBeenCalled();
    expect(createAudioUpload).not.toHaveBeenCalled();
  });

  it('shares one bucket across confirmAudioUploadFn, so a drained bucket refuses a confirm too', async () => {
    await drainIngestBucket('mongo-ingest-confirm');

    await expect(confirmAudioUploadFn({ data: { assetId: 'a1' } })).rejects.toThrow(
      /Too many upload requests/
    );
    expect(confirmAudioUpload).not.toHaveBeenCalled();
    expect(serverCaptureException).not.toHaveBeenCalled();
  });

  it('shares one bucket across createOnceVariantUploadFn, so a drained bucket refuses a once-variant presign too', async () => {
    await drainIngestBucket('mongo-ingest-once-create');

    await expect(
      createOnceVariantUploadFn({
        data: { assetId: 'a1', filename: 'once.wav', contentType: 'audio/wav', bytes: 1024 },
      })
    ).rejects.toThrow(/Too many upload requests/);
    expect(createOnceVariantUpload).not.toHaveBeenCalled();
    expect(serverCaptureException).not.toHaveBeenCalled();
  });

  it('shares one bucket across confirmOnceVariantUploadFn, so a drained bucket refuses a once-variant confirm too', async () => {
    await drainIngestBucket('mongo-ingest-once-confirm');

    await expect(confirmOnceVariantUploadFn({ data: { assetId: 'a1' } })).rejects.toThrow(
      /Too many upload requests/
    );
    expect(confirmOnceVariantUpload).not.toHaveBeenCalled();
    expect(serverCaptureException).not.toHaveBeenCalled();
  });

  it('shares one bucket with retryAudioAssetFn, so a drained bucket refuses a retry too', async () => {
    await drainIngestBucket('mongo-ingest-retry');

    // `retryAudioAsset` makes a `failed` row claimable again — the same act as
    // a confirm, so it draws on the same bucket. Note the message says "retry"
    // rather than "upload", which is why this asserts a different string.
    await expect(retryAudioAssetFn({ data: { id: 'a1' } })).rejects.toThrow(
      /Too many retry requests/
    );
    expect(retryAudioAsset).not.toHaveBeenCalled();
    expect(serverCaptureException).not.toHaveBeenCalled();
  });

  it('is keyed per account: draining one user does not refuse another', async () => {
    await drainIngestBucket('mongo-ingest-victim');

    mockDbUser('mongo-ingest-bystander');
    vi.mocked(createAudioUpload).mockResolvedValue({
      assetId: 'a2',
      uploadUrl: 'https://put',
      key: 'k',
    });
    await expect(createAudioUploadFn({ data: uploadData })).resolves.toEqual({
      assetId: 'a2',
      uploadUrl: 'https://put',
      key: 'k',
    });
  });

  it('does not gate reads: listAudioAssetsFn survives far past the ingest capacity', async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_USER);
    mockDbUser('mongo-ingest-reader');
    vi.mocked(listAudioAssets).mockResolvedValue({ items: [FAKE_ASSET], nextCursor: null });
    for (let i = 0; i < 120; i++) {
      await listAudioAssetsFn({ data: { limit: 50 } });
    }
    expect(listAudioAssets).toHaveBeenCalledTimes(120);
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
    expect(deleteAudioAsset).toHaveBeenCalledWith({
      data,
      userId: DB_USER_ID,
      sessionUserId: SESSION_USER.id,
    });
    expect(r).toEqual({ deleted: true });
  });
});
