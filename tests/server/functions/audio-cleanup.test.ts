import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));

const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
}));

// Mirrors `AudioAsset.find(filter, projection).sort(...).limit(...).lean()`.
const lean = vi.fn();
const limit = vi.fn(() => ({ lean }));
const sort = vi.fn(() => ({ limit }));
const find = vi.fn(() => ({ sort }));
vi.mock('~/server/db/models/AudioAsset', () => ({ AudioAsset: { find } }));

import { serverCaptureEvent } from '~/server/utils/telemetry';

const OWNER = '507f1f77bcf86cd799439011';
const ASSET_A = '507f1f77bcf86cd799439aaa';
const ASSET_B = '507f1f77bcf86cd799439bbb';

/** Old enough to clear AUDIO_ORPHAN_MIN_AGE_MS. */
const OLD = new Date('2026-01-01T00:00:00.000Z');

const originalEnv = { ...process.env };

/**
 * HeadObject answers for the given keys; anything else 404s, exactly like R2
 * does for a key the worker never wrote.
 */
function r2Has(objects: Record<string, { size: number; lastModified: Date }>) {
  send.mockImplementation((cmd: unknown) => {
    if (cmd instanceof HeadObjectCommand) {
      const key = (cmd.input as { Key: string }).Key;
      const obj = objects[key];
      if (!obj) return Promise.reject(new Error('NotFound'));
      return Promise.resolve({ ContentLength: obj.size, LastModified: obj.lastModified });
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
  r2Has({});
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('scanOrphanAudio — ownership scoping', () => {
  /**
   * The single most important property of this module. R2 audio keys carry no
   * owner component, so a bucket listing can never be attributed; this path
   * must therefore derive every candidate key from the caller's own rows and
   * must never issue a List at all. A test that only checked the *result* would
   * pass against a bucket-wide listing that happened to filter correctly — so
   * this asserts on the query and on the commands actually issued.
   */
  it('scopes the row query to the caller and never lists the bucket', async () => {
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    await scanOrphanAudio({ userId: OWNER });

    expect((find.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({
      ownerId: OWNER,
    });
    // Every command issued is a HeadObject for a key derived above. No
    // ListObjectsV2 — there is no such thing as an owner-scoped listing here.
    for (const call of send.mock.calls) {
      expect(call[0]).toBeInstanceOf(HeadObjectCommand);
    }
  });

  /**
   * The keys are reconstructed from the asset id using the worker's
   * deterministic rendition namespace (`uploads/audio/renditions/<id>.opus|.m4a`
   * — audio-worker/src/process.ts). Another user's object cannot be filtered
   * out incorrectly because it is never named in the first place.
   */
  it('asks R2 only about keys derived from the caller-owned rows', async () => {
    lean.mockResolvedValue([{ _id: ASSET_A, sourceKey: 'uploads/audio/1-a.wav' }]);
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    await scanOrphanAudio({ userId: OWNER });

    const asked = send.mock.calls.map((c) => (c[0] as HeadObjectCommand).input.Key);
    expect(asked).toEqual([
      `uploads/audio/renditions/${ASSET_A}.opus`,
      `uploads/audio/renditions/${ASSET_A}.m4a`,
    ]);
  });

  it('reports a stranded rendition the row never recorded', async () => {
    lean.mockResolvedValue([{ _id: ASSET_A, sourceKey: 'uploads/audio/1-a.wav' }]);
    r2Has({
      [`uploads/audio/renditions/${ASSET_A}.opus`]: { size: 2048, lastModified: OLD },
    });

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });

    expect(res.orphans).toEqual([
      {
        key: `uploads/audio/renditions/${ASSET_A}.opus`,
        sizeBytes: 2048,
        lastModified: OLD.toISOString(),
      },
    ]);
    expect(res.truncated).toBe(false);
    expect(res.scannedAssetCount).toBe(1);
  });

  /**
   * A key the row DOES reference is live: the asset plays it. Offering to
   * delete it would break the user's library, so the recorded keys form the
   * in-use set and are excluded even though they sit in the same namespace.
   */
  it('never offers a rendition the row still references', async () => {
    lean.mockResolvedValue([
      {
        _id: ASSET_A,
        sourceKey: 'uploads/audio/1-a.wav',
        renditions: { opus: { key: `uploads/audio/renditions/${ASSET_A}.opus` } },
      },
    ]);
    r2Has({
      [`uploads/audio/renditions/${ASSET_A}.opus`]: { size: 2048, lastModified: OLD },
      [`uploads/audio/renditions/${ASSET_A}.m4a`]: { size: 3072, lastModified: OLD },
    });

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });

    expect(res.orphans.map((o) => o.key)).toEqual([`uploads/audio/renditions/${ASSET_A}.m4a`]);
  });

  /**
   * The genuine race: the worker PUTs both renditions and only afterwards
   * writes the keys onto the row, so for a short window a live object is
   * unreferenced. Without an age floor a scan landing in that window calls an
   * in-flight rendition an orphan and offers to delete it.
   */
  it('ignores an object younger than the minimum age', async () => {
    lean.mockResolvedValue([{ _id: ASSET_A }]);
    r2Has({
      [`uploads/audio/renditions/${ASSET_A}.opus`]: { size: 2048, lastModified: new Date() },
    });

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });
    expect(res.orphans).toEqual([]);
  });

  /**
   * The campaign image scanner capped its listing at MAX_PAGES and discarded
   * `IsTruncated`, so an account past the cap got a partial scan presented as a
   * complete one. This path reports the partiality instead.
   */
  it('reports truncation when the caller has more candidate rows than one pass covers', async () => {
    const { AUDIO_ORPHAN_SCAN_MAX_ROWS } = await import('~/server/functions/audio-cleanup');
    lean.mockResolvedValue(
      Array.from({ length: AUDIO_ORPHAN_SCAN_MAX_ROWS + 1 }, (_, i) => ({
        _id: `5000000000000000000004${String(i).padStart(2, '0')}`,
      }))
    );

    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });

    expect(res.truncated).toBe(true);
    expect(res.scannedAssetCount).toBe(AUDIO_ORPHAN_SCAN_MAX_ROWS);
    // The overflow row exists purely to DETECT truncation; it must not be
    // inspected, or the cap would be off by one every time.
    expect(limit).toHaveBeenCalledWith(AUDIO_ORPHAN_SCAN_MAX_ROWS + 1);
  });

  it('reports r2Disabled instead of throwing when storage is not configured', async () => {
    delete process.env.R2_BUCKET;
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await scanOrphanAudio({ userId: OWNER });
    expect(res).toEqual({ orphans: [], scannedAssetCount: 0, truncated: false, r2Disabled: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('tags its Umami event with the session identity, not the Mongo id', async () => {
    const { scanOrphanAudio } = await import('~/server/functions/audio-cleanup');
    await scanOrphanAudio({ userId: OWNER, sessionUserId: 'provider-id-1' });
    expect(vi.mocked(serverCaptureEvent).mock.calls[0][0]).toBe('provider-id-1');
  });
});

describe('deleteOrphanAudio', () => {
  it('deletes a key the fresh server-side derivation confirms is reclaimable', async () => {
    lean.mockResolvedValue([{ _id: ASSET_A }]);
    r2Has({ [`uploads/audio/renditions/${ASSET_A}.opus`]: { size: 2048, lastModified: OLD } });

    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await deleteOrphanAudio({
      data: { keys: [`uploads/audio/renditions/${ASSET_A}.opus`] },
      userId: OWNER,
    });

    expect(res.deleted).toEqual([`uploads/audio/renditions/${ASSET_A}.opus`]);
    const deletes = send.mock.calls
      .map((c) => c[0])
      .filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand);
    expect(deletes.map((d) => d.input.Key)).toEqual([`uploads/audio/renditions/${ASSET_A}.opus`]);
  });

  /**
   * The cross-tenant guard. The client's key list is only a SELECTION within
   * the set the server derives from the caller's own rows on this request — it
   * is never the source of truth. A key belonging to somebody else (here,
   * another user's asset id, which is a perfectly well-formed key in the same
   * namespace) is refused without a DeleteObject ever being issued.
   */
  it("refuses a well-formed key that belongs to another user's asset", async () => {
    lean.mockResolvedValue([{ _id: ASSET_A }]);
    r2Has({
      [`uploads/audio/renditions/${ASSET_A}.opus`]: { size: 2048, lastModified: OLD },
      [`uploads/audio/renditions/${ASSET_B}.opus`]: { size: 4096, lastModified: OLD },
    });

    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await deleteOrphanAudio({
      data: { keys: [`uploads/audio/renditions/${ASSET_B}.opus`] },
      userId: OWNER,
    });

    expect(res.deleted).toEqual([]);
    expect(res.failed).toEqual([
      {
        key: `uploads/audio/renditions/${ASSET_B}.opus`,
        error: 'Not a reclaimable object for this account — re-scan',
      },
    ]);
    expect(send.mock.calls.some((c) => c[0] instanceof DeleteObjectCommand)).toBe(false);
  });

  it('refuses a key outside the audio rendition namespace entirely', async () => {
    lean.mockResolvedValue([{ _id: ASSET_A }]);
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
    lean.mockResolvedValue([
      { _id: ASSET_A, renditions: { opus: { key: `uploads/audio/renditions/${ASSET_A}.opus` } } },
    ]);
    r2Has({ [`uploads/audio/renditions/${ASSET_A}.opus`]: { size: 2048, lastModified: OLD } });

    const { deleteOrphanAudio } = await import('~/server/functions/audio-cleanup');
    const res = await deleteOrphanAudio({
      data: { keys: [`uploads/audio/renditions/${ASSET_A}.opus`] },
      userId: OWNER,
    });
    expect(res.deleted).toEqual([]);
    expect(res.failed).toHaveLength(1);
  });
});

describe('renditionKeysFor', () => {
  /**
   * Pins the cross-service contract. The worker builds these names in
   * audio-worker/src/process.ts (`const base = uploads/audio/renditions/${id}`)
   * and the two cannot import each other, so both sides carry a test on the
   * literal. If the worker's format changes without this one, the objects it
   * writes become permanently unreclaimable.
   */
  it('matches the worker rendition key format exactly', async () => {
    const { renditionKeysFor } = await import('~/server/functions/audio-cleanup');
    expect(renditionKeysFor(ASSET_A)).toEqual([
      `uploads/audio/renditions/${ASSET_A}.opus`,
      `uploads/audio/renditions/${ASSET_A}.m4a`,
    ]);
  });
});
