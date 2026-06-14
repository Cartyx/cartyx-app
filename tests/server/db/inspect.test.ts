import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  userMock,
  campaignMock,
  playerMock,
  sessionMock,
  gmScreenMock,
  noteMock,
  raceMock,
  mapMock,
  mapTokenMock,
  monsterMock,
} = vi.hoisted(() => {
  function make(
    name: string,
    collectionName: string,
    schemaIndexes: Array<[Record<string, unknown>, Record<string, unknown>]>
  ) {
    return {
      modelName: name,
      collection: { collectionName },
      schema: { indexes: vi.fn().mockReturnValue(schemaIndexes) },
      listIndexes: vi.fn().mockResolvedValue([{ key: { _id: 1 } }]),
      createCollection: vi.fn().mockResolvedValue(undefined),
      createIndexes: vi.fn().mockResolvedValue(undefined),
    };
  }

  return {
    userMock: make('User', 'users', [
      [{ email: 1 }, { unique: true, sparse: true }],
      [{ role: 1 }, {}],
    ]),
    campaignMock: make('Campaign', 'campaigns', [[{ 'members.userId': 1 }, {}]]),
    playerMock: make('Player', 'players', [
      [{ campaignId: 1, userId: 1 }, { unique: true }],
      [{ campaignId: 1 }, {}],
    ]),
    sessionMock: make('Session', 'sessions', [[{ campaignId: 1, number: -1 }, {}]]),
    gmScreenMock: make('GMScreen', 'gmscreen', [
      [{ campaignId: 1, tabOrder: 1 }, { unique: true }],
      [{ campaignId: 1, name: 1 }, { unique: true }],
    ]),
    noteMock: make('Note', 'notes', [
      [{ sessionId: 1 }, {}],
      [{ campaignId: 1 }, {}],
      [{ campaignId: 1, updatedAt: -1 }, {}],
      [{ createdBy: 1 }, {}],
      [{ tags: 1 }, {}],
      [{ isPublic: 1 }, {}],
      [{ title: 'text', note: 'text' }, {}],
    ]),
    raceMock: make('Race', 'races', [
      [{ campaignId: 1 }, {}],
      [{ campaignId: 1, updatedAt: -1 }, {}],
      [{ createdBy: 1 }, {}],
      [{ tags: 1 }, {}],
      [{ title: 'text', content: 'text' }, {}],
    ]),
    mapMock: make('Map', 'map', [
      [{ campaignId: 1, updatedAt: -1 }, {}],
      [{ campaignId: 1, locationId: 1 }, {}],
      [{ campaignId: 1, name: 1 }, { unique: true }],
    ]),
    mapTokenMock: make('MapToken', 'mapToken', [
      [{ mapId: 1 }, {}],
      [{ mapId: 1, sourceCollection: 1, sourceDocumentId: 1, instanceNumber: 1 }, { unique: true }],
    ]),
    monsterMock: make('Monster', 'monsters', [
      [{ campaignId: 1, updatedAt: -1 }, {}],
      [{ campaignId: 1, name: 1 }, {}],
      [{ campaignId: 1, tags: 1 }, {}],
      [{ campaignId: 1, sessionId: 1 }, {}],
      [{ campaignId: 1, 'cr.value': 1 }, {}],
      [{ name: 'text', 'features.description': 'text' }, {}],
    ]),
  };
});

vi.mock('~/server/db/models/User', () => ({ User: userMock }));
vi.mock('~/server/db/models/Campaign', () => ({ Campaign: campaignMock }));
vi.mock('~/server/db/models/Player', () => ({ Player: playerMock }));
vi.mock('~/server/db/models/Session', () => ({ Session: sessionMock }));
vi.mock('~/server/db/models/GMScreen', () => ({ GMScreen: gmScreenMock }));
vi.mock('~/server/db/models/Note', () => ({ Note: noteMock }));
vi.mock('~/server/db/models/Race', () => ({ Race: raceMock }));
vi.mock('~/server/db/models/Map', () => ({ Map: mapMock }));
vi.mock('~/server/db/models/MapToken', () => ({ MapToken: mapTokenMock }));
vi.mock('~/server/db/models/Monster', () => ({ Monster: monsterMock }));

import {
  inspectIndexes,
  syncCollectionsAndIndexes,
  ensureCollections,
  ALL_MODELS,
} from '~/server/db/inspect';

const allMocks = [
  userMock,
  campaignMock,
  playerMock,
  sessionMock,
  gmScreenMock,
  noteMock,
  raceMock,
  mapMock,
  mapTokenMock,
  monsterMock,
];

describe('ALL_MODELS', () => {
  it('contains all ten models', () => {
    expect(ALL_MODELS).toHaveLength(10);
  });

  // Regression: Session and GMScreen are included in bootstrap (#302)

  it('includes Session model for bootstrap collection/index sync', () => {
    const names = ALL_MODELS.map((m) => m.modelName);
    expect(names).toContain('Session');
  });

  it('includes GMScreen model for bootstrap collection/index sync', () => {
    const names = ALL_MODELS.map((m) => m.modelName);
    expect(names).toContain('GMScreen');
  });
});

describe('inspectIndexes', () => {
  beforeEach(() => {
    for (const m of allMocks) {
      m.listIndexes.mockReset().mockResolvedValue([{ key: { _id: 1 } }]);
    }
  });

  it('reports ok when all schema indexes exist in the database with matching options', async () => {
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 }, unique: true, sparse: true },
      { key: { role: 1 } },
    ]);
    campaignMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { 'members.userId': 1 } },
    ]);
    playerMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, userId: 1 }, unique: true },
      { key: { campaignId: 1 } },
    ]);
    sessionMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, number: -1 } },
    ]);
    gmScreenMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, tabOrder: 1 }, unique: true },
      { key: { campaignId: 1, name: 1 }, unique: true },
    ]);
    noteMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { sessionId: 1 } },
      { key: { campaignId: 1 } },
      { key: { campaignId: 1, updatedAt: -1 } },
      { key: { createdBy: 1 } },
      { key: { tags: 1 } },
      { key: { isPublic: 1 } },
      { key: { _fts: 'text', _ftsx: 1 } },
    ]);
    raceMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1 } },
      { key: { campaignId: 1, updatedAt: -1 } },
      { key: { createdBy: 1 } },
      { key: { tags: 1 } },
      { key: { _fts: 'text', _ftsx: 1 } },
    ]);
    mapMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, updatedAt: -1 } },
      { key: { campaignId: 1, locationId: 1 } },
      { key: { campaignId: 1, name: 1 }, unique: true },
    ]);
    mapTokenMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { mapId: 1 } },
      {
        key: { mapId: 1, sourceCollection: 1, sourceDocumentId: 1, instanceNumber: 1 },
        unique: true,
      },
    ]);
    monsterMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, updatedAt: -1 } },
      { key: { campaignId: 1, name: 1 } },
      { key: { campaignId: 1, tags: 1 } },
      { key: { campaignId: 1, sessionId: 1 } },
      { key: { campaignId: 1, 'cr.value': 1 } },
      { key: { _fts: 'text', _ftsx: 1 } },
    ]);

    const result = await inspectIndexes();
    expect(result.ok).toBe(true);
    expect(result.hasCriticalDrift).toBe(false);
    for (const diff of result.diffs) {
      expect(diff.missing).toHaveLength(0);
      expect(diff.extra).toHaveLength(0);
      expect(diff.optionMismatches).toHaveLength(0);
    }
  });

  it('reports missing indexes when DB has only _id', async () => {
    const result = await inspectIndexes();

    expect(result.ok).toBe(false);

    const userDiff = result.diffs.find((d) => d.model === 'User')!;
    expect(userDiff.missing).toHaveLength(2);

    const playerDiff = result.diffs.find((d) => d.model === 'Player')!;
    expect(playerDiff.missing).toHaveLength(2);
  });

  it('reports extra indexes not in the schema', async () => {
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 }, unique: true, sparse: true },
      { key: { role: 1 } },
      { key: { firstName: 1 } },
    ]);

    const result = await inspectIndexes();
    const userDiff = result.diffs.find((d) => d.model === 'User')!;
    expect(userDiff.extra).toHaveLength(1);
    expect(userDiff.extra[0]!.key).toEqual({ firstName: 1 });
  });

  it('reports ok=false when extra indexes exist even if none are missing', async () => {
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 }, unique: true, sparse: true },
      { key: { role: 1 } },
      { key: { firstName: 1 } },
    ]);
    campaignMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { 'members.userId': 1 } },
    ]);
    playerMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, userId: 1 }, unique: true },
      { key: { campaignId: 1 } },
    ]);
    sessionMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, number: -1 } },
    ]);
    gmScreenMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, tabOrder: 1 }, unique: true },
      { key: { campaignId: 1, name: 1 }, unique: true },
    ]);
    const noteSchemaIndexes = noteMock.schema.indexes();
    noteMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      ...noteSchemaIndexes.map(
        ([key, options]: [Record<string, number>, Record<string, unknown> | undefined]) => ({
          key,
          ...(options || {}),
        })
      ),
    ]);

    const result = await inspectIndexes();
    expect(result.ok).toBe(false);
  });

  it('detects option mismatches (e.g. unique expected but missing in DB)', async () => {
    // Schema expects { email: 1 } with unique: true, sparse: true
    // DB has { email: 1 } without unique or sparse
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 } },
      { key: { role: 1 } },
    ]);

    const result = await inspectIndexes();
    const userDiff = result.diffs.find((d) => d.model === 'User')!;
    expect(userDiff.missing).toHaveLength(0);
    expect(userDiff.optionMismatches).toHaveLength(1);
    expect(userDiff.optionMismatches[0]!.key).toEqual({ email: 1 });
    expect(userDiff.optionMismatches[0]!.expected).toEqual({ unique: true, sparse: true });
    expect(userDiff.optionMismatches[0]!.actual).toEqual({});
  });

  it('reports ok=false when option mismatches exist', async () => {
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 } }, // missing unique + sparse options
      { key: { role: 1 } },
    ]);
    campaignMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { 'members.userId': 1 } },
    ]);
    playerMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, userId: 1 }, unique: true },
      { key: { campaignId: 1 } },
    ]);
    sessionMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, number: -1 } },
    ]);
    gmScreenMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, tabOrder: 1 }, unique: true },
      { key: { campaignId: 1, name: 1 }, unique: true },
    ]);
    noteMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, createdAt: -1 } },
      { key: { campaignId: 1, sessionId: 1 } },
      { key: { _fts: 'text', _ftsx: 1 } },
    ]);

    const result = await inspectIndexes();
    expect(result.ok).toBe(false);
  });

  it('handles NamespaceNotFound (code 26) gracefully when collection does not exist', async () => {
    const nsError = Object.assign(new Error('ns not found'), { code: 26 });
    userMock.listIndexes.mockRejectedValue(nsError);

    const result = await inspectIndexes();

    const userDiff = result.diffs.find((d) => d.model === 'User')!;
    expect(userDiff.missing).toHaveLength(2);
    expect(userDiff.extra).toHaveLength(0);
    expect(userDiff.optionMismatches).toHaveLength(0);
  });

  it('rethrows non-NamespaceNotFound errors from listIndexes', async () => {
    const authError = Object.assign(new Error('not authorized'), { code: 13 });
    userMock.listIndexes.mockRejectedValue(authError);

    await expect(inspectIndexes()).rejects.toThrow('not authorized');
  });

  it('annotates missing indexes with governance severity', async () => {
    const result = await inspectIndexes();

    const userDiff = result.diffs.find((d) => d.model === 'User')!;
    const emailMissing = userDiff.missing.find((m) => 'email' in m.key);
    expect(emailMissing?.severity).toBe('critical');

    const roleMissing = userDiff.missing.find((m) => 'role' in m.key);
    expect(roleMissing?.severity).toBe('optional');
  });

  it('annotates option mismatches with governance severity', async () => {
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 } }, // missing unique + sparse
      { key: { role: 1 } },
    ]);

    const result = await inspectIndexes();
    const userDiff = result.diffs.find((d) => d.model === 'User')!;
    const emailMismatch = userDiff.optionMismatches.find((m) => 'email' in m.key);
    expect(emailMismatch?.severity).toBe('critical');
  });

  it('sets hasCriticalDrift=true when a critical index is missing', async () => {
    // All mocks default to only _id, so User email (critical) is missing
    const result = await inspectIndexes();
    expect(result.hasCriticalDrift).toBe(true);
  });

  it('sets hasCriticalDrift=false when only optional indexes have drift', async () => {
    // Provide all critical indexes, but leave some optional ones missing
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 }, unique: true, sparse: true },
      // role (optional) is missing
    ]);
    campaignMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      // members.userId (optional) is missing
    ]);
    playerMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, userId: 1 }, unique: true },
      // campaignId (optional) is missing
    ]);
    sessionMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      // both session indexes are optional and missing
    ]);
    gmScreenMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, tabOrder: 1 }, unique: true },
      { key: { campaignId: 1, name: 1 }, unique: true },
    ]);
    mapMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, name: 1 }, unique: true },
      // optional indexes (updatedAt, locationId) are missing
    ]);
    mapTokenMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      {
        key: { mapId: 1, sourceCollection: 1, sourceDocumentId: 1, instanceNumber: 1 },
        unique: true,
      },
      // optional mapId-only index is missing
    ]);

    const result = await inspectIndexes();
    expect(result.ok).toBe(false);
    expect(result.hasCriticalDrift).toBe(false);
  });

  it('sets hasCriticalDrift=true when a critical index has option mismatch', async () => {
    userMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { email: 1 } }, // missing unique+sparse = critical option mismatch
      { key: { role: 1 } },
    ]);
    campaignMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { 'members.userId': 1 } },
    ]);
    playerMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, userId: 1 }, unique: true },
      { key: { campaignId: 1 } },
    ]);
    sessionMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, number: -1 } },
    ]);
    gmScreenMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, tabOrder: 1 }, unique: true },
      { key: { campaignId: 1, name: 1 }, unique: true },
    ]);
    noteMock.listIndexes.mockResolvedValue([
      { key: { _id: 1 } },
      { key: { campaignId: 1, createdAt: -1 } },
      { key: { campaignId: 1, sessionId: 1 } },
      { key: { _fts: 'text', _ftsx: 1 } },
    ]);

    const result = await inspectIndexes();
    expect(result.hasCriticalDrift).toBe(true);
  });
});

describe('ensureCollections', () => {
  beforeEach(() => {
    for (const m of allMocks) {
      m.createCollection.mockClear();
      m.createIndexes.mockClear();
    }
  });

  it('creates all collections but does not create indexes', async () => {
    await ensureCollections();

    for (const m of allMocks) {
      expect(m.createCollection).toHaveBeenCalledTimes(1);
      expect(m.createIndexes).not.toHaveBeenCalled();
    }
  });
});

describe('syncCollectionsAndIndexes', () => {
  beforeEach(() => {
    for (const m of allMocks) {
      m.createCollection.mockClear();
      m.createIndexes.mockClear();
    }
  });

  it('creates all collections and indexes', async () => {
    await syncCollectionsAndIndexes();

    for (const m of allMocks) {
      expect(m.createCollection).toHaveBeenCalledTimes(1);
      expect(m.createIndexes).toHaveBeenCalledTimes(1);
    }
  });

  it('propagates errors from createCollection', async () => {
    userMock.createCollection.mockRejectedValueOnce(new Error('create failed'));
    await expect(syncCollectionsAndIndexes()).rejects.toThrow('create failed');
  });

  it('propagates errors from createIndexes', async () => {
    sessionMock.createIndexes.mockRejectedValueOnce(new Error('index failed'));
    await expect(syncCollectionsAndIndexes()).rejects.toThrow('index failed');
  });
});
