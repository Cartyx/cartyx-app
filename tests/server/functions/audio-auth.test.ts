import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('resolveApiUser', () => {
  it('returns null when no Authorization header is present', async () => {
    const { resolveApiUser } = await import('~/server/functions/audio-auth');
    const r = await resolveApiUser(new Request('https://x.test/api/audio/uploads'));
    expect(r).toBeNull();
  });

  it('returns null for a malformed Authorization header (not a Bearer scheme)', async () => {
    const { resolveApiUser } = await import('~/server/functions/audio-auth');
    const r = await resolveApiUser(
      new Request('https://x.test/api/audio/uploads', {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      })
    );
    expect(r).toBeNull();
  });

  it('returns null for a well-formed bearer token until phase 3 implements issuance', async () => {
    const { resolveApiUser } = await import('~/server/functions/audio-auth');
    const r = await resolveApiUser(
      new Request('https://x.test/api/audio/uploads', {
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
      })
    );
    expect(r).toBeNull();
  });
});

// These pin the critical safety property: an unauthenticated (or not-yet-issuable)
// request must never reach the ingest mutations. A status-code-only assertion would
// still pass if the route ran the mutation first and returned 401 afterward, so each
// case below also asserts the underlying ingest function was not called.

vi.mock('~/server/functions/audio', () => ({
  createAudioUpload: vi.fn(),
  confirmAudioUpload: vi.fn(),
}));

const VALID_UPLOAD_BODY = {
  filename: 'storm.wav',
  contentType: 'audio/wav',
  bytes: 1024,
  kind: 'ambience' as const,
  environment: [],
  mood: [],
  tags: [],
};

describe('POST /api/audio/uploads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects with 401 and never calls createAudioUpload when no Authorization header is present', async () => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    const { post } = await import('~/routes/api/audio/uploads');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads', {
        method: 'POST',
        body: JSON.stringify(VALID_UPLOAD_BODY),
      }),
    });
    expect(res.status).toBe(401);
    expect(createAudioUpload).not.toHaveBeenCalled();
  });

  it('rejects with 401 and never calls createAudioUpload for a malformed Authorization header', async () => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    const { post } = await import('~/routes/api/audio/uploads');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads', {
        method: 'POST',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
        body: JSON.stringify(VALID_UPLOAD_BODY),
      }),
    });
    expect(res.status).toBe(401);
    expect(createAudioUpload).not.toHaveBeenCalled();
  });

  it('rejects with 401 and never calls createAudioUpload for a well-formed bearer token', async () => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    const { post } = await import('~/routes/api/audio/uploads');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads', {
        method: 'POST',
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
        body: JSON.stringify(VALID_UPLOAD_BODY),
      }),
    });
    expect(res.status).toBe(401);
    expect(createAudioUpload).not.toHaveBeenCalled();
  });
});

describe('POST /api/audio/uploads/$id/confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects with 401 and never calls confirmAudioUpload when no Authorization header is present', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    const { post } = await import('~/routes/api/audio/uploads.$id.confirm');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads/a1/confirm', { method: 'POST' }),
      params: { id: 'a1' },
    });
    expect(res.status).toBe(401);
    expect(confirmAudioUpload).not.toHaveBeenCalled();
  });

  it('rejects with 401 and never calls confirmAudioUpload for a malformed Authorization header', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    const { post } = await import('~/routes/api/audio/uploads.$id.confirm');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads/a1/confirm', {
        method: 'POST',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      }),
      params: { id: 'a1' },
    });
    expect(res.status).toBe(401);
    expect(confirmAudioUpload).not.toHaveBeenCalled();
  });

  it('rejects with 401 and never calls confirmAudioUpload for a well-formed bearer token', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    const { post } = await import('~/routes/api/audio/uploads.$id.confirm');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads/a1/confirm', {
        method: 'POST',
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
      }),
      params: { id: 'a1' },
    });
    expect(res.status).toBe(401);
    expect(confirmAudioUpload).not.toHaveBeenCalled();
  });
});

describe('POST /api/audio/uploads — authorized path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls createAudioUpload with the parsed payload and resolved user once authorized', async () => {
    // The earlier tests in this file dynamic-import the route module against the
    // real (unmocked) resolver; module resolution caches that binding, so a fresh
    // registry is required before doMock-ing a different resolveApiUser here.
    vi.resetModules();
    vi.doMock('~/server/functions/audio-auth', () => ({
      resolveApiUser: vi.fn(async () => 'user-1'),
    }));
    const { createAudioUpload } = await import('~/server/functions/audio');
    vi.mocked(createAudioUpload).mockResolvedValue({
      assetId: 'a1',
      uploadUrl: 'https://signed/put',
      key: 'k',
    });
    const { post } = await import('~/routes/api/audio/uploads');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads', {
        method: 'POST',
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
        body: JSON.stringify(VALID_UPLOAD_BODY),
      }),
    });
    expect(res.status).toBe(200);
    expect(createAudioUpload).toHaveBeenCalledWith({
      data: expect.objectContaining({ filename: 'storm.wav' }),
      userId: 'user-1',
    });
    vi.doUnmock('~/server/functions/audio-auth');
  });
});
