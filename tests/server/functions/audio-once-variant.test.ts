import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

const send = vi.fn();
vi.mock('~/server/functions/uploads', () => ({
  createR2: () => ({ client: { send }, bucket: 'b', cdnUrl: 'https://cdn.test' }),
  getAudioUploadUrl: vi.fn(async () => ({
    uploadUrl: 'https://signed/put',
    key: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/once-1-a.wav',
    publicUrl: 'https://cdn.test/uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/once-1-a.wav',
  })),
}));

vi.mock('~/server/functions/audio-storage', () => ({
  resolveAudioStoragePrefix: vi.fn(async () => 'a1b2c3d4e5f60718293a4b5c6d7e8f90'),
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';
import { serverCaptureEvent } from '~/server/utils/telemetry';

const READY_MUSIC_ASSET = {
  _id: 'a1',
  ownerId: 'u1',
  kind: 'music',
  status: 'ready',
};

describe('createOnceVariantUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('presigns and flips the row to uploading with variant: once, for a ready music asset', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(READY_MUSIC_ASSET as never);
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'uploading',
    } as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    const r = await createOnceVariantUpload({
      data: { assetId: 'a1', filename: 'ending.wav', contentType: 'audio/wav', bytes: 1024 },
      userId: 'u1',
    });

    expect(r.assetId).toBe('a1');
    expect(r.uploadUrl).toBe('https://signed/put');

    const [filter, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
    // The replay guard: only a `ready` row can be claimed for an attach.
    expect(filter).toEqual({ _id: 'a1', ownerId: 'u1', status: 'ready' });
    expect((update as { $set: Record<string, unknown> }).$set).toMatchObject({
      onceSourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/once-1-a.wav',
      variant: 'once',
      status: 'uploading',
      // Task 18 re-review minor: a fresh attach gets a fresh retry budget
      // and no inherited backoff delay. Neither was previously asserted —
      // `toMatchObject` only fails on a listed key whose value is wrong,
      // and these two keys simply weren't listed, so removing them from
      // the implementation would have passed silently.
      attempts: 0,
      nextAttemptAt: null,
    });
    // The MAIN renditions are untouched — this attach has nothing to do with
    // them, and clobbering them would break a fully-transcoded asset.
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect('renditions' in set).toBe(false);
  });

  /**
   * Adversarial-review fix. This assertion is the whole of it: the write must
   * CLEAR `onceRenditions`.
   *
   * The once rendition keys are DETERMINISTIC per asset
   * (`${base}.once.${ext}` — `renditionKeyBase`'s callers in
   * audio-worker/src/process.ts), and the worker PUTs both objects BEFORE any
   * DB write. So a second attach's job overwrites the first attach's live
   * objects in place. If that job then fails partway — one R2 blip on the
   * second PUT, an evicted pod — `markOnceFailed` reverts the row to `ready`
   * still pointing at those keys, and the asset now serves attach #2's audio
   * to a browser that picks `.opus` and attach #1's to one that picks `.aac`,
   * with `bytes`/`durationMs` describing neither. No race is required and
   * nothing reports it.
   *
   * Leaving the field standing did not preserve anything — the bytes behind
   * those keys are gone the moment the second job runs — it only made the row
   * claim a once-variant it could no longer play correctly.
   */
  it('clears onceRenditions when re-attaching, so a failed second attach cannot leave mismatched renditions', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      ...READY_MUSIC_ASSET,
      // A previous, SUCCESSFUL attach: both renditions live, both at the
      // deterministic keys the next attach's worker run will overwrite.
      onceSourceKey: 'uploads/audio/prefix/once-old.wav',
      onceRenditions: {
        opus: { key: 'uploads/audio/prefix/a1.once.opus', bytes: 111 },
        aac: { key: 'uploads/audio/prefix/a1.once.m4a', bytes: 222 },
      },
    } as never);
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'uploading',
    } as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    await createOnceVariantUpload({
      data: { assetId: 'a1', filename: 'ending2.wav', contentType: 'audio/wav', bytes: 2048 },
      userId: 'u1',
    });

    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set.onceRenditions).toEqual({});
  });

  /**
   * Task 3b review fix (Important). `onceSourceBytes` mirrors `onceSourceKey`
   * one field over — the byte count describes the object the key points at —
   * so the same reset `onceRenditions: {}` gets above is required for this
   * field too, and for the same reason: a prior SUCCESSFUL attach set it to
   * a real number, this new attach mints a brand-new key the old number no
   * longer describes, and the old value must not survive to be
   * misattributed to the new (not-yet-confirmed) object.
   *
   * Fixture starts `onceSourceBytes` at a real non-null number (5,000,000),
   * not null and not absent — a fixture that started null/absent would pass
   * this assertion even with the reset deleted from the implementation,
   * because `undefined === null` reads the same as an explicit reset from
   * `toBe(null)`'s perspective only if nothing else supplies a value; a
   * non-null start makes the assertion fail unless the code actually writes
   * the reset.
   */
  it('resets onceSourceBytes to null when re-attaching, so a stale prior measurement cannot survive onto the new key', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      ...READY_MUSIC_ASSET,
      onceSourceKey: 'uploads/audio/prefix/once-old.wav',
      onceSourceBytes: 5_000_000,
    } as never);
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'uploading',
    } as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    await createOnceVariantUpload({
      data: { assetId: 'a1', filename: 'ending2.wav', contentType: 'audio/wav', bytes: 2048 },
      userId: 'u1',
    });

    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set.onceSourceBytes).toBeNull();
  });

  it('refuses a non-music asset, without presigning or touching the row', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      ...READY_MUSIC_ASSET,
      kind: 'ambience',
    } as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');

    await expect(
      createOnceVariantUpload({
        data: { assetId: 'a1', filename: 'x.wav', contentType: 'audio/wav', bytes: 1 },
        userId: 'u1',
      })
    ).rejects.toThrow(/music/i);
    expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
    expect(AudioAsset.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses a music asset that hasn't finished its own transcode", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      ...READY_MUSIC_ASSET,
      status: 'processing',
    } as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');

    await expect(
      createOnceVariantUpload({
        data: { assetId: 'a1', filename: 'x.wav', contentType: 'audio/wav', bytes: 1 },
        userId: 'u1',
      })
    ).rejects.toThrow(/finish processing/i);
    expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
  });

  it("refuses another owner's asset", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(null as never);
    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    await expect(
      createOnceVariantUpload({
        data: { assetId: 'a1', filename: 'x.wav', contentType: 'audio/wav', bytes: 1 },
        userId: 'u2',
      })
    ).rejects.toThrow(/not found/i);
    expect(AudioAsset.findOne).toHaveBeenCalledWith({ _id: 'a1', ownerId: 'u2' });
  });

  it('refuses a concurrent attach that raced a first one past the ready check', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(READY_MUSIC_ASSET as never);
    // The read saw 'ready', but a racing request already flipped it to
    // 'uploading' by the time this write runs — the fenced filter matches
    // nothing.
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue(null as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    await expect(
      createOnceVariantUpload({
        data: { assetId: 'a1', filename: 'x.wav', contentType: 'audio/wav', bytes: 1 },
        userId: 'u1',
      })
    ).rejects.toThrow(/not ready to accept/i);
  });

  /**
   * Task 18 re-review minor: re-attaching mints a new `onceSourceKey` and,
   * before this test existed, nothing asserted that the SUPERSEDED object
   * actually gets deleted — only that the row points at the new key. Since
   * `createOnceVariantUpload` requires `status: 'ready'` to attach at all,
   * the only way a row reaches this function with an existing
   * `onceSourceKey` already set is after a PRIOR successful once-variant
   * (the fixture below), which is exactly the re-attach case the fix is
   * for.
   */
  it('deletes the previous onceSourceKey object when re-attaching, only after the row points at the new key', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      ...READY_MUSIC_ASSET,
      onceSourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/old-once.wav',
    } as never);
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'uploading',
    } as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    await createOnceVariantUpload({
      data: { assetId: 'a1', filename: 'ending2.wav', contentType: 'audio/wav', bytes: 1024 },
      userId: 'u1',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const deleteCall = send.mock.calls[0][0] as DeleteObjectCommand;
    expect(deleteCall).toBeInstanceOf(DeleteObjectCommand);
    expect(deleteCall.input).toEqual({
      Bucket: 'b',
      Key: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/old-once.wav',
    });
  });

  it('does not attempt any delete on a first attach (no previous onceSourceKey)', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(READY_MUSIC_ASSET as never);
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'uploading',
    } as never);

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    await createOnceVariantUpload({
      data: { assetId: 'a1', filename: 'ending.wav', contentType: 'audio/wav', bytes: 1024 },
      userId: 'u1',
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('still succeeds the attach when deleting the superseded object fails — best effort, not fatal', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      ...READY_MUSIC_ASSET,
      onceSourceKey: 'uploads/audio/a1b2c3d4e5f60718293a4b5c6d7e8f90/old-once.wav',
    } as never);
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'uploading',
    } as never);
    send.mockRejectedValueOnce(new Error('R2 unavailable'));

    const { createOnceVariantUpload } = await import('~/server/functions/audio');
    const r = await createOnceVariantUpload({
      data: { assetId: 'a1', filename: 'ending2.wav', contentType: 'audio/wav', bytes: 1024 },
      userId: 'u1',
    });

    expect(r.assetId).toBe('a1');
  });
});

describe('confirmOnceVariantUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * THE LOAD-BEARING CASE the task brief names explicitly: a once-variant
   * confirm must leave `renditions` completely untouched. Asserted by
   * enumerating every key the write actually sets, not merely checking
   * `onceRenditions`'s presence — an implementation that also (wrongly)
   * included `renditions: {}` in the same $set would pass a weaker check
   * but wipe the main asset's playable renditions the moment this ran.
   */
  it('flips to pending on a valid object, touching nothing but queue-state fields', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      status: 'uploading',
      variant: 'once',
      onceSourceKey: 'uploads/audio/prefix/once-src.wav',
    } as never);
    send.mockResolvedValue({ ContentLength: 2048, ContentType: 'audio/wav' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
      _id: 'a1',
      status: 'pending',
    } as never);

    const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
    const r = await confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' });
    expect(r.status).toBe('pending');

    // HeadObject measured the ONCE source, not the main one.
    const headCall = send.mock.calls[0][0] as HeadObjectCommand;
    expect(headCall).toBeInstanceOf(HeadObjectCommand);
    expect(headCall.input).toEqual({ Bucket: 'b', Key: 'uploads/audio/prefix/once-src.wav' });

    const [filter, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
    expect(filter).toEqual({ _id: 'a1', ownerId: 'u1', status: 'uploading', variant: 'once' });
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(Object.keys(set).sort()).toEqual([
      'confirmedAt',
      'onceSourceBytes',
      'status',
      'updatedAt',
    ]);
    expect(set.status).toBe('pending');
    // Task 3b: the HeadObject size already computed for the AUDIO_MAX_BYTES
    // gate (`ContentLength: 2048` mocked above) must be the exact number
    // persisted — not re-derived, not a different mocked value threaded
    // through, and not merely present. This is what makes the byte count
    // visible to `getUserStorageUsage`.
    expect(set.onceSourceBytes).toBe(2048);
    expect('renditions' in set).toBe(false);
    expect('onceRenditions' in set).toBe(false);
    expect('sourceKey' in set).toBe(false);
    expect('durationMs' in set).toBe(false);

    expect(vi.mocked(serverCaptureEvent)).toHaveBeenCalledWith(
      'u1',
      'audio_once_variant_confirmed',
      { assetId: 'a1' }
    );
  });

  /**
   * Task 18 round 3 review, Important: this test used to assert
   * `status: 'failed'` + `permanentFailure: true` — pinning the exact bug
   * the review found. That write lands on the MAIN asset's own row (this
   * function attaches to an existing, previously-`ready` document, not a
   * fresh one), and `permanentFailure: true` is a dead end:
   * `retryAudioAsset` refuses it and `createOnceVariantUpload` refuses a
   * non-`ready` row, so a fully-transcoded music asset would go dark on
   * every board, permanently, because a SECOND file was rejected. Fixed to
   * match `markOnceFailed`'s guarantee (audio-worker/src/process.ts): the
   * row reverts to a fully playable `ready`/`main` asset, with the reason
   * recorded in `onceLastError` instead. The R2 delete of the oversized
   * object is UNCHANGED — that object must still go regardless of how the
   * row is written, or storage is paid for a file that was refused.
   */
  it('reverts to ready/main and deletes the object when the once-variant file is too large, without touching the main asset fields', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      status: 'uploading',
      variant: 'once',
      onceSourceKey: 'uploads/audio/prefix/once-src.wav',
      // Task 3b review fix: non-null on purpose, modelling a row where
      // something (in production, always null by this point thanks to
      // `createOnceVariantUpload`'s own reset — asserted separately above)
      // left a real number here. This write's own reset must not depend on
      // that other function having run; a fixture starting at null/absent
      // would pass this test even if THIS write's reset were deleted.
      onceSourceBytes: 5_000_000,
    } as never);
    send.mockResolvedValue({ ContentLength: 50 * 1024 * 1024 + 1, ContentType: 'audio/wav' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({ _id: 'a1' } as never);

    const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
    await expect(
      confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' })
    ).rejects.toThrow(/too large/i);

    // The oversized object is still deleted — that half of the original
    // behavior is correct and untouched.
    const deleteCall = send.mock.calls[1][0] as DeleteObjectCommand;
    expect(deleteCall).toBeInstanceOf(DeleteObjectCommand);
    expect(deleteCall.input).toEqual({ Bucket: 'b', Key: 'uploads/audio/prefix/once-src.wav' });

    const [filter, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
    // FINAL REVIEW, blocking item 4. This reject write CANCELS a once-attach
    // (`status: 'ready', variant: 'main', onceSourceKey: null`), and it used
    // to carry only `{ _id, ownerId }` — the sole unfenced `findOneAndUpdate`
    // in a file where every other write is fenced. A stale reject landing
    // after the user started a SECOND attach matched that fresh row and
    // silently reverted it, stranding its uploaded object with nothing said.
    // Asserted with `toEqual`, not a subset check: a filter that regained
    // `_id`/`ownerId` while losing the status/variant clauses is exactly the
    // regression, and a subset assertion would not see it.
    expect(filter).toEqual({
      _id: 'a1',
      ownerId: 'u1',
      status: 'uploading',
      variant: 'once',
    });
    const set = (update as { $set: Record<string, unknown> }).$set;
    // The load-bearing assertions: never 'failed', never permanentFailure.
    expect(set.status).toBe('ready');
    expect(set.variant).toBe('main');
    expect(set.onceSourceKey).toBeNull();
    // Paired with onceSourceKey: cartyx-app Task 3b review fix. The rejected
    // object is deleted (asserted above) and this row no longer has a
    // once-source of any kind — nothing may describe its size, so this
    // must reset to null in the same write, not merely stay unmentioned.
    expect(set.onceSourceBytes).toBeNull();
    expect(set.onceLastError).toMatch(/too large/i);
    expect('permanentFailure' in set).toBe(false);
    expect('lastError' in set).toBe(false);
    // The main asset's own content is completely untouched by this write.
    expect('renditions' in set).toBe(false);
    expect('onceRenditions' in set).toBe(false);
    expect('durationMs' in set).toBe(false);
    expect('sourceKey' in set).toBe(false);
  });

  it('reverts to ready/main and deletes the object when the once-variant file is the wrong type', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      status: 'uploading',
      variant: 'once',
      onceSourceKey: 'uploads/audio/prefix/once-src.wav',
    } as never);
    send.mockResolvedValue({ ContentLength: 1024, ContentType: 'video/mp4' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({ _id: 'a1' } as never);

    const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
    await expect(
      confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' })
    ).rejects.toThrow(/unsupported/i);

    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set.status).toBe('ready');
    expect(set.variant).toBe('main');
    expect('permanentFailure' in set).toBe(false);
  });

  it('refuses to confirm a row that is not an in-flight once-variant upload', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      status: 'ready',
      variant: 'main',
    } as never);
    const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
    await expect(
      confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' })
    ).rejects.toThrow(/not awaiting confirmation/i);
    expect(send).not.toHaveBeenCalled();
    expect(AudioAsset.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses another owner's asset", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(null as never);
    const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
    await expect(
      confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u2' })
    ).rejects.toThrow(/not found/i);
  });
});

describe('serializeAudioAsset with a once-variant attached', () => {
  /**
   * The other half of the brief's load-bearing assertion, on the READ side:
   * once the worker has written `onceRenditions`, serialization must expose
   * BOTH fields independently and correctly — not just report that
   * `onceRenditions` exists. Uses genuinely different key/url/bytes values
   * per field so an implementation that accidentally aliased or overwrote
   * one with the other would fail this.
   */
  it('serializes onceRenditions and renditions as independent values, neither clobbering the other', async () => {
    const { serializeAudioAsset } = await import('~/server/functions/audio');
    const doc = {
      _id: 'a1',
      ownerId: 'u1',
      kind: 'music',
      status: 'ready',
      renditions: {
        opus: { key: 'main.opus', url: 'https://cdn.test/main.opus', bytes: 111 },
        aac: { key: 'main.m4a', url: 'https://cdn.test/main.m4a', bytes: 222 },
      },
      onceRenditions: {
        opus: { key: 'once.opus', url: 'https://cdn.test/once.opus', bytes: 333 },
        aac: { key: 'once.m4a', url: 'https://cdn.test/once.m4a', bytes: 444 },
      },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };

    const serialized = serializeAudioAsset(doc);
    expect(serialized.renditions).toEqual(doc.renditions);
    expect(serialized.onceRenditions).toEqual(doc.onceRenditions);
    // Genuinely different, not the same object/values reused for both.
    expect(serialized.renditions.opus?.key).not.toBe(serialized.onceRenditions?.opus?.key);
  });

  it('defaults onceRenditions to {} — never undefined — when the row has none, mirroring renditions', async () => {
    const { serializeAudioAsset } = await import('~/server/functions/audio');
    const serialized = serializeAudioAsset({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    expect(serialized.onceRenditions).toEqual({});
    expect(serialized.renditions).toEqual({});
  });
});
