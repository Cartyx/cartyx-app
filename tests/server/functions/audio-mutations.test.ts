import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('~/server/db/connection', () => ({ connectDB: vi.fn(), isDBConnected: vi.fn(() => true) }));
vi.mock('~/server/utils/telemetry', () => ({
  serverCaptureException: vi.fn(),
  serverCaptureEvent: vi.fn(),
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
vi.mock('~/server/db/models/AudioAsset', () => ({
  AudioAsset: {
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    findOne: vi.fn(),
    deleteOne: vi.fn(),
  },
}));

import { AudioAsset } from '~/server/db/models/AudioAsset';
import { serverCaptureException } from '~/server/utils/telemetry';

/**
 * `updateAudioAsset` chains `.lean()` off `findOneAndUpdate(...)` (returning a
 * plain object, not a hydrated Mongoose Document — required so its
 * array/subdocument fields serialize over the server-fn boundary; see that
 * function's doc comment). Mirrors the shape of a real Mongoose Query here so
 * the mock stays a faithful stand-in for `.findOneAndUpdate(...).lean()`.
 */
function mockUpdateResult(doc: Record<string, unknown> | null) {
  vi.mocked(AudioAsset.findOneAndUpdate).mockReturnValue({
    lean: () => Promise.resolve(doc),
  } as never);
}

describe('updateAudioAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes the update to the owner', async () => {
    mockUpdateResult({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await updateAudioAsset({ data: { id: 'a1', title: 'New' }, userId: 'u1' });
    expect(vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });
  });

  it('sets only the fields actually provided, leaving the rest untouched', async () => {
    mockUpdateResult({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await updateAudioAsset({ data: { id: 'a1', title: 'New Title' }, userId: 'u1' });
    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    // Only `title` (plus the always-bumped updatedAt) should be present — kind,
    // environment, mood, intensity, and tags were never passed and must not appear
    // as explicit `undefined`/null overwrites.
    expect(update.$set).toEqual({ title: 'New Title', updatedAt: expect.any(Date) });
    expect('kind' in update.$set).toBe(false);
    expect('tags' in update.$set).toBe(false);
  });

  it('normalizes tags when tags are provided', async () => {
    mockUpdateResult({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await updateAudioAsset({
      data: { id: 'a1', tags: [' Storm ', '#storm', 'RAIN'] },
      userId: 'u1',
    });
    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.tags).toEqual(['storm', 'rain']);
  });

  it('throws when the asset does not exist (or belongs to another owner)', async () => {
    mockUpdateResult(null);
    const { updateAudioAsset } = await import('~/server/functions/audio');
    await expect(
      updateAudioAsset({ data: { id: 'a1', title: 'X' }, userId: 'u2' })
    ).rejects.toThrow(/not found/i);
  });

  /**
   * `durationSamples` is a cross-service contract field: the worker writes it,
   * the serializer is the only thing that can carry it to the client, and phase
   * 2's gapless looping is the consumer. Dropping it here would leave phase 2
   * silently back on `durationMs`, whose millisecond rounding is the ±24-sample
   * error the field exists to remove.
   */
  it('carries the worker-written durationSamples through serialization', async () => {
    mockUpdateResult({
      _id: 'a1',
      ownerId: 'u1',
      durationMs: 2007,
      durationSamples: 96_313,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const { updateAudioAsset } = await import('~/server/functions/audio');
    const res = await updateAudioAsset({ data: { id: 'a1', title: 'New' }, userId: 'u1' });
    expect(res.durationSamples).toBe(96_313);
    // Not recomputed from the rounded milliseconds — that would be 96 336.
    expect(res.durationSamples).not.toBe(res.durationMs! * 48);
  });

  it('reports durationSamples as null for an asset the worker has not processed yet', async () => {
    mockUpdateResult({
      _id: 'a1',
      ownerId: 'u1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const { updateAudioAsset } = await import('~/server/functions/audio');
    const res = await updateAudioAsset({ data: { id: 'a1', title: 'New' }, userId: 'u1' });
    expect(res.durationSamples).toBeNull();
  });
});

describe('bulkTagAudioAssets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('add mode uses $addToSet with $each and normalizes tags, scoped by ownerId', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 2 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    const res = await bulkTagAudioAssets({
      data: { ids: ['a', 'b'], tags: [' Storm ', '#storm'], tagMode: 'add' },
      userId: 'u1',
    });

    const [filter, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ _id: { $in: ['a', 'b'] }, ownerId: 'u1' });
    expect(update.$addToSet).toEqual({ tags: { $each: ['storm'] } });
    expect((update.$set as Record<string, unknown>).tags).toBeUndefined();
    expect(res).toEqual({ modified: 2 });
  });

  it('replace mode uses $set with the full normalized tag array, scoped by ownerId', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    await bulkTagAudioAssets({
      data: { ids: ['a'], tags: [' Storm ', 'RAIN'], tagMode: 'replace' },
      userId: 'u1',
    });

    const [filter, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ _id: { $in: ['a'] }, ownerId: 'u1' });
    expect(update.$addToSet).toBeUndefined();
    expect((update.$set as Record<string, unknown>).tags).toEqual(['storm', 'rain']);
  });

  it('sets facet fields via $set when provided, without requiring tags', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    await bulkTagAudioAssets({
      data: { ids: ['a'], environment: ['forest'], intensity: 3, tagMode: 'add' },
      userId: 'u1',
    });

    const [, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect((update.$set as Record<string, unknown>).environment).toEqual(['forest']);
    expect((update.$set as Record<string, unknown>).intensity).toBe(3);
    expect(update.$addToSet).toBeUndefined();
  });

  it('replace mode with an empty tags array clears the tags ($set.tags === [])', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    await bulkTagAudioAssets({
      data: { ids: ['a'], tags: [], tagMode: 'replace' },
      userId: 'u1',
    });

    const [, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    // Empty replace is a meaningful "clear the tags" request, not a no-op — tags:
    // [] absent from the schema's .min(1) means this is a valid, deliberate input.
    expect((update.$set as Record<string, unknown>).tags).toEqual([]);
    expect(update.$addToSet).toBeUndefined();
  });

  it('add mode with an empty tags array is a no-op: no $addToSet emitted', async () => {
    vi.mocked(AudioAsset.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
    const { bulkTagAudioAssets } = await import('~/server/functions/audio');

    await bulkTagAudioAssets({
      data: { ids: ['a'], tags: [], tagMode: 'add' },
      userId: 'u1',
    });

    const [, update] = vi.mocked(AudioAsset.updateMany).mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    // Nothing to add — unlike replace, an empty add must not touch tags at all.
    expect(update.$addToSet).toBeUndefined();
    expect((update.$set as Record<string, unknown>).tags).toBeUndefined();
  });
});

describe('retryAudioAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requeues a failed asset and resets the entire queue state', async () => {
    mockUpdateResult({
      _id: 'a1',
      ownerId: 'u1',
      status: 'pending',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const { retryAudioAsset } = await import('~/server/functions/audio');
    const res = await retryAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    const [filter, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    // Scoped to `failed`: this must never be usable to yank a `ready` asset
    // back through the worker. And to `confirmedAt != null`: see the
    // "retry eligibility (property)" block below, which is what actually
    // proves that clause excludes anything.
    expect(filter).toEqual({
      _id: 'a1',
      ownerId: 'u1',
      status: 'failed',
      confirmedAt: { $ne: null },
      permanentFailure: { $ne: true },
    });
    expect(update.$set.status).toBe('pending');
    // The row exhausted its budget — a retry that re-failed at the cap would be
    // no retry at all.
    expect(update.$set.attempts).toBe(0);
    expect(update.$set.lastError).toBeNull();
    // Cleared so the worker's claim query (which gates on nextAttemptAt) can
    // pick it up on the very next pass instead of waiting out a stale backoff.
    expect(update.$set.nextAttemptAt).toBeNull();
    expect(update.$set.claimedAt).toBeNull();
    expect(update.$set.claimedBy).toBeNull();
    expect(res.status).toBe('pending');
  });

  it('refuses an asset that is not failed (or belongs to another owner)', async () => {
    mockUpdateResult(null);
    const { retryAudioAsset } = await import('~/server/functions/audio');
    await expect(retryAudioAsset({ data: { id: 'a1' }, userId: 'u1' })).rejects.toThrow(
      /cannot be retried/i
    );
  });

  /**
   * The property, not the shape.
   *
   * A previous version of this guard filtered on `sourceBytes: { $ne: null }`
   * and was a tautology: `createAudioUpload` seeded `sourceBytes` at row
   * creation from the client's self-declared `data.bytes`, so it was non-null
   * for every row that had ever existed and the clause excluded nothing. The
   * test that accompanied it passed because it only asserted the filter
   * literal — it checked the code that was written, not the property that was
   * needed. So this test never names a field: it runs the REAL creation,
   * confirm, and retry code paths and evaluates the actual filter against the
   * actual document each path produces. Any future guard whose premise is false
   * fails here regardless of how it is spelled.
   *
   * The attack it closes: declare `bytes: 1MB`, PUT 1 GB to the presigned URL,
   * never confirm (confirm's HeadObject is the only real enforcement of
   * AUDIO_MAX_BYTES — a presigned PUT cannot constrain Content-Length), wait
   * out the worker's upload reaper, click Retry. `processAsset` then buffers
   * the whole unmeasured object into memory via `transformToByteArray` in a pod
   * capped at 768Mi: OOM, requeue, OOM ×3, failed, Retry, indefinitely.
   */
  describe('retry eligibility (property)', () => {
    /**
     * Minimal Mongo filter evaluator — equality and `{ $ne }` only, which is
     * all `retryAudioAsset`'s filter uses. Deliberately not general: a fuller
     * matcher would become its own source of bugs. Absent fields read as null,
     * matching Mongo's equality-to-null semantics.
     */
    function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
      return Object.entries(filter).every(([key, condition]) => {
        const value = doc[key] ?? null;
        if (condition && typeof condition === 'object' && '$ne' in condition) {
          return value !== (condition as { $ne: unknown }).$ne;
        }
        return value === condition;
      });
    }

    it('excludes a row that never passed confirm, and admits one that did', async () => {
      const { createAudioUpload, confirmAudioUpload, retryAudioAsset } =
        await import('~/server/functions/audio');

      // --- 1. The real creation path, with a lie about the size. ---
      vi.mocked(AudioAsset.create).mockResolvedValue({ _id: 'a1' } as never);
      await createAudioUpload({
        data: {
          filename: 'huge.wav',
          contentType: 'audio/wav',
          bytes: 1_000_000, // claimed 1MB; the actual PUT body is never checked
          kind: 'ambience',
          environment: [],
          mood: [],
          tags: [],
        },
        userId: 'u1',
      });
      const createdRow = vi.mocked(AudioAsset.create).mock.calls[0][0] as Record<string, unknown>;

      // --- 2. The real confirm path, capturing exactly what it writes. ---
      vi.mocked(AudioAsset.findOne).mockResolvedValue({
        _id: 'a1',
        ownerId: 'u1',
        sourceKey: 'uploads/audio/1-a.wav',
        status: 'uploading',
      } as never);
      send.mockResolvedValue({ ContentLength: 1024, ContentType: 'audio/wav' });
      vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({
        _id: 'a1',
        status: 'pending',
      } as never);
      await confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u1' });
      const confirmWrites = (
        vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0][1] as { $set: Record<string, unknown> }
      ).$set;

      // --- 3. The real retry path, capturing the filter it actually issues. ---
      vi.mocked(AudioAsset.findOneAndUpdate).mockReset();
      mockUpdateResult(null);
      await expect(retryAudioAsset({ data: { id: 'a1' }, userId: 'u1' })).rejects.toThrow(
        /cannot be retried/i
      );
      const retryFilter = vi.mocked(AudioAsset.findOneAndUpdate).mock
        .calls[0][0] as unknown as Record<string, unknown>;

      // --- 4. The two rows, built only from what the real code above wrote. ---

      // The attack row: created, abandoned, then aged out of `uploading` by the
      // worker's reaper. reapStale's uploading clause sets exactly these fields
      // and touches nothing else — see audio-worker/src/claim.ts.
      const neverConfirmed = {
        _id: 'a1',
        ...createdRow,
        status: 'failed',
        lastError: 'Upload never completed',
      };

      // The legitimate row: confirm succeeded, the worker then failed the
      // transcode. This one MUST stay retryable — a guard that blocked it would
      // silently delete the feature.
      const confirmedThenFailed = {
        _id: 'a1',
        ...createdRow,
        ...confirmWrites,
        status: 'failed',
        lastError: 'ffmpeg exited 1',
      };

      expect(matchesFilter(neverConfirmed, retryFilter)).toBe(false);
      expect(matchesFilter(confirmedThenFailed, retryFilter)).toBe(true);
    });

    /**
     * The same technique applied to the OTHER thing a retry must not resurrect.
     *
     * The worker marks a row `permanentFailure: true` only when it rejected the
     * source itself — over the 30-minute cap, zero decoded samples, wholly
     * silent, truncated mid-payload (`PermanentError`, audio-worker/src/errors.ts).
     * Those files fail identically every run, so each Retry click buys another
     * full decode of pinned CPU on a single-node cluster and changes nothing.
     * A row that merely exhausted its attempts against an R2 blip carries
     * `permanentFailure: false` and MUST stay retryable — a guard that blocked
     * it would silently delete the feature this function exists for.
     */
    it('excludes a permanently-failed row, and admits a transiently-failed or legacy one', async () => {
      const { retryAudioAsset } = await import('~/server/functions/audio');
      vi.mocked(AudioAsset.findOneAndUpdate).mockReset();
      mockUpdateResult(null);
      await expect(retryAudioAsset({ data: { id: 'a1' }, userId: 'u1' })).rejects.toThrow(
        /cannot be retried/i
      );
      const retryFilter = vi.mocked(AudioAsset.findOneAndUpdate).mock
        .calls[0][0] as unknown as Record<string, unknown>;

      const base = {
        _id: 'a1',
        ownerId: 'u1',
        status: 'failed',
        confirmedAt: new Date(),
      };

      // The worker rejected the file: "Audio file is completely silent".
      expect(matchesFilter({ ...base, permanentFailure: true }, retryFilter)).toBe(false);
      // The worker ran out of attempts against a transient fault.
      expect(matchesFilter({ ...base, permanentFailure: false }, retryFilter)).toBe(true);
      // Written before the field existed — must not become un-retryable by
      // accident, which is why the clause is `$ne: true` and not `false`.
      expect(matchesFilter(base, retryFilter)).toBe(true);
    });

    it('leaves the unverified client-declared size out of the created row entirely', async () => {
      vi.mocked(AudioAsset.create).mockResolvedValue({ _id: 'a1' } as never);
      const { createAudioUpload } = await import('~/server/functions/audio');
      await createAudioUpload({
        data: {
          filename: 'huge.wav',
          contentType: 'audio/wav',
          bytes: 1_000_000,
          kind: 'ambience',
          environment: [],
          mood: [],
          tags: [],
        },
        userId: 'u1',
      });

      const created = vi.mocked(AudioAsset.create).mock.calls[0][0] as Record<string, unknown>;
      // `bytes` is whatever the uploader typed into the request. Persisting it
      // made `sourceBytes` read as a measured size when nothing had measured
      // anything — which is exactly how the tautological guard above came to
      // look correct. The real size arrives from confirm's HeadObject.
      expect(created.sourceBytes).toBeNull();
      expect(created.confirmedAt).toBeNull();
    });
  });
});

describe('deleteAudioAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes every R2 object (source + each rendition) before deleting the row, scoped by ownerId', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
      renditions: { opus: { key: 'opus-key' }, aac: { key: 'aac-key' } },
    } as never);
    vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    const res = await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    expect(vi.mocked(AudioAsset.findOne).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });

    expect(send).toHaveBeenCalledTimes(3);
    const calls = send.mock.calls.map(([cmd]) => cmd as DeleteObjectCommand);
    for (const cmd of calls) expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    const keys = calls.map((c) => c.input.Key).sort();
    expect(keys).toEqual(['aac-key', 'opus-key', 'src-key']);
    for (const cmd of calls) expect(cmd.input.Bucket).toBe('b');

    expect(vi.mocked(AudioAsset.deleteOne).mock.calls[0][0]).toEqual({
      _id: 'a1',
      ownerId: 'u1',
    });
    expect(res).toEqual({ deleted: true });
  });

  it('deletes only the objects that exist when a rendition is missing', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
      renditions: { opus: { key: 'opus-key' } },
    } as never);
    vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    expect(send).toHaveBeenCalledTimes(2);
    const keys = send.mock.calls.map(([cmd]) => (cmd as DeleteObjectCommand).input.Key).sort();
    expect(keys).toEqual(['opus-key', 'src-key']);
  });

  it('still deletes the row (and the remaining objects) when an R2 delete fails', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      sourceKey: 'src-key',
      renditions: { opus: { key: 'opus-key' }, aac: { key: 'aac-key' } },
    } as never);
    vi.mocked(AudioAsset.deleteOne).mockResolvedValue({ deletedCount: 1 } as never);
    send
      .mockResolvedValueOnce(undefined) // sourceKey succeeds
      .mockRejectedValueOnce(new Error('R2 unavailable')) // opus-key fails
      .mockResolvedValueOnce(undefined); // aac-key must still be attempted

    const { deleteAudioAsset } = await import('~/server/functions/audio');
    const res = await deleteAudioAsset({ data: { id: 'a1' }, userId: 'u1' });

    // R2 deletion is best-effort: one failing object must neither abort the
    // remaining deletes nor reject the mutation. Without this the CI E2E job —
    // which runs with deliberately fake R2 credentials, so every
    // DeleteObjectCommand dies on the TLS handshake — can never delete an
    // asset at all, and the confirm dialog hangs open forever.
    expect(res).toEqual({ deleted: true });
    expect(send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(AudioAsset.deleteOne).mock.calls[0][0]).toEqual({ _id: 'a1', ownerId: 'u1' });

    // The failure is still reported — a systematically failing R2 delete must be
    // visible, not silently swallowed into storage cost.
    const reported = vi
      .mocked(serverCaptureException)
      .mock.calls.find(
        ([, , props]) =>
          (props as Record<string, unknown> | undefined)?.action === 'deleteAudioAsset.r2Object'
      );
    expect(reported).toBeDefined();
    expect((reported?.[0] as Error).message).toMatch(/R2 unavailable/);
    expect(reported?.[2]).toMatchObject({ key: 'opus-key', assetId: 'a1' });
  });

  it("does not touch R2 or delete the row for another owner's asset", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(null as never);
    const { deleteAudioAsset } = await import('~/server/functions/audio');
    await expect(deleteAudioAsset({ data: { id: 'a1' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
    expect(vi.mocked(AudioAsset.findOne).mock.calls[0][0]).toEqual({ _id: 'a1', ownerId: 'u2' });
    expect(send).not.toHaveBeenCalled();
    expect(AudioAsset.deleteOne).not.toHaveBeenCalled();
  });
});
