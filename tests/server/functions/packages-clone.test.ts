import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

const findOneLean = vi.fn();
const findOne = vi.fn((_query?: Record<string, unknown>) => ({ lean: findOneLean }));
const create = vi.fn();

vi.mock('~/server/db/models/AudioPackage', () => ({
  AudioPackage: { findOne, create },
}));

/**
 * A system package (`ownerId: null`) with TWO items and a mood whose states
 * reference them in REVERSED order. This is deliberate: a fixture with one
 * item passes even if the implementation renumbers ids (any id "matches"
 * positionally when there's only one), and a fixture whose states list
 * mirrors the items list in the same order passes even if the implementation
 * maps `states[i]` to `items[i]` by position instead of by id. Reversing the
 * order is what forces a correct implementation to preserve the actual `id`
 * strings rather than just some internally-consistent pairing.
 */
const sourceDoc = () => ({
  _id: 'sys1',
  ownerId: null,
  name: 'Tavern',
  description: 'A cozy tavern',
  items: [
    {
      id: 'i1',
      assetId: 'a1',
      label: 'Lute',
      volume: 0.5,
      fadeSeconds: 3,
      loop: true,
      randomIntervalMin: 10,
      randomIntervalMax: 20,
      volumeJitter: 0.1,
      panJitter: 0.2,
      sortIndex: 0,
    },
    {
      id: 'i2',
      assetId: 'a2',
      label: 'Crowd',
      volume: 0.8,
      fadeSeconds: 1,
      loop: false,
      sortIndex: 1,
    },
  ],
  moods: [
    {
      id: 'm1',
      name: 'Busy',
      states: [
        { itemId: 'i2', playing: true },
        { itemId: 'i1', playing: false },
      ],
    },
  ],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('clonePackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOneLean.mockResolvedValue(sourceDoc());
    create.mockResolvedValue({
      toObject: () => ({ ...sourceDoc(), _id: 'clone1', ownerId: 'u1' }),
    });
  });

  it('clones a system package into the caller, preserving mood->item references', async () => {
    const { clonePackage } = await import('~/server/functions/packages');
    await clonePackage({ data: { id: 'sys1' }, userId: 'u1' });

    const created = vi.mocked(create).mock.calls[0][0] as {
      ownerId: unknown;
      items: { id: string }[];
      moods: { states: { itemId: string }[] }[];
    };
    expect(created.ownerId).toBe('u1');

    // Ids preserved verbatim, not just internally consistent.
    expect(created.items[0].id).toBe('i1');
    expect(created.items[1].id).toBe('i2');

    // The first state references the SECOND item — a positional (index-based)
    // mapping of states-to-items would get this backwards.
    expect(created.moods[0].states[0].itemId).toBe('i2');
    expect(created.moods[0].states[0].itemId).toBe(created.items[1].id);
    expect(created.moods[0].states[1].itemId).toBe('i1');
    expect(created.moods[0].states[1].itemId).toBe(created.items[0].id);
  });

  it('reads the source through the visibility filter, scoped to the requested id', async () => {
    const { clonePackage } = await import('~/server/functions/packages');
    await clonePackage({ data: { id: 'sys1' }, userId: 'u1' });
    expect(vi.mocked(findOne).mock.calls[0][0]).toEqual({
      _id: 'sys1',
      $or: [{ ownerId: 'u1' }, { ownerId: null }],
    });
  });

  it('does not carry the source _id, ownerId, createdAt, or updatedAt into the created document', async () => {
    const { clonePackage } = await import('~/server/functions/packages');
    await clonePackage({ data: { id: 'sys1' }, userId: 'u1' });
    const created = vi.mocked(create).mock.calls[0][0] as Record<string, unknown>;
    expect(created).not.toHaveProperty('_id');
    expect(created).not.toHaveProperty('createdAt');
    expect(created).not.toHaveProperty('updatedAt');
    expect(created).not.toHaveProperty('__v');
    expect(created.ownerId).toBe('u1');
  });

  it('names the clone after the source when no name is given', async () => {
    const { clonePackage } = await import('~/server/functions/packages');
    await clonePackage({ data: { id: 'sys1' }, userId: 'u1' });
    const created = vi.mocked(create).mock.calls[0][0] as { name: string };
    expect(created.name).toBe('Tavern');
  });

  it('renames the clone when a name is given', async () => {
    const { clonePackage } = await import('~/server/functions/packages');
    await clonePackage({ data: { id: 'sys1', name: 'My Tavern' }, userId: 'u1' });
    const created = vi.mocked(create).mock.calls[0][0] as { name: string };
    expect(created.name).toBe('My Tavern');
  });

  it('carries optional item fields through unchanged, so the serializer boundary is not skipped for the copy', async () => {
    const { clonePackage } = await import('~/server/functions/packages');
    const res = await clonePackage({ data: { id: 'sys1' }, userId: 'u1' });
    const item = res.items[0];
    expect(item.label).toBe('Lute');
    expect(item.randomIntervalMin).toBe(10);
    expect(item.randomIntervalMax).toBe(20);
    expect(item.volumeJitter).toBe(0.1);
    expect(item.panJitter).toBe(0.2);
  });

  it('returns a package owned by the caller', async () => {
    const { clonePackage } = await import('~/server/functions/packages');
    const res = await clonePackage({ data: { id: 'sys1' }, userId: 'u1' });
    expect(res.ownerId).toBe('u1');
  });

  it('throws "not found" when the source is invisible to the caller, and does not report to GlitchTip', async () => {
    const { serverCaptureException } = await import('~/server/utils/telemetry');
    findOneLean.mockResolvedValue(null);
    const { clonePackage } = await import('~/server/functions/packages');
    await expect(clonePackage({ data: { id: 'sys1' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
    expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
  });

  it('tags telemetry with the session identity, not the Mongo id', async () => {
    const { serverCaptureEvent } = await import('~/server/utils/telemetry');
    const { clonePackage } = await import('~/server/functions/packages');
    await clonePackage({
      data: { id: 'sys1' },
      userId: 'mongo-id-1',
      sessionUserId: 'provider-id-1',
    });
    expect(vi.mocked(serverCaptureEvent).mock.calls[0][0]).toBe('provider-id-1');
  });
});
