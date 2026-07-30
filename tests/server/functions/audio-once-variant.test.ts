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
    });
    // This write must never touch either rendition field — it only presigns
    // and stamps queue state; nothing has been transcoded yet.
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect('renditions' in set).toBe(false);
    expect('onceRenditions' in set).toBe(false);
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
    expect(Object.keys(set).sort()).toEqual(['confirmedAt', 'status', 'updatedAt']);
    expect(set.status).toBe('pending');
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

  it('fails and deletes the object when the once-variant file is too large, without touching the main asset fields', async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue({
      _id: 'a1',
      ownerId: 'u1',
      status: 'uploading',
      variant: 'once',
      onceSourceKey: 'uploads/audio/prefix/once-src.wav',
    } as never);
    send.mockResolvedValue({ ContentLength: 50 * 1024 * 1024 + 1, ContentType: 'audio/wav' });
    vi.mocked(AudioAsset.findOneAndUpdate).mockResolvedValue({ _id: 'a1' } as never);

    const { confirmOnceVariantUpload } = await import('~/server/functions/audio');
    await expect(
      confirmOnceVariantUpload({ data: { assetId: 'a1' }, userId: 'u1' })
    ).rejects.toThrow(/too large/i);

    const deleteCall = send.mock.calls[1][0] as DeleteObjectCommand;
    expect(deleteCall).toBeInstanceOf(DeleteObjectCommand);
    expect(deleteCall.input).toEqual({ Bucket: 'b', Key: 'uploads/audio/prefix/once-src.wav' });

    const [, update] = vi.mocked(AudioAsset.findOneAndUpdate).mock.calls[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set.status).toBe('failed');
    expect(set.permanentFailure).toBe(true);
    expect('renditions' in set).toBe(false);
    expect('onceRenditions' in set).toBe(false);
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
