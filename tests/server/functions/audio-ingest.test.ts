import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: { create: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
  getAudioUploadUrl: vi.fn(async () => ({
    uploadUrl: 'https://signed/put',
    key: 'uploads/audio/1-a.wav',
    publicUrl: 'https://cdn.test/uploads/audio/1-a.wav',
  })),
}));

vi.mock('~/server/functions/audio-storage', () => ({
  resolveAudioStoragePrefix: vi.fn(async () => 'a1b2c3d4e5f60718293a4b5c6d7e8f90'),
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';

const VALID = {
  filename: 'storm.wav',
  contentType: 'audio/wav',
  bytes: 1024,
  kind: 'ambience' as const,
  environment: [],
  mood: [],
  tags: [],
};

describe('createAudioUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an asset in uploading status and returns the signed url', async () => {
    vi.mocked(AudioAsset.create).mockResolvedValue({ _id: 'a1' } as never);
    const { createAudioUpload } = await import('~/server/functions/audio');
    const r = await createAudioUpload({ data: VALID, userId: 'u1' });
    expect(r.assetId).toBe('a1');
    expect(r.uploadUrl).toBe('https://signed/put');
    const arg = vi.mocked(AudioAsset.create).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.status).toBe('uploading');
    expect(arg.title).toBe('storm');
  });

  it('hands the presign step the acting user id instead of letting it re-read the session', async () => {
    vi.mocked(AudioAsset.create).mockResolvedValue({ _id: 'a1' } as never);
    const { createAudioUpload } = await import('~/server/functions/audio');
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');

    await createAudioUpload({
      data: VALID,
      userId: 'mongo-id-1',
      sessionUserId: 'session-provider-id',
    });

    // The bearer-token ingest route passes an explicit userId with no session
    // cookie present. If the presign step resolved auth itself, that path would
    // 500 the moment phase 3 issues a real token.
    //
    // And the id it is handed is the TELEMETRY identity — the OAuth provider id
    // every other server function in this codebase tags with — not the Mongo
    // `_id` used to scope the row. Passing the Mongo id here (which is what
    // this did) made one human show up in GlitchTip as two people: provider id
    // for image uploads, Mongo id for audio.
    expect(vi.mocked(getAudioUploadUrl)).toHaveBeenCalledWith(
      expect.objectContaining({ telemetryUserId: 'session-provider-id' })
    );
  });

  /**
   * The presign step cannot build a key without the caller's storage namespace,
   * and that namespace must be resolved from the acting user's OWN document —
   * `resolveAudioStoragePrefix` mints one on first upload and returns the
   * existing one after that. Without this the key falls back to a flat
   * `uploads/audio/` root, which no owner-scoped listing can attribute.
   */
  it("resolves the acting user's storage prefix and hands it to the presign step", async () => {
    vi.mocked(AudioAsset.create).mockResolvedValue({ _id: 'a1' } as never);
    const { createAudioUpload } = await import('~/server/functions/audio');
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');

    await createAudioUpload({
      data: VALID,
      userId: 'mongo-id-1',
      sessionUserId: 'session-provider-id',
    });

    // The MONGO id — the prefix belongs to the User document, and the provider
    // id would resolve nobody.
    expect(vi.mocked(resolveAudioStoragePrefix)).toHaveBeenCalledWith('mongo-id-1');
    expect(vi.mocked(getAudioUploadUrl)).toHaveBeenCalledWith(
      expect.objectContaining({ storagePrefix: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' })
    );
  });

  /**
   * A user whose prefix cannot be resolved must not end up with a row pointing
   * at a key nothing owns: the resolve runs BEFORE the presign and before the
   * row is created.
   */
  it('creates no asset row when the storage prefix cannot be resolved', async () => {
    const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');
    vi.mocked(resolveAudioStoragePrefix).mockRejectedValueOnce(new Error('User not found'));

    const { createAudioUpload } = await import('~/server/functions/audio');
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');

    await expect(createAudioUpload({ data: VALID, userId: 'u1' })).rejects.toThrow(
      'User not found'
    );
    expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
    expect(vi.mocked(AudioAsset.create)).not.toHaveBeenCalled();
  });
});

describe('confirmAudioUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips to pending when the real object matches the declared size', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'uploading',
    } as never);
    send.mockResolvedValue({ ContentLength: 1024, ContentType: 'audio/wav' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'pending',
    } as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    const r = await confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' });
    expect(r.status).toBe('pending');
  });

  it('fails the asset and deletes the object when the real size exceeds the cap', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'uploading',
    } as never);
    send.mockResolvedValue({ ContentLength: 50 * 1024 * 1024 + 1, ContentType: 'audio/wav' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'failed',
    } as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /too large/i
    );
    // Exactly two calls: HeadObjectCommand (the real size check) followed by
    // DeleteObjectCommand (the object must not survive a refused upload) — both
    // targeting the asset's actual sourceKey/bucket, not just any two calls.
    expect(send).toHaveBeenCalledTimes(2);

    const headCall = send.mock.calls[0][0] as HeadObjectCommand;
    expect(headCall).toBeInstanceOf(HeadObjectCommand);
    expect(headCall.input).toEqual({ Bucket: 'b', Key: 'k' });

    const deleteCall = send.mock.calls[1][0] as DeleteObjectCommand;
    expect(deleteCall).toBeInstanceOf(DeleteObjectCommand);
    expect(deleteCall.input).toEqual({ Bucket: 'b', Key: 'k' });
  });

  it('refuses to re-confirm an already-ready asset, without touching R2 or the row', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'ready',
    } as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /not awaiting confirmation/i
    );

    // Replaying confirm against a finished asset would otherwise flip it back to
    // `pending` and make the worker re-transcode it — in a loop, on a
    // single-node cluster. The guard sits ahead of HeadObject/DeleteObject so a
    // replay can never delete a finished asset's source object either.
    expect(send).not.toHaveBeenCalled();
    expect(AudioAsset.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to re-confirm a failed asset — that transition belongs to retryAudioAsset', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'failed',
    } as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /not awaiting confirmation/i
    );
    expect(AudioAsset.findOneAndUpdate).not.toHaveBeenCalled();
  });

  /**
   * Task 18 nit fix: this function measures/confirms `sourceKey` only — it
   * has no idea `onceSourceKey` exists. A row `createOnceVariantUpload`
   * flipped to `uploading` (`variant: 'once'`) is not a main upload
   * awaiting confirmation, and confirming it here would hand the worker a
   * `pending` row whose once pipeline may not have a real `onceSourceKey`
   * yet. Symmetric with `reapAbandonedUploads`'s `variant: { $ne: 'once' }`
   * split in the worker.
   */
  it('refuses to confirm a row mid-once-attach — that belongs to confirmOnceVariantUpload', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'uploading',
      variant: 'once',
    } as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /not awaiting confirmation/i
    );
    // Refused before ever touching R2 — same as every other precondition
    // failure in this function.
    expect(send).not.toHaveBeenCalled();
    expect(AudioAsset.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('scopes the pending flip to status uploading so a concurrent confirm cannot double-apply', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'uploading',
    } as never);
    send.mockResolvedValue({ ContentLength: 1024, ContentType: 'audio/wav' });
    // The row was confirmed by a racing request between the read and the write.
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue(null as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /not awaiting confirmation/i
    );
    expect(vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
      status: 'uploading',
      // Task 18 nit fix: symmetric with the reaper's `variant: { $ne: 'once' }`
      // split — confirmAudioUpload must never confirm a row a concurrent
      // createOnceVariantUpload has claimed for the once pipeline.
      variant: { $ne: 'once' },
    });
  });

  /**
   * THE INTERLEAVE, staged rather than asserted about.
   *
   * Both writes in this function race for the same row, and only the filter on
   * each write decides which one wins. The success write has always carried
   * `status: 'uploading', variant: { $ne: 'once' }` and says so in its comment
   * ("only the filter on the write makes exactly one of them win"); the REJECT
   * write carried identity alone, and it is the more dangerous of the two to
   * leave open because it stamps `permanentFailure: true` — a flag
   * `retryAudioAsset` refuses, so there is no path back.
   *
   * One client, no privileged timing, window = one `DeleteObject` round trip:
   *
   *   1. Confirm a refused blob (over-cap here). Request #1 measures it and
   *      enters the `DeleteObjectCommand` await.
   *   2. While it is in there, re-PUT good audio to the same presigned URL
   *      (valid 300s, reusable) and confirm again. Request #2's fenced write
   *      matches the still-`uploading` row and flips it to `pending` — a
   *      legitimately queued asset the worker will pick up.
   *   3. Request #1 resumes. Its delete has already destroyed the GOOD object,
   *      and an unfenced write then stamps `failed`/`permanentFailure` over a
   *      row that is now queued (or, if the worker was quick, `ready`).
   *
   * So the model here is STATEFUL: `findOneAndUpdate` evaluates the filter it
   * is actually given against a mutable row, exactly as Mongo would. A test
   * that asserted the filter's SHAPE would pass against an implementation that
   * built the right object and passed it to the wrong call; this one fails on
   * the outcome that matters — the row's final state.
   */
  it('a slow reject cannot brick a row that a concurrent confirm has already re-claimed', async () => {
    const row: Record<string, unknown> = {
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'k',
      status: 'uploading',
    };

    /** Mongo's own filter semantics, cut down to the operators these writes use. */
    const matches = (filter: Record<string, unknown>) =>
      Object.entries(filter).every(([field, expected]) => {
        if (expected && typeof expected === 'object' && '$ne' in expected) {
          return row[field] !== (expected as { $ne: unknown }).$ne;
        }
        return row[field] === expected;
      });

    vi.mocked(AudioAsset.findOne).mockImplementation(
      // A snapshot, like a real read: neither request sees the other's write
      // through this handle.
      (() => Promise.resolve({ ...row })) as never
    );
    vi.mocked(AudioAsset.findOneAndUpdate).mockImplementation(((
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> }
    ) => {
      if (!matches(filter)) return Promise.resolve(null);
      Object.assign(row, update.$set);
      return Promise.resolve({ ...row });
    }) as never);

    const { confirmAudioUpload } = await import('~/server/functions/audio');

    let raced = false;
    send.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) {
        // Request #1 measures the refused blob; request #2 measures the good
        // audio the attacker PUT over it at the same presigned URL.
        return raced
          ? { ContentLength: 1024, ContentType: 'audio/wav' }
          : { ContentLength: 50 * 1024 * 1024 + 1, ContentType: 'audio/wav' };
      }
      // Request #1 is now inside its delete. This is the window.
      if (!raced) {
        raced = true;
        await confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' });
      }
      return {};
    });

    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /too large/i
    );

    // Request #2 won the row and it STAYED won. Unfenced, the reject write
    // that resumed afterwards would have left `status: 'failed'` and
    // `permanentFailure: true` on a queued asset whose bytes are already
    // deleted — unretryable by construction.
    expect(row.status).toBe('pending');
    expect(row.permanentFailure).toBeUndefined();
    expect(row.lastError).toBeUndefined();
    expect(row.confirmedAt).toBeInstanceOf(Date);
  });

  it("refuses another user's asset", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(null as never);
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
    // Pins the ownerId scope itself, not just the null-return behavior — a future
    // change that dropped the ownerId filter would still return null here from the
    // mock, but this assertion would catch it.
    expect(AudioAsset.findOne).toHaveBeenCalledWith({ _id: 'a1', ownerId: 'u2' });
  });
});
