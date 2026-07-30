import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/functions/uploads', () => ({ createR2: vi.fn(), getAudioUploadUrl: vi.fn() }));

const lean = vi.fn();
const limit = vi.fn((_limit?: number) => ({ lean }));
const sort = vi.fn((_sort?: Record<string, unknown>) => ({ limit }));
const find = vi.fn((_query?: Record<string, unknown>) => ({ sort }));
vi.mock('~/server/db/models/AudioAsset', () => ({ AudioAsset: { find } }));

describe('listAudioAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lean.mockResolvedValue([]);
  });

  it('always scopes the query to the caller', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({ data: { limit: 50 }, userId: 'u1' });
    expect(find.mock.calls[0][0]).toMatchObject({ ownerId: 'u1' });
  });

  it('filters facets with $in and tags with $all', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({
      data: { limit: 50, environment: ['coast'], mood: ['tense'], tags: ['storm', 'rain'] },
      userId: 'u1',
    });
    const q = find.mock.calls[0][0] as Record<string, unknown>;
    expect(q.environment).toEqual({ $in: ['coast'] });
    expect(q.mood).toEqual({ $in: ['tense'] });
    expect(q.tags).toEqual({ $all: ['storm', 'rain'] });
  });

  it('needsTagging matches ready assets with no facets and no tags', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({ data: { limit: 50, needsTagging: true }, userId: 'u1' });
    const q = find.mock.calls[0][0] as Record<string, unknown>;
    expect(q.status).toBe('ready');
    expect(q.tags).toEqual({ $size: 0 });
  });

  it('returns nextCursor only when a full page came back', async () => {
    const rows = Array.from({ length: 2 }, (_, i) => ({
      _id: `a${i}`,
      ownerId: 'u1',
      title: 't',
      kind: 'ambience',
      environment: [],
      mood: [],
      intensity: null,
      tags: [],
      peaks: [],
      renditions: {},
      status: 'ready',
      durationMs: null,
      loudnessTargetLufs: null,
      lastError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    lean.mockResolvedValue(rows);
    const { listAudioAssets } = await import('~/server/functions/audio');
    const r = await listAudioAssets({ data: { limit: 2 }, userId: 'u1' });
    expect(r.items).toHaveLength(2);
    // Cursor is now `<createdAt epoch ms>_<id>`, not a bare id — see Finding 2.
    // createdAt is new Date(0) (epoch ms 0), last row id is 'a1'.
    expect(r.nextCursor).toBe('0_a1');
  });

  it('escapes regex metacharacters in the search filter', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({ data: { limit: 50, search: 'a.b+c(d)|(e+)+$' }, userId: 'u1' });
    const q = find.mock.calls[0][0] as Record<string, unknown>;
    // Every regex metacharacter must come back escaped — a malicious pattern like
    // "(a+)+$" must not reach Mongo unescaped (catastrophic backtracking risk).
    expect(q.title).toEqual({ $regex: 'a\\.b\\+c\\(d\\)\\|\\(e\\+\\)\\+\\$', $options: 'i' });
  });

  it('builds a compound createdAt+_id filter from the cursor, not a bare _id filter', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    const cursor = '1700000000000_507f1f77bcf86cd799439011';
    await listAudioAssets({ data: { limit: 50, cursor }, userId: 'u1' });
    const q = find.mock.calls[0][0] as Record<string, unknown>;
    expect(q.$or).toEqual([
      { createdAt: { $lt: new Date(1700000000000) } },
      { createdAt: new Date(1700000000000), _id: { $lt: '507f1f77bcf86cd799439011' } },
    ]);
    // A bare `_id: { $lt }` filter under a createdAt-primary sort can skip or
    // duplicate rows across a page boundary — it must not be present.
    expect(q._id).toBeUndefined();
  });

  it('needsTagging merges with an explicit tag/environment filter instead of clobbering it', async () => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await listAudioAssets({
      data: { limit: 50, needsTagging: true, tags: ['storm'], environment: ['coast'] },
      userId: 'u1',
    });
    const q = find.mock.calls[0][0] as Record<string, unknown>;
    // Neither the needsTagging constraint nor the caller's explicit filter should
    // silently win by overwriting the other's top-level key.
    expect(q.tags).toBeUndefined();
    expect(q.environment).toBeUndefined();
    expect(q.status).toBe('ready');
    expect(q.$and).toEqual(
      expect.arrayContaining([
        { tags: { $size: 0 } },
        { environment: { $size: 0 } },
        { tags: { $all: ['storm'] } },
        { environment: { $in: ['coast'] } },
      ])
    );
    expect((q.$and as unknown[]).length).toBe(4);
  });

  /**
   * The function is fail-closed independently of the schema.
   *
   * These are the actual hostile values, not a stand-in: `1e20` written out in
   * digits (finite, so the old `Number.isFinite(ms)` guard passed it, but
   * beyond JS's 8.64e15 maximum Date, so `new Date(ms)` is `Invalid Date`), and
   * an id half that is not an ObjectId. Before the fix each one produced an
   * `$or` containing an `Invalid Date` / an uncastable `_id`, Mongoose threw a
   * CastError, and the caller got an HTTP 500 with a GlitchTip event attached.
   *
   * The decision here is REJECT, not "silently fall back to page 1". A silent
   * fallback re-serves page 1 in the middle of an infinite scroll: the user
   * sees duplicated rows and the client never learns its cursor was discarded.
   */
  it.each([
    ['a finite but unrepresentable timestamp', '100000000000000000000_507f1f77bcf86cd799439011'],
    ['an id half that is not an ObjectId', '1700000000000_notanoid'],
    ['a non-numeric timestamp half', 'abc_507f1f77bcf86cd799439011'],
    ['a timestamp one past the maximum Date', '8640000000000001_507f1f77bcf86cd799439011'],
  ])('rejects %s rather than querying Mongo with it', async (_label, cursor) => {
    const { listAudioAssets } = await import('~/server/functions/audio');
    await expect(listAudioAssets({ data: { limit: 50, cursor }, userId: 'u1' })).rejects.toThrow(
      /cursor/i
    );
    // The point is that no query was issued at all — not that the query it
    // issued happened to be harmless.
    expect(find).not.toHaveBeenCalled();
  });

  /**
   * A malformed cursor is the caller's mistake, so it must not author a
   * GlitchTip issue. One bad cursor per request would otherwise be one error
   * report per request.
   */
  it('does not report a malformed cursor to GlitchTip', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    const { listAudioAssets } = await import('~/server/functions/audio');
    await expect(
      listAudioAssets({ data: { limit: 50, cursor: '1700000000000_notanoid' }, userId: 'u1' })
    ).rejects.toThrow();
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });

  /**
   * Telemetry identity: the audio functions used to tag the Mongo `_id` while
   * every other server function tags the OAuth provider id, so one human
   * appeared in GlitchTip/Umami as two people. `sessionUserId` is that provider
   * id and must win when present.
   */
  it('tags telemetry with the session identity, not the Mongo id', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    lean.mockRejectedValue(new Error('atlas is down'));
    const { listAudioAssets } = await import('~/server/functions/audio');
    await expect(
      listAudioAssets({ data: { limit: 50 }, userId: 'mongo-id-1', sessionUserId: 'provider-id-1' })
    ).rejects.toThrow('atlas is down');
    expect(vi.mocked(serverCaptureException).mock.calls[0][1]).toBe('provider-id-1');
  });
});
