import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    // DeleteObjectCommand issued in addition to HeadObjectCommand
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("refuses another user's asset", async () => {
    vi.mocked(AudioAsset.findOne).mockResolvedValue(null as never);
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    await expect(confirmAudioUpload({ data: { assetId: 'a1' }, userId: 'u2' })).rejects.toThrow(
      /not found/i
    );
  });
});
