import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/utils/telemetry', () => ({ serverCaptureException: vi.fn() }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/put'),
}));

import { getSession } from '~/server/session';
import { serverCaptureException } from '~/server/utils/telemetry';

/** A well-formed per-user namespace prefix (see ~/server/functions/audio-storage). */
const PREFIX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

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
      getAudioUploadUrl({
        contentType: 'image/png',
        bytes: 10,
        storagePrefix: PREFIX,
        telemetryUserId: 'u1',
      })
    ).rejects.toThrow(/audio/i);
  });

  it('rejects a declared size over the cap', async () => {
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(
      getAudioUploadUrl({
        contentType: 'audio/wav',
        bytes: 50 * 1024 * 1024 + 1,
        storagePrefix: PREFIX,
        telemetryUserId: 'u1',
      })
    ).rejects.toThrow(/too large/i);
  });

  /**
   * The key must land inside the CALLER'S namespace, not a flat
   * `uploads/audio/` root. The flat layout is what made a stranded source
   * object unattributable: a bucket listing could not say whose it was, so the
   * owner-scoped cleanup could not reclaim it. Asserting only the
   * `uploads/audio/` root would pass against exactly the layout this replaced.
   */
  it("returns a signed url inside the caller's storage namespace", async () => {
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    const r = await getAudioUploadUrl({
      contentType: 'audio/wav',
      bytes: 1024,
      storagePrefix: PREFIX,
      telemetryUserId: 'u1',
    });
    expect(r.key).toMatch(new RegExp(`^uploads/audio/${PREFIX}/[0-9]+-[0-9a-f]+\\.wav$`));
    expect(r.publicUrl).toBe(`https://cdn.test/${r.key}`);
  });

  /**
   * Fail closed. A prefix that is empty, undefined-coerced, or path-bearing
   * would mint an object outside every user's listing prefix — permanently
   * unreclaimable — or, with a traversal, inside somebody else's namespace.
   */
  it.each(['', 'undefined', '../0123456789abcdef0123456789abcdef', 'not-hex'])(
    'refuses to mint a key for the malformed prefix %p',
    async (bad) => {
      const { getAudioUploadUrl } = await import('~/server/functions/uploads');
      await expect(
        getAudioUploadUrl({
          contentType: 'audio/wav',
          bytes: 1024,
          storagePrefix: bad,
          telemetryUserId: 'u1',
        })
      ).rejects.toThrow('Invalid audio storage prefix');
    }
  );

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
    await getAudioUploadUrl({
      contentType: 'audio/wav',
      bytes: 1024,
      storagePrefix: PREFIX,
      telemetryUserId: 'session-provider-id',
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('mints a url for a caller with no session cookie at all', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    const r = await getAudioUploadUrl({
      contentType: 'audio/wav',
      bytes: 1024,
      storagePrefix: PREFIX,
      telemetryUserId: 'token-user',
    });
    expect(r.uploadUrl).toBe('https://signed.example/put');
  });

  it('tags a failure with the caller-supplied id, not a session-derived one', async () => {
    const { getAudioUploadUrl } = await import('~/server/functions/uploads');
    await expect(
      getAudioUploadUrl({
        contentType: 'image/png',
        bytes: 10,
        storagePrefix: PREFIX,
        telemetryUserId: 'session-provider-id',
      })
    ).rejects.toThrow();
    // The caller supplies the telemetry identity, and it must be the one the
    // rest of the app uses — the OAuth provider id that `requireCampaignMember`
    // returns as `sessionUserId` and that `getUploadUrl` above passes. This
    // parameter used to be the Mongo `_id`, so the same human minting an image
    // upload URL and an audio upload URL landed in GlitchTip as two people.
    expect(vi.mocked(serverCaptureException).mock.calls[0][1]).toBe('session-provider-id');
  });
});
