import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// R2 / S3 mock — matches the pattern used in tests/server/functions/uploads.test.ts
// ---------------------------------------------------------------------------

const { MockS3Client, MockListObjectsV2Command, MockDeleteObjectCommand, send } = vi.hoisted(() => {
  const send = vi.fn();
  function MockS3Client(this: { send: typeof send }) {
    this.send = send;
  }
  function MockListObjectsV2Command(this: Record<string, unknown>, input: unknown) {
    Object.assign(this, input as object);
  }
  function MockDeleteObjectCommand(this: Record<string, unknown>, input: unknown) {
    Object.assign(this, input as object);
  }
  return { MockS3Client, MockListObjectsV2Command, MockDeleteObjectCommand, send };
});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: MockS3Client,
  ListObjectsV2Command: MockListObjectsV2Command,
  DeleteObjectCommand: MockDeleteObjectCommand,
}));

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

vi.mock('~/server/db/models/User', () => ({ User: { findOne: vi.fn() } }));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findById: vi.fn(), find: vi.fn() },
}));
vi.mock('~/server/db/models/Location', () => ({ Location: { find: vi.fn() } }));
vi.mock('~/server/db/models/Character', () => ({ Character: { find: vi.fn() } }));
vi.mock('~/server/db/models/Player', () => ({ Player: { find: vi.fn() } }));
vi.mock('~/server/db/models/AudioAsset', () => ({ AudioAsset: { find: vi.fn() } }));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Location } from '~/server/db/models/Location';
import { Character } from '~/server/db/models/Character';
import { Player } from '~/server/db/models/Player';
import { AudioAsset } from '~/server/db/models/AudioAsset';

// ---------------------------------------------------------------------------
// Mongoose cursor mock helper — reproduces the `.find(...).lean().cursor()`
// chain used by collectInUseKeys for Location/AudioAsset, and the
// `.find(...).lean()` (then `.cursor()` later) chain used for
// Character/Player/Campaign.
// ---------------------------------------------------------------------------

function leanCursorChain<T>(docs: T[]) {
  return {
    lean: () => ({
      cursor: () => ({
        [Symbol.asyncIterator]: async function* () {
          for (const d of docs) yield d;
        },
      }),
    }),
  };
}

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'Test GM',
  email: 'gm@example.com',
  avatar: null,
  role: 'gm',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};

const originalEnv = { ...process.env };

function setupR2Objects(byPrefix: Record<string, Array<{ Key: string; Size?: number }>>) {
  send.mockImplementation((cmd: unknown) => {
    if (cmd instanceof MockListObjectsV2Command) {
      const prefix = (cmd as { Prefix: string }).Prefix;
      const contents = (byPrefix[prefix] ?? []).map((o) => ({
        Key: o.Key,
        Size: o.Size ?? 0,
        LastModified: new Date('2026-01-01T00:00:00Z'),
      }));
      return Promise.resolve({ Contents: contents, IsTruncated: false });
    }
    if (cmd instanceof MockDeleteObjectCommand) {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  process.env.R2_ACCOUNT_ID = 'test-account-id';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET = 'test-bucket';
  process.env.CDN_URL = 'https://cdn.example.com';

  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue({ _id: 'dbuser1' } as never);
  vi.mocked(Campaign.findById).mockResolvedValue({
    _id: 'c1',
    gameMasterId: 'dbuser1',
    members: [],
  } as never);

  // Default: nothing referenced anywhere, no R2 objects. Individual tests
  // override what they need.
  vi.mocked(Location.find).mockReturnValue(leanCursorChain([]) as never);
  vi.mocked(Character.find).mockReturnValue(leanCursorChain([]) as never);
  vi.mocked(Player.find).mockReturnValue(leanCursorChain([]) as never);
  vi.mocked(Campaign.find).mockReturnValue(leanCursorChain([]) as never);
  vi.mocked(AudioAsset.find).mockReturnValue(leanCursorChain([]) as never);
  setupR2Objects({});
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('TRACKED_PREFIXES', () => {
  it('includes the audio upload prefix', async () => {
    const mod = await import('~/server/functions/cleanup');
    const prefixes = (mod as unknown as { TRACKED_PREFIXES: string[] }).TRACKED_PREFIXES;
    expect(prefixes).toContain('uploads/audio/');
  });
});

describe('scanOrphanImages — audio', () => {
  it('treats every key an AudioAsset references as in-use, and only reports the truly unreferenced audio key as an orphan', async () => {
    vi.mocked(AudioAsset.find).mockReturnValue(
      leanCursorChain([
        {
          sourceKey: 'uploads/audio/a1/source.wav',
          renditions: {
            opus: { key: 'uploads/audio/a1/opus.ogg' },
            aac: { key: 'uploads/audio/a1/aac.m4a' },
          },
        },
      ]) as never
    );

    setupR2Objects({
      'uploads/locations/': [],
      'uploads/characters/': [],
      'uploads/players/': [],
      'uploads/campaigns/': [],
      'uploads/audio/': [
        { Key: 'uploads/audio/a1/source.wav', Size: 1000 },
        { Key: 'uploads/audio/a1/opus.ogg', Size: 200 },
        { Key: 'uploads/audio/a1/aac.m4a', Size: 300 },
        { Key: 'uploads/audio/orphan/unused.wav', Size: 50 },
      ],
    });

    const { scanOrphanImages } = await import('~/server/functions/cleanup');
    const result = await scanOrphanImages({ data: { campaignId: 'c1' } });

    expect(result.orphans.map((o) => o.imageKey)).toEqual(['uploads/audio/orphan/unused.wav']);
    expect(result.scannedKeyCount).toBe(4);
    expect(result.inUseKeyCount).toBe(3);
  });

  it('collects onceRenditions keys too, even though phase 1 never writes them', async () => {
    vi.mocked(AudioAsset.find).mockReturnValue(
      leanCursorChain([
        {
          sourceKey: 'uploads/audio/a2/source.wav',
          onceRenditions: {
            opus: { key: 'uploads/audio/a2/once-opus.ogg' },
            aac: { key: 'uploads/audio/a2/once-aac.m4a' },
          },
        },
      ]) as never
    );

    setupR2Objects({
      'uploads/locations/': [],
      'uploads/characters/': [],
      'uploads/players/': [],
      'uploads/campaigns/': [],
      'uploads/audio/': [
        { Key: 'uploads/audio/a2/source.wav', Size: 1000 },
        { Key: 'uploads/audio/a2/once-opus.ogg', Size: 200 },
        { Key: 'uploads/audio/a2/once-aac.m4a', Size: 300 },
      ],
    });

    const { scanOrphanImages } = await import('~/server/functions/cleanup');
    const result = await scanOrphanImages({ data: { campaignId: 'c1' } });

    expect(result.orphans).toEqual([]);
    expect(result.inUseKeyCount).toBe(3);
  });
});
