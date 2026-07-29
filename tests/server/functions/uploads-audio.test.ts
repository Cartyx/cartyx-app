import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/utils/telemetry', () => ({ serverCaptureException: vi.fn() }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/put'),
}));

import { getSession } from '~/server/session';

describe('getAudioUploadUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CDN_URL = 'https://cdn.test';
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'bucket';
  });

  it('rejects an unsupported content type', async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 'u1' } as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(getAudioUploadUrl({ contentType: 'image/png', bytes: 10 })).rejects.toThrow(
      /audio/i
    );
  });

  it('rejects a declared size over the cap', async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 'u1' } as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(
      getAudioUploadUrl({ contentType: 'audio/wav', bytes: 50 * 1024 * 1024 + 1 })
    ).rejects.toThrow(/too large/i);
  });

  it('returns a signed url under the uploads/audio prefix', async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 'u1' } as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    const r = await getAudioUploadUrl({ contentType: 'audio/wav', bytes: 1024 });
    expect(r.key).toMatch(/^uploads\/audio\//);
    expect(r.key).toMatch(/\.wav$/);
    expect(r.publicUrl).toBe(`https://cdn.test/${r.key}`);
  });
});
