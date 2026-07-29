import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/utils/telemetry', () => ({ serverCaptureException: vi.fn() }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/put'),
}));

import { getSession } from '~/server/session';
import { serverCaptureException } from '~/server/utils/telemetry';

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
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(
      getAudioUploadUrl({ contentType: 'image/png', bytes: 10, userId: 'u1' })
    ).rejects.toThrow(/audio/i);
  });

  it('rejects a declared size over the cap', async () => {
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(
      getAudioUploadUrl({ contentType: 'audio/wav', bytes: 50 * 1024 * 1024 + 1, userId: 'u1' })
    ).rejects.toThrow(/too large/i);
  });

  it('returns a signed url under the uploads/audio prefix', async () => {
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    const r = await getAudioUploadUrl({ contentType: 'audio/wav', bytes: 1024, userId: 'u1' });
    expect(r.key).toMatch(/^uploads\/audio\//);
    expect(r.key).toMatch(/\.wav$/);
    expect(r.publicUrl).toBe(`https://cdn.test/${r.key}`);
  });

  /**
   * Ingest is one shared module behind two adapters that authenticate
   * differently (session cookie for the browser, bearer token for phase 3's
   * Python generator). Reading the session cookie down here would throw for
   * every token-authenticated call — masked today only because `resolveApiUser`
   * always returns null, and a live 500 the moment phase 3 issues a real token.
   * `getSession` must therefore never be consulted, even when a session exists.
   */
  it('never consults the session — the caller has already authenticated', async () => {
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await getAudioUploadUrl({ contentType: 'audio/wav', bytes: 1024, userId: 'mongo-id-1' });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('mints a url for a caller with no session cookie at all', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    const r = await getAudioUploadUrl({
      contentType: 'audio/wav',
      bytes: 1024,
      userId: 'token-user',
    });
    expect(r.uploadUrl).toBe('https://signed.example/put');
  });

  it('tags a failure with the caller-supplied id, not a session-derived one', async () => {
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(
      getAudioUploadUrl({ contentType: 'image/png', bytes: 10, userId: 'mongo-id-1' })
    ).rejects.toThrow();
    // createAudioUpload tags with the Mongo _id; this used to tag with the
    // session's OAuth provider id, so one failed upload appeared under two
    // different users.
    expect(vi.mocked(serverCaptureException).mock.calls[0][1]).toBe('mongo-id-1');
  });
});
