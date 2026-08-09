import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), countDocuments: vi.fn() },
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

const getUserStorageUsage = vi.fn();
vi.mock('~/server/functions/audio-quota', () => ({ getUserStorageUsage }));

import { AudioAsset } from '~/server/db/models/AudioAsset';
import { serverCaptureEvent } from '~/server/utils/telemetry';

const READY_MUSIC_ASSET = {
  _id: 'a1',
  ownerId: 'u1',
  kind: 'music',
  status: 'ready',
};

describe('createOnceVariantUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe default for every pre-existing test below, which predates the
    // quota check and never mocks it: comfortably under any real limit.
    // Tests that care about the quota itself override this explicitly.
    getUserStorageUsage.mockResolvedValue({ bytes: 0, assetCount: 1 });
    // Same, for the pending-job cap now checked at presign — explicit rather
    // than relying on an unconfigured mock's `undefined` comparing false.
    vi.mocked(AudioAsset.countDocuments).mockResolvedValue(0 as never);
  });

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

  /**
   * Review fix (Important): the quota check originally landed only on
   * `createAudioUpload`. Task 3b made `onceSourceBytes` the sixth term in
   * `getUserStorageUsage`'s aggregation specifically so once-variant bytes
   * COUNT toward the quota — but counting them while leaving THIS path
   * (the one that creates them) ungated meant a caller already at the
   * limit could keep attaching once-variants to every `music` asset they
   * own, roughly doubling the effective ceiling for a music-heavy library.
   * These two tests hold this path to the same standard as
   * `createAudioUpload`'s own quota tests in `audio-ingest.test.ts`, via
   * the shared `assertUnderStorageQuota` helper both now call.
   */
  /**
   * The cap at presign, same placement fix as `createAudioUpload`'s — and
   * with one extra reason that is specific to this path. The attach write
   * flips an EXISTING, previously-`ready` music asset into `uploading`, and
   * `status` is shared with the main pipeline, so an attach that confirm was
   * always going to refuse takes a playable asset out of service (the board's
   * play gate, the library row) for the whole round trip. Refusing before the
   * presign means the row is never touched at all.
   */
  describe('pending job cap at presign', () => {
    it('refuses at the cap, issues no presign, and never touches the row', async () => {
      const { getMaxPendingJobsPerUser, createOnceVariantUpload } =
        await import('~/server/functions/audio');
      const { getAudioUploadUrl } = await import('~/server/functions/uploads');
      vi.mocked(AudioAsset.countDocuments).mockResolvedValue(getMaxPendingJobsPerUser() as never);

      await expect(
        createOnceVariantUpload({
          data: { assetId: 'a1', filename: 'ending.wav', contentType: 'audio/wav', bytes: 1024 },
          userId: 'u1',
        })
      ).rejects.toThrow(/too many pending transcode jobs/i);

      // `findOneAndUpdate` in particular: that is the write that would have
      // pulled a `ready` music asset out of service. Asserting it never ran
      // is what distinguishes "refused early" from "refused eventually".
      expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.findOne)).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.findOneAndUpdate)).not.toHaveBeenCalled();
      // The cheap count precedes the expensive aggregation.
      expect(getUserStorageUsage).not.toHaveBeenCalled();
    });
  });

  describe('storage quota', () => {
    it('refuses over quota, issues no presign, and never looks up the asset', async () => {
      const { getAudioUserQuotaBytes, createOnceVariantUpload } =
        await import('~/server/functions/audio');
      const { getAudioUploadUrl } = await import('~/server/functions/uploads');
      const limit = getAudioUserQuotaBytes();
      getUserStorageUsage.mockResolvedValue({ bytes: limit + 1, assetCount: 5 });

      await expect(
        createOnceVariantUpload({
          data: { assetId: 'a1', filename: 'ending.wav', contentType: 'audio/wav', bytes: 1024 },
          userId: 'u1',
        })
      ).rejects.toThrow(/storage quota exceeded/i);

      // Pinned on the quota message specifically, not merely "it threw": the
      // asset-lookup mock is never configured to succeed in this test (it
      // would resolve `undefined` and throw "Audio asset not found" instead
      // if ever reached), so a version of this test that only asserted
      // rejection would pass just as well with the quota check deleted.
      // These negative assertions catch that — they fail unless the quota
      // check runs BEFORE the asset lookup, not just before the presign.
      expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.findOne)).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.findOneAndUpdate)).not.toHaveBeenCalled();
    });

    /**
     * Its own test, not a branch of the one above — this fixture never sets
     * a bytes value, only makes the aggregation call itself reject. Kept
     * separate for the same reason `audio-ingest.test.ts`'s equivalent test
     * is separate: merged into the over-quota case (which pins a resolved
     * bytes VALUE), a missing fail-closed guard could still pass as long as
     * something else downstream happened to throw.
     */
    it('refuses the attach when the usage aggregation itself rejects — fail closed', async () => {
      const { createOnceVariantUpload } = await import('~/server/functions/audio');
      const { getAudioUploadUrl } = await import('~/server/functions/uploads');
      const { serverCaptureException } = await import('~/server/utils/telemetry');
      getUserStorageUsage.mockRejectedValue(new Error('mongo unreachable'));

      await expect(
        createOnceVariantUpload({
          data: { assetId: 'a1', filename: 'ending.wav', contentType: 'audio/wav', bytes: 1024 },
          userId: 'u1',
        })
      ).rejects.toThrow(/unable to verify your storage usage/i);

      expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.findOne)).not.toHaveBeenCalled();

      // The underlying fault is still captured, exactly once, tagged for
      // THIS caller specifically — proves `assertUnderStorageQuota`'s
      // `action` parameter is actually threaded through, not hardcoded to
      // `createAudioUpload`'s own string.
      expect(vi.mocked(serverCaptureException)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(serverCaptureException).mock.calls[0][2]).toMatchObject({
        action: 'createOnceVariantUpload.quotaCheck',
      });
    });
  });
});

describe('confirmOnceVariantUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe default for every pre-existing test below, which predates the
    // pending-job cap and never mocks it: zero pending jobs is comfortably
    // under any real cap. Tests that care about the cap itself override
    // this explicitly.
    vi.mocked(AudioAsset.countDocuments).mockResolvedValue(0);
    // Same, for the confirm-side storage-quota check added in the final
    // whole-branch review. Required rather than tidy: `vi.clearAllMocks`
    // clears CALLS but not IMPLEMENTATIONS, so without this every test here
    // inherits the last `createOnceVariantUpload` quota test's rejected
    // aggregation mock and fails closed.
    getUserStorageUsage.mockResolvedValue({ bytes: 0, assetCount: 1 });
  });

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

  describe('pending job cap', () => {
    /**
     * Pins the ACTUAL count filter, not merely that a refusal happened —
     * same standard `audio-ingest.test.ts` holds `confirmAudioUpload` to. A
     * weaker assertion (`toHaveBeenCalled()` with no argument check) would
     * pass with `ownerId` dropped from the shared `checkPendingJobCap`
     * filter, or `status` narrowed to just `'pending'`.
     */
    it('counts pending+processing jobs scoped to the caller before allowing a once-variant to become claimable', async () => {
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
      vi.mocked(AudioAsset.countDocuments).mockResolvedValue(0);

      const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
      await confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' });

      expect(vi.mocked(AudioAsset.countDocuments)).toHaveBeenCalledWith({
        ownerId: 'u1',
        status: { $in: ['pending', 'processing'] },
      });
    });

    /**
     * The load-bearing difference from `confirmAudioUpload`'s cap refusal:
     * THIS row is the main asset's own document, already `ready` before the
     * once-attach started, so a cap refusal must revert it the same way the
     * tooLarge/badType branch above does (`status: 'ready', variant:
     * 'main'`) — never `status: 'failed'`, which would brick the whole
     * asset. A fixture shape that would make a weaker version of this test
     * pass for the wrong reason: asserting only that SOME write happened,
     * without pinning `set.status`/`set.variant` — that would still pass
     * against an implementation that copied `confirmAudioUpload`'s
     * `status: 'failed'` write verbatim, which is exactly the bug this test
     * exists to catch. Also pins: refusal happens before `HeadObject` (only
     * one R2 call — the delete), the message carries the count, no
     * GlitchTip event, and the once-source object is deleted so it isn't
     * stranded.
     */
    it('refuses over the cap by reverting to ready/main (not failed) and deleting the once-source object', async () => {
      const { getMaxPendingJobsPerUser, confirmOnceVariantUpload, AudioClientError } =
        await import('~/server/functions/audio');
      const { serverCaptureException } = await import('~/server/utils/telemetry');
      const cap = getMaxPendingJobsPerUser();

      vi.mocked(AudioAsset.findOne).mockResolvedValue({
        _id: 'a1',
        ownerId: 'u1',
        status: 'uploading',
        variant: 'once',
        onceSourceKey: 'uploads/audio/prefix/once-src.wav',
      } as never);
      vi.mocked(AudioAsset.countDocuments).mockResolvedValue(cap);
      vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({ _id: 'a1' } as never);
      send.mockResolvedValue({ ContentLength: 2048, ContentType: 'audio/wav' });

      const err = await confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' }).catch(
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(AudioClientError);
      expect((err as Error).message).toContain(String(cap));

      // Exactly one R2 call: the delete of the once-source object.
      // HeadObject never runs — the cap refusal happens before it.
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
      expect((send.mock.calls[0][0] as DeleteObjectCommand).input).toEqual({
        Bucket: 'b',
        Key: 'uploads/audio/prefix/once-src.wav',
      });

      const [filter, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
      expect(filter).toEqual({ _id: 'a1', ownerId: 'u1', status: 'uploading', variant: 'once' });
      const set = (update as { $set: Record<string, unknown> }).$set;
      expect(set.status).toBe('ready');
      expect(set.variant).toBe('main');
      expect(set.onceSourceKey).toBeNull();
      expect(set.onceSourceBytes).toBeNull();
      expect(set.onceLastError).toContain(String(cap));
      expect('permanentFailure' in set).toBe(false);
      expect('lastError' in set).toBe(false);

      // The caller's own doing — must not file a GlitchTip event.
      expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
    });
  });

  /**
   * FINAL WHOLE-BRANCH REVIEW, Important #1 — the once half. Same defect as
   * `confirmAudioUpload`'s: `onceSourceBytes` is written by the success write
   * below and nowhere else, so a presign-only quota check cannot see a
   * once-source that has already been PUT.
   *
   * The cleanup is NOT `confirmAudioUpload`'s. This row is the main asset's
   * own document — a fully-transcoded, previously-`ready` `music` asset — so
   * a refusal reverts it to `ready`/`main` exactly as the cap refusal and the
   * tooLarge branch do, rather than writing `status: 'failed'`, which would
   * brick it.
   */
  describe('storage quota at confirm', () => {
    it('refuses an over-quota once-confirm before HeadObject, deletes the once-source, and reverts to ready/main on a fenced filter', async () => {
      const { getAudioUserQuotaBytes, confirmOnceVariantUpload, AudioClientError } =
        await import('~/server/functions/audio');
      const { serverCaptureException } = await import('~/server/utils/telemetry');
      const limit = getAudioUserQuotaBytes();

      vi.mocked(AudioAsset.findOne).mockResolvedValue({
        _id: 'a1',
        ownerId: 'u1',
        status: 'uploading',
        variant: 'once',
        onceSourceKey: 'uploads/audio/prefix/once-src.wav',
      } as never);
      getUserStorageUsage.mockResolvedValue({ bytes: limit + 1, assetCount: 9 });
      vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({ _id: 'a1' } as never);
      // A VALID object on purpose: an implementation that measured first
      // would succeed here, so this fixture cannot pass for the wrong reason.
      send.mockResolvedValue({ ContentLength: 2048, ContentType: 'audio/wav' });

      const err = await confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' }).catch(
        (e: unknown) => e
      );

      expect(err).toBeInstanceOf(AudioClientError);
      expect((err as Error).message).toMatch(/storage quota exceeded/i);
      const clientErr = err as InstanceType<typeof AudioClientError>;
      expect(clientErr.usageBytes).toBe(limit + 1);
      expect(clientErr.limitBytes).toBe(limit);

      // NO HeadObject — pinned on the command class, not on a bare count.
      expect(send.mock.calls.filter(([cmd]) => cmd instanceof HeadObjectCommand)).toHaveLength(0);
      const deletes = send.mock.calls.filter(([cmd]) => cmd instanceof DeleteObjectCommand);
      expect(deletes).toHaveLength(1);
      expect((deletes[0][0] as DeleteObjectCommand).input).toEqual({
        Bucket: 'b',
        Key: 'uploads/audio/prefix/once-src.wav',
      });

      // The ACTUAL filter — `variant: 'once'` EXACT, not `$ne`, matching the
      // two writes around it: only a row still mid-attach may be reverted.
      const [filter, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
      expect(filter).toEqual({
        _id: 'a1',
        ownerId: 'u1',
        status: 'uploading',
        variant: 'once',
      });
      const set = (update as { $set: Record<string, unknown> }).$set;
      // The load-bearing difference from confirmAudioUpload's refusal.
      expect(set.status).toBe('ready');
      expect(set.variant).toBe('main');
      expect(set.onceSourceKey).toBeNull();
      expect(set.onceSourceBytes).toBeNull();
      expect(set.onceLastError).toMatch(/storage quota exceeded/i);
      expect('permanentFailure' in set).toBe(false);
      expect('lastError' in set).toBe(false);
      // The main asset's own playable content is untouched.
      expect('renditions' in set).toBe(false);
      expect('onceRenditions' in set).toBe(false);
      expect('sourceKey' in set).toBe(false);

      expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
    });

    it('refuses exactly at the limit and admits one byte under it', async () => {
      const { getAudioUserQuotaBytes, confirmOnceVariantUpload } =
        await import('~/server/functions/audio');
      const limit = getAudioUserQuotaBytes();

      vi.mocked(AudioAsset.findOne).mockResolvedValue({
        _id: 'a1',
        ownerId: 'u1',
        status: 'uploading',
        variant: 'once',
        onceSourceKey: 'uploads/audio/prefix/once-src.wav',
      } as never);
      vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
        _id: 'a1',
        status: 'pending',
      } as never);
      send.mockResolvedValue({ ContentLength: 2048, ContentType: 'audio/wav' });

      getUserStorageUsage.mockResolvedValue({ bytes: limit, assetCount: 9 });
      await expect(
        confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' })
      ).rejects.toThrow(/storage quota exceeded/i);

      getUserStorageUsage.mockResolvedValue({ bytes: limit - 1, assetCount: 9 });
      await expect(
        confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' })
      ).resolves.toMatchObject({ status: 'pending' });
    });

    it('fails closed when the aggregation rejects, leaving the once-source object in place', async () => {
      const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
      const { serverCaptureException } = await import('~/server/utils/telemetry');
      vi.mocked(AudioAsset.findOne).mockResolvedValue({
        _id: 'a1',
        ownerId: 'u1',
        status: 'uploading',
        variant: 'once',
        onceSourceKey: 'uploads/audio/prefix/once-src.wav',
      } as never);
      getUserStorageUsage.mockRejectedValue(new Error('mongo unreachable'));

      await expect(
        confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' })
      ).rejects.toThrow(/unable to verify your storage usage/i);
      // Nothing deleted and nothing reverted: a transient fault must leave a
      // retryable attach intact rather than destroying the uploaded object.
      expect(send).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.findOneAndUpdate)).not.toHaveBeenCalled();
      expect(vi.mocked(serverCaptureException).mock.calls[0][2]).toMatchObject({
        action: 'confirmOnceVariantUpload.quotaCheck',
      });
    });
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
