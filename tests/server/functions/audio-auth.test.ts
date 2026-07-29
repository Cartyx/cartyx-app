import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

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

// Shared by both "authorized path" blocks below: the earlier 401 tests in this file
// dynamic-import the route modules against the real (unmocked) resolver, and module
// resolution caches that binding — so a fresh registry is required before doMock-ing
// a resolveApiUser that actually returns a user id.
function mockAuthorizedUser() {
  vi.resetModules();
  vi.doMock('~/server/functions/audio-auth', () => ({
    resolveApiUser: vi.fn(async () => 'user-1'),
  }));
}

describe('POST /api/audio/uploads — authorized path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizedUser();
  });

  afterAll(() => vi.doUnmock('~/server/functions/audio-auth'));

  it('calls createAudioUpload with the parsed payload and resolved user once authorized', async () => {
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
  });

  it('returns 500 with the generic message when createAudioUpload throws, never echoing the raw message', async () => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    vi.mocked(createAudioUpload).mockRejectedValue(
      new Error('AccessDenied: bucket policy forbids PutObject on cartyx-audio-prod')
    );
    const { post } = await import('~/routes/api/audio/uploads');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads', {
        method: 'POST',
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
        body: JSON.stringify(VALID_UPLOAD_BODY),
      }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Upload could not be started' });
    expect(JSON.stringify(body)).not.toContain('cartyx-audio-prod');
    expect(JSON.stringify(body)).not.toContain('AccessDenied');
  });

  it('returns 400 with the generic invalid-payload message for a malformed JSON body, without calling createAudioUpload', async () => {
    const { createAudioUpload } = await import('~/server/functions/audio');
    const { post } = await import('~/routes/api/audio/uploads');
    const res = await post({
      request: new Request('https://x.test/api/audio/uploads', {
        method: 'POST',
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
        body: '{not valid json',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid payload' });
    expect(createAudioUpload).not.toHaveBeenCalled();
  });
});

describe('POST /api/audio/uploads/$id/confirm — authorized path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizedUser();
  });

  afterAll(() => vi.doUnmock('~/server/functions/audio-auth'));

  async function callConfirm() {
    const { post } = await import('~/routes/api/audio/uploads.$id.confirm');
    return post({
      request: new Request('https://x.test/api/audio/uploads/a1/confirm', {
        method: 'POST',
        headers: { authorization: 'Bearer cartyx_pat_whatever' },
      }),
      params: { id: 'a1' },
    });
  }

  it('echoes "Audio asset not found" verbatim with a 400', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    vi.mocked(confirmAudioUpload).mockRejectedValue(new Error('Audio asset not found'));
    const res = await callConfirm();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Audio asset not found' });
  });

  it('echoes a "File too large" message verbatim with a 400', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    const message = 'File too large: 52428801 bytes exceeds 52428800';
    vi.mocked(confirmAudioUpload).mockRejectedValue(new Error(message));
    const res = await callConfirm();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
  });

  it('echoes an "Unsupported audio type" message verbatim with a 400', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    const message = 'Unsupported audio type: audio/ogg';
    vi.mocked(confirmAudioUpload).mockRejectedValue(new Error(message));
    const res = await callConfirm();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
  });

  it('echoes the "not awaiting confirmation" precondition verbatim with a 400', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    // Replaying confirm against an already-ready (or failed) asset is a caller
    // mistake, not infrastructure — permanently wrong, so 400 and don't retry.
    const message = 'Audio asset is not awaiting confirmation';
    vi.mocked(confirmAudioUpload).mockRejectedValue(new Error(message));
    const res = await callConfirm();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
  });

  it('falls back to the generic "Confirm failed" message for a non-domain error and never echoes it', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    // Shaped like a real infra failure (Mongo connection refused) — exactly the
    // class of error the allowlist exists to keep off the wire.
    vi.mocked(confirmAudioUpload).mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:27017')
    );
    const res = await callConfirm();
    // 500, not 400: this failure class is retryable infrastructure, and an
    // external client's retry logic keys off the status code. `POST
    // /api/audio/uploads` already returns 500 here, so 400 also meant the two
    // ingest routes disagreed about the same failure.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Confirm failed' });
    // The negative assertion is what actually protects the allowlist: a future
    // reword of confirmAudioUpload's message text degrading the regex to
    // match-everything would still pass a message-shape check, but not this one.
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('27017');
  });

  it('returns 200 with the confirm result on success', async () => {
    const { confirmAudioUpload } = await import('~/server/functions/audio');
    vi.mocked(confirmAudioUpload).mockResolvedValue({ assetId: 'a1', status: 'pending' });
    const res = await callConfirm();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assetId: 'a1', status: 'pending' });
    expect(confirmAudioUpload).toHaveBeenCalledWith({
      data: { assetId: 'a1' },
      userId: 'user-1',
    });
  });
});
