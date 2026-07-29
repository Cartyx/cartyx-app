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
      loudnessLufs: null,
      lastError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    lean.mockResolvedValue(rows);
    const { listAudioAssets } = await import('~/server/functions/audio');
    const r = await listAudioAssets({ data: { limit: 2 }, userId: 'u1' });
    expect(r.items).toHaveLength(2);
    expect(r.nextCursor).toBe('a1');
  });
});
