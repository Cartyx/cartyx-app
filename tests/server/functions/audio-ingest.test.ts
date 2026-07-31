import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
}));
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: {
    create: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    countDocuments: vi.fn(),
  },
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

const getUserStorageUsage = vi.fn();
vi.mock('~/server/functions/audio-quota', () => ({ getUserStorageUsage }));

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
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe default for every pre-existing test below, which predates the
    // quota check and never mocks it: comfortably under any real limit, so
    // the happy-path assertions those tests make are unaffected. Tests that
    // care about the quota itself override this explicitly.
    getUserStorageUsage.mockResolvedValue({ bytes: 0, assetCount: 1 });
  });

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

  describe('storage quota', () => {
    /**
     * A fixture shape that would make this pass for the wrong reason: `VALID`
     * missing some other required field. That would throw before the quota
     * check ever ran (or, worse, before it was ever reached at all), and
     * `not.toHaveBeenCalled()` on the presign would pass vacuously — the
     * point of these tests is that the check itself fired, not merely that
     * SOMETHING threw. `VALID` is the same fully-populated fixture the
     * pre-existing happy-path tests above use, and every assertion below also
     * pins the rejection message to quota-specific text (or, for the
     * aggregation-failure test, to the fail-closed message), so a mutation
     * that made some unrelated line throw first would fail these tests too.
     */
    it('refuses over quota, issues no presign, resolves no storage prefix, and creates no row', async () => {
      const { getAudioUserQuotaBytes } = await import('~/server/functions/audio');
      const limit = getAudioUserQuotaBytes();
      getUserStorageUsage.mockResolvedValue({ bytes: limit + 1, assetCount: 5 });
      const { createAudioUpload } = await import('~/server/functions/audio');
      const { getAudioUploadUrl } = await import('~/server/functions/uploads');
      const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');

      await expect(createAudioUpload({ data: VALID, userId: 'u1' })).rejects.toThrow(
        /storage quota exceeded/i
      );

      // The negative assertion is the point: a test that only asserted the
      // rejection would still pass with the quota check deleted, because
      // AudioAsset.create's mock (unconfigured in this describe block) would
      // eventually throw on its own. Asserting no presign AND no prefix
      // resolution AND no row creation proves the refusal happened FIRST,
      // before any of the function's other work.
      expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
      expect(vi.mocked(resolveAudioStoragePrefix)).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.create)).not.toHaveBeenCalled();
    });

    it('carries the current usage and the limit on the refusal, for the UI to render', async () => {
      const audioModule = await import('~/server/functions/audio');
      const limit = audioModule.getAudioUserQuotaBytes();
      getUserStorageUsage.mockResolvedValue({ bytes: limit + 500, assetCount: 3 });

      const err = await audioModule
        .createAudioUpload({ data: VALID, userId: 'u1' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(audioModule.AudioClientError);
      const clientErr = err as InstanceType<typeof audioModule.AudioClientError>;
      expect(clientErr.usageBytes).toBe(limit + 500);
      expect(clientErr.limitBytes).toBe(limit);
    });

    it('does not report the quota refusal itself to GlitchTip', async () => {
      const { getAudioUserQuotaBytes, createAudioUpload } =
        await import('~/server/functions/audio');
      const { serverCaptureException } = await import('~/server/utils/telemetry');
      getUserStorageUsage.mockResolvedValue({ bytes: getAudioUserQuotaBytes(), assetCount: 4 });

      await expect(createAudioUpload({ data: VALID, userId: 'u1' })).rejects.toThrow();
      expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();
    });

    /**
     * The stated boundary rule: usage measured BEFORE this upload lands is
     * checked with `>=` against the limit, exactly matching
     * `assertPackageBudget`'s deliberate `count >= MAX_PACKAGES_PER_USER` in
     * `~/server/functions/packages.ts` — a caller already sitting AT the
     * limit is refused, symmetric with a caller already AT the package cap
     * being refused a new package.
     */
    it('refuses exactly at the limit', async () => {
      const { getAudioUserQuotaBytes, createAudioUpload } =
        await import('~/server/functions/audio');
      const { getAudioUploadUrl } = await import('~/server/functions/uploads');
      const limit = getAudioUserQuotaBytes();
      getUserStorageUsage.mockResolvedValue({ bytes: limit, assetCount: 4 });

      await expect(createAudioUpload({ data: VALID, userId: 'u1' })).rejects.toThrow(
        /storage quota exceeded/i
      );
      expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
    });

    /** The symmetric case: one byte under the limit is allowed through. */
    it('allows the upload that lands one byte under the limit', async () => {
      const { getAudioUserQuotaBytes, createAudioUpload } =
        await import('~/server/functions/audio');
      const limit = getAudioUserQuotaBytes();
      getUserStorageUsage.mockResolvedValue({ bytes: limit - 1, assetCount: 4 });
      vi.mocked(AudioAsset.create).mockResolvedValue({ _id: 'a1' } as never);

      await expect(createAudioUpload({ data: VALID, userId: 'u1' })).resolves.toMatchObject({
        assetId: 'a1',
      });
    });

    /**
     * Its own test, not a branch of another: this fixture never sets a
     * bytes value at all, only makes the aggregation call itself reject —
     * a shape that would pass for the wrong reason if merged into the
     * over-quota test above (which pins a bytes VALUE, not a rejected
     * promise) and could pass even if the fail-closed catch were missing,
     * as long as SOMETHING downstream also happened to throw.
     */
    it('refuses the upload when the usage aggregation itself rejects — fail closed', async () => {
      getUserStorageUsage.mockRejectedValue(new Error('mongo unreachable'));
      const { createAudioUpload } = await import('~/server/functions/audio');
      const { getAudioUploadUrl } = await import('~/server/functions/uploads');
      const { resolveAudioStoragePrefix } = await import('~/server/functions/audio-storage');
      const { serverCaptureException } = await import('~/server/utils/telemetry');

      await expect(createAudioUpload({ data: VALID, userId: 'u1' })).rejects.toThrow(
        /unable to verify your storage usage/i
      );
      expect(vi.mocked(getAudioUploadUrl)).not.toHaveBeenCalled();
      expect(vi.mocked(resolveAudioStoragePrefix)).not.toHaveBeenCalled();
      expect(vi.mocked(AudioAsset.create)).not.toHaveBeenCalled();

      // The UNDERLYING fault is still captured, deliberately, even though the
      // outward refusal is an AudioClientError the outer catch will not
      // report a second time: a Mongo/index/connection fault is not
      // something a caller can trigger on demand the way a guessable
      // not-found or a resource cap is, and swallowing it entirely would
      // make the quota's own failure mode invisible in GlitchTip.
      expect(vi.mocked(serverCaptureException)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(serverCaptureException).mock.calls[0][2]).toMatchObject({
        action: 'createAudioUpload.quotaCheck',
      });
    });
  });
});

describe('confirmAudioUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe default for every pre-existing test below, which predates the
    // pending-job cap and never mocks it: zero pending jobs is comfortably
    // under any real cap, so the happy-path/precondition assertions those
    // tests make are unaffected. Tests that care about the cap itself
    // override this explicitly.
    vi.mocked(AudioAsset.countDocuments).mockResolvedValue(0);
  });

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

  describe('pending job cap', () => {
    /**
     * Pins the ACTUAL count filter `AudioAsset.countDocuments` is called
     * with, not merely that some refusal or admission happened. A fixture
     * shape that would make a weaker assertion pass for the wrong reason:
     * asserting only "it was called" (any arguments) would still pass with
     * `ownerId` dropped from the filter, or with `status` narrowed to just
     * `'pending'` (silently ignoring `processing` rows), or with the field
     * name typo'd — `toHaveBeenCalledWith` is a deep-equality check on the
     * exact object the production code built, so all three mutations fail
     * it.
     */
    it('counts pending+processing jobs scoped to the caller before allowing the row to become claimable', async () => {
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
      vi.mocked(AudioAsset.countDocuments).mockResolvedValue(0);

      const { confirmAudioUpload } = await import('~/server/functions/audio');
      await confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' });

      expect(vi.mocked(AudioAsset.countDocuments)).toHaveBeenCalledWith({
        ownerId: 'u1',
        status: { $in: ['pending', 'processing'] },
      });
    });

    /**
     * THE global-count catch. A single-user fixture cannot tell "counts
     * this user's jobs" apart from "counts everyone's jobs" — both shapes
     * produce the same refuse/admit outcome for one caller. This test uses
     * a `countDocuments` fake that only ONE of those two implementations
     * can satisfy: it inspects the filter's `ownerId` and answers per-user
     * (u1 sits at the cap, u2 sits at zero). A count that is global, or
     * scoped to the wrong field, cannot route to the right branch here —
     * see the teeth-proof below, which drops `ownerId` from the production
     * filter and confirms this exact test fails.
     *
     * Also proves: the refusal happens BEFORE `HeadObject` (no wasted R2
     * round trip on a file that's refused regardless of its contents), the
     * refusal message carries the count, the refusal is an
     * `AudioClientError` (no GlitchTip event for the caller's own doing),
     * and a DIFFERENT user with room in their queue is admitted through the
     * normal success path in the same run.
     */
    it('refuses a user already at the cap while a different user at zero is admitted', async () => {
      const { getMaxPendingJobsPerUser, confirmAudioUpload, AudioClientError } =
        await import('~/server/functions/audio');
      const { serverCaptureException } = await import('~/server/utils/telemetry');
      const cap = getMaxPendingJobsPerUser();

      vi.mocked(AudioAsset.countDocuments).mockImplementation((async (
        filter: Record<string, unknown>
      ) => {
        if (filter.ownerId === 'u1') return cap; // already at the cap
        if (filter.ownerId === 'u2') return 0; // fresh, nothing queued
        // Any other shape (ownerId missing/wrong, or a global count that
        // ignores it) cannot be answered correctly for either caller —
        // failing loudly here is what makes the mutation below fail this
        // test instead of silently passing it.
        throw new Error(`unscoped countDocuments filter: ${JSON.stringify(filter)}`);
      }) as never);
      send.mockResolvedValue({ ContentLength: 1024, ContentType: 'audio/wav' });

      // u1: at the cap, refused.
      vi.mocked(AudioAsset.findOne).mockResolvedValueOnce({
        _id: 'a1',
        ownerId: 'u1',
        sourceKey: 'k1',
        status: 'uploading',
      } as never);
      const err = await confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' }).catch(
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(AudioClientError);
      expect((err as Error).message).toContain(String(cap));
      // Exactly one R2 call: the delete of the already-uploaded object.
      // HeadObject never runs — the cap refusal happens before it.
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
      expect((send.mock.calls[0][0] as DeleteObjectCommand).input).toEqual({
        Bucket: 'b',
        Key: 'k1',
      });
      // The comment above CLAIMS "no GlitchTip event" — this is what
      // actually pins that constraint, rather than the error-class check
      // above (`toBeInstanceOf(AudioClientError)`) standing in for it.
      // `AudioClientError` is the MECHANISM `reportAudioError` uses to
      // decide; asserting on the mechanism is not the same as asserting on
      // the effect it's supposed to produce.
      expect(vi.mocked(serverCaptureException)).not.toHaveBeenCalled();

      send.mockClear();

      // u2: a DIFFERENT user, zero pending jobs, admitted normally.
      vi.mocked(AudioAsset.findOne).mockResolvedValueOnce({
        _id: 'a2',
        ownerId: 'u2',
        sourceKey: 'k2',
        status: 'uploading',
      } as never);
      vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
        _id: 'a2',
        status: 'pending',
      } as never);
      const r = await confirmAudioUpload({ data: { assetId: 'a2' }, userId: 'u2' });
      expect(r.status).toBe('pending');
    });
  });
});
