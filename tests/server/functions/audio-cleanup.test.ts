import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
}));

// Mirrors `AudioAsset.find(filter, projection).lean()`.
const lean = vi.fn();
const find = vi.fn(() => ({ lean }));
vi.mock('~/server/db/models/AudioAsset', () => ({ AudioAsset: { find } }));

// `lookupAudioStoragePrefix` is NOT mocked — `~/server/functions/audio-storage`
// runs for real (including `audioUserRoot`'s shape validation) against a mocked
// User model, so a scan that resolved the wrong namespace would fail here.
const userLean = vi.fn();
const userSelect = vi.fn(() => ({ lean: userLean }));
const findById = vi.fn(() => ({ select: userSelect }));
const findOneAndUpdate = vi.fn();
vi.mock('~/server/db/models/User', () => ({ User: { findById, findOneAndUpdate } }));

import { serverCaptureEvent } from '~/server/utils/telemetry';

const OWNER = '507f1f77bcf86cd799439011';
const ASSET_A = '507f1f77bcf86cd799439aaa';

/** The caller's namespace, and somebody else's. Both are well-formed prefixes. */
const PREFIX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER_PREFIX = '0123456789abcdef0123456789abcdef';
const ROOT = `uploads/audio/${PREFIX}/`;
const OTHER_ROOT = `uploads/audio/${OTHER_PREFIX}/`;

/** Old enough to clear AUDIO_ORPHAN_MIN_AGE_MS. */
const OLD = new Date('2026-01-01T00:00:00.000Z');

const originalEnv = { ...process.env };

type Listed = { Key: string; Size: number; LastModified: Date };

/** One page of listing results, then whatever DeleteObject asks for. */
function r2Lists(contents: Listed[], extra: Record<string, unknown> = {}) {
  send.mockImplementation((cmd: unknown) => {
    if (cmd instanceof ListObjectsV2Command) {
      return Promise.resolve({ Contents: contents, IsTruncated: false, ...extra });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.R2_ACCOUNT_ID = 'a';
  process.env.R2_ACCESS_KEY_ID = 'b';
  process.env.R2_SECRET_ACCESS_KEY = 'c';
  process.env.R2_BUCKET = 'd';
  process.env.CDN_URL = 'https://cdn.test';
  lean.mockResolvedValue([]);
  userLean.mockResolvedValue({ audioStoragePrefix: PREFIX });
  r2Lists([]);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('scanOrphanAudio — ownership scoping', () => {
  /**
   * The single most important property of this module. Owner scoping is a
   * property of the KEY LAYOUT: every object a user owns lives under
   * `uploads/audio/<their prefix>/`, so the listing itself cannot return
   * anybody else's object. A test that only checked the result would pass
   * against a bucket-wide listing that happened to filter correctly — so this
   * asserts on the request actually sent to R2.
   */
  it('lists exactly the caller’s namespace and never a wider prefix', async () => {
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    await scanOrphanAudio({ userId: OWNER });

    const lists = send.mock.calls
      .map((c) => c[0])
      .filter((c): c is ListObjectsV2Command => c instanceof ListObjectsV2Command);
    expect(lists).toHaveLength(1);
    expect(lists[0].input.Prefix).toBe(ROOT);
    // Nothing else is issued: no bucket-wide list, no probing of derived keys.
    expect(send.mock.calls).toHaveLength(1);
  });

  /**
   * The guard that makes "cannot construct or return a key outside the
   * caller's prefix" true rather than merely intended. R2 is made to answer
   * with a perfectly well-formed key inside ANOTHER user's namespace — the
   * shape a broken prefix, a mis-parameterized command, or a compromised
   * client would produce. It must not reach the result, and it must not become
   * deletable.
   */
  it('drops a returned key outside the caller’s prefix instead of reporting it', async () => {
    r2Lists([
      { Key: `${ROOT}1700000000000-aaaa.wav`, Size: 10, LastModified: OLD },
      { Key: `${OTHER_ROOT}1700000000000-bbbb.wav`, Size: 20, LastModified: OLD },
      { Key: 'uploads/audio/1700000000000-legacy.wav', Size: 30, LastModified: OLD },
    ]);

    const { scanOrphanAudio, deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });
    expect(res.orphans.map((o) => o.key)).toEqual([`${ROOT}1700000000000-aaaa.wav`]);

    const del = await deleteOrphanAudio({
      data: { keys: [`${OTHER_ROOT}1700000000000-bbbb.wav`] },
      userId: OWNER,
    });
    expect(del.deleted).toEqual([]);
    expect(send.mock.calls.some((c) => c[0] instanceof DeleteObjectCommand)).toBe(false);
  });

  /**
   * The gap the per-user prefix exists to close. `deleteAudioAsset` removes the
   * row even when the R2 delete fails, so the source key's only record is gone;
   * under the old flat layout nothing could ever name that object again. Here
   * the listing is the record, so it is reclaimable.
   */
  it('reports a stranded SOURCE object whose asset row no longer exists', async () => {
    r2Lists([{ Key: `${ROOT}1700000000000-aaaa.wav`, Size: 2048, LastModified: OLD }]);
    lean.mockResolvedValue([]);

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });

    expect(res.orphans).toEqual([
      {
        key: `${ROOT}1700000000000-aaaa.wav`,
        sizeBytes: 2048,
        lastModified: OLD.toISOString(),
      },
    ]);
    expect(res.truncated).toBe(false);
    expect(res.scannedObjectCount).toBe(1);
  });

  it('reports a stranded rendition the row never recorded', async () => {
    r2Lists([
      { Key: `${ROOT}1700000000000-aaaa.wav`, Size: 100, LastModified: OLD },
      { Key: `${ROOT}renditions/${ASSET_A}.opus`, Size: 2048, LastModified: OLD },
    ]);
    lean.mockResolvedValue([{ sourceKey: `${ROOT}1700000000000-aaaa.wav` }]);

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });
    expect(res.orphans.map((o) => o.key)).toEqual([`${ROOT}renditions/${ASSET_A}.opus`]);
  });

  /**
   * A key a row DOES reference is live: the asset plays it. Offering to delete
   * it would break the user's library, so every recorded key — including the
   * phase-2 `onceRenditions` variants nothing writes yet — is excluded.
   */
  it('never offers an object a row still references, including onceRenditions', async () => {
    r2Lists([
      { Key: `${ROOT}src.wav`, Size: 1, LastModified: OLD },
      { Key: `${ROOT}renditions/${ASSET_A}.opus`, Size: 2, LastModified: OLD },
      { Key: `${ROOT}renditions/${ASSET_A}.once.opus`, Size: 3, LastModified: OLD },
      { Key: `${ROOT}renditions/orphan.m4a`, Size: 4, LastModified: OLD },
    ]);
    lean.mockResolvedValue([
      {
        sourceKey: `${ROOT}src.wav`,
        renditions: { opus: { key: `${ROOT}renditions/${ASSET_A}.opus` } },
        onceRenditions: { opus: { key: `${ROOT}renditions/${ASSET_A}.once.opus` } },
      },
    ]);

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });
    expect(res.orphans.map((o) => o.key)).toEqual([`${ROOT}renditions/orphan.m4a`]);
  });

  /** The reference lookup is scoped to the caller as well as to the listed keys. */
  it('scopes the reference lookup to the caller and to the listed keys', async () => {
    r2Lists([{ Key: `${ROOT}src.wav`, Size: 1, LastModified: OLD }]);
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    await scanOrphanAudio({ userId: OWNER });

    const filter = (find.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(filter).toMatchObject({ ownerId: OWNER });
    expect(JSON.stringify(filter)).toContain(`${ROOT}src.wav`);
  });

  /**
   * The genuine race: the worker PUTs both renditions and only afterwards
   * writes the keys onto the row, so for a short window a live object is
   * unreferenced. Without an age floor a scan landing in that window calls an
   * in-flight rendition an orphan and offers to delete it.
   */
  it('ignores an object younger than the minimum age', async () => {
    r2Lists([{ Key: `${ROOT}renditions/${ASSET_A}.opus`, Size: 2048, LastModified: new Date() }]);
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });
    expect(res.orphans).toEqual([]);
  });

  /**
   * The campaign image scanner's `listAllR2Objects` stopped after MAX_PAGES and
   * threw the continuation token away, so a large account silently got a
   * partial listing. This one follows the token.
   */
  it('follows the continuation token instead of stopping after one page', async () => {
    send.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        if (!cmd.input.ContinuationToken) {
          return Promise.resolve({
            Contents: [{ Key: `${ROOT}page1.wav`, Size: 1, LastModified: OLD }],
            IsTruncated: true,
            NextContinuationToken: 'tok',
          });
        }
        return Promise.resolve({
          Contents: [{ Key: `${ROOT}page2.wav`, Size: 2, LastModified: OLD }],
          IsTruncated: false,
        });
      }
      return Promise.resolve({});
    });

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });

    expect(res.orphans.map((o) => o.key)).toEqual([`${ROOT}page1.wav`, `${ROOT}page2.wav`]);
    expect(res.truncated).toBe(false);
    expect(res.scannedObjectCount).toBe(2);
  });

  /**
   * Past the cap the scan is PARTIAL, and says so. The campaign scanner
   * returned "no orphans found" in this situation, which is a lie the operator
   * has no way to detect.
   */
  it('reports truncation when the namespace holds more objects than one pass covers', async () => {
    const { AUDIO_ORPHAN_SCAN_MAX_KEYS } = await import('~/server/functions/audio-cleanup');
    r2Lists(
      Array.from({ length: AUDIO_ORPHAN_SCAN_MAX_KEYS + 1 }, (_, i) => ({
        Key: `${ROOT}obj-${i}.wav`,
        Size: 1,
        LastModified: OLD,
      }))
    );

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });

    expect(res.truncated).toBe(true);
    expect(res.scannedObjectCount).toBe(AUDIO_ORPHAN_SCAN_MAX_KEYS);
    expect(res.orphans).toHaveLength(AUDIO_ORPHAN_SCAN_MAX_KEYS);
  });

  /**
   * A user who has never uploaded owns no namespace. The scan must answer
   * "nothing" WITHOUT minting one — a read-only action that writes to the user
   * document would hand a prefix to every account that ever clicked Scan.
   */
  it('returns an empty scan without touching R2 or minting a prefix', async () => {
    userLean.mockResolvedValue({ audioStoragePrefix: null });
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });

    expect(res).toEqual({
      orphans: [],
      scannedObjectCount: 0,
      truncated: false,
      r2Disabled: false,
    });
    expect(send).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reports r2Disabled instead of throwing when storage is not configured', async () => {
    delete process.env.R2_BUCKET;
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });
    expect(res).toEqual({
      orphans: [],
      scannedObjectCount: 0,
      truncated: false,
      r2Disabled: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('tags its Umami event with the session identity, not the Mongo id', async () => {
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    await scanOrphanAudio({ userId: OWNER, sessionUserId: 'provider-id-1' });
    expect(vi.mocked(serverCaptureEvent).mock.calls[0][0]).toBe('provider-id-1');
  });
});

describe('deleteOrphanAudio', () => {
  it('deletes a key the fresh server-side scan confirms is reclaimable', async () => {
    r2Lists([{ Key: `${ROOT}renditions/${ASSET_A}.opus`, Size: 2048, LastModified: OLD }]);

    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await deleteOrphanAudio({
      data: { keys: [`${ROOT}renditions/${ASSET_A}.opus`] },
      userId: OWNER,
    });

    expect(res.deleted).toEqual([`${ROOT}renditions/${ASSET_A}.opus`]);
    const deletes = send.mock.calls
      .map((c) => c[0])
      .filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand);
    expect(deletes.map((d) => d.input.Key)).toEqual([`${ROOT}renditions/${ASSET_A}.opus`]);
  });

  /**
   * The cross-tenant guard, from the other direction: the key is real, it
   * exists, and it is genuinely unreferenced — it just belongs to somebody
   * else's namespace. The caller's own scan is the only set a delete can draw
   * from, so it is refused with no DeleteObject issued.
   */
  it("refuses a real, unreferenced key in another user's namespace", async () => {
    send.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        // R2 answers honestly for whichever prefix it is asked about.
        const prefix = cmd.input.Prefix ?? '';
        const all: Listed[] = [
          { Key: `${ROOT}mine.wav`, Size: 1, LastModified: OLD },
          { Key: `${OTHER_ROOT}theirs.wav`, Size: 2, LastModified: OLD },
        ];
        return Promise.resolve({
          Contents: all.filter((o) => o.Key.startsWith(prefix)),
          IsTruncated: false,
        });
      }
      return Promise.resolve({});
    });

    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await deleteOrphanAudio({
      data: { keys: [`${OTHER_ROOT}theirs.wav`] },
      userId: OWNER,
    });

    expect(res.deleted).toEqual([]);
    expect(res.failed).toEqual([
      {
        key: `${OTHER_ROOT}theirs.wav`,
        error: 'Not a reclaimable object for this account — re-scan',
      },
    ]);
    expect(send.mock.calls.some((c) => c[0] instanceof DeleteObjectCommand)).toBe(false);
  });

  it('refuses a key outside the audio namespace entirely', async () => {
    r2Lists([{ Key: `${ROOT}mine.wav`, Size: 1, LastModified: OLD }]);
    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await deleteOrphanAudio({
      data: { keys: ['uploads/campaigns/somebody-elses-cover.png'] },
      userId: OWNER,
    });
    expect(res.deleted).toEqual([]);
    expect(send.mock.calls.some((c) => c[0] instanceof DeleteObjectCommand)).toBe(false);
  });

  /**
   * A key the user scanned an hour ago whose row has since recorded it (a
   * requeued transcode finally succeeded) is live again. Re-deriving on the
   * delete request rather than trusting the scan's output is what catches that.
   */
  it('refuses a key that became referenced between the scan and the delete', async () => {
    r2Lists([{ Key: `${ROOT}renditions/${ASSET_A}.opus`, Size: 2048, LastModified: OLD }]);
    lean.mockResolvedValue([
      { renditions: { opus: { key: `${ROOT}renditions/${ASSET_A}.opus` } } },
    ]);

    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await deleteOrphanAudio({
      data: { keys: [`${ROOT}renditions/${ASSET_A}.opus`] },
      userId: OWNER,
    });
    expect(res.deleted).toEqual([]);
    expect(res.failed).toHaveLength(1);
  });
});
