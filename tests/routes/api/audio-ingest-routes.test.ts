import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The two ingest HTTP routes (`~/routes/api/audio/uploads*`) are the contract
 * phase 3's Python generator talks to. Their status codes are part of that
 * contract: an external client's retry logic keys off 4xx-vs-5xx, so a
 * retryable R2/Mongo outage reported as 400 makes the tool give up on work it
 * should have retried.
 *
 * `createFileRoute` is mocked to an identity-ish factory (same approach as
 * tests/routes/audio-route.test.tsx) so the module can be imported outside a
 * router; only the exported `post` handlers are under test.
 */
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}));

const resolveApiUser = vi.fn();
vi.mock('~/server/functions/audio-auth', () => ({
  resolveApiUser: (...args: unknown[]) => resolveApiUser(...args),
}));

const createAudioUpload = vi.fn();
const confirmAudioUpload = vi.fn();
vi.mock('~/server/functions/audio', () => ({
  createAudioUpload: (...args: unknown[]) => createAudioUpload(...args),
  confirmAudioUpload: (...args: unknown[]) => confirmAudioUpload(...args),
}));

function bearerRequest(body?: unknown): Request {
  return new Request('https://app.test/api/audio/uploads', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  resolveApiUser.mockReset();
  createAudioUpload.mockReset();
  confirmAudioUpload.mockReset();
  resolveApiUser.mockResolvedValue('mongo-id-1');
});

describe('POST /api/audio/uploads/:id/confirm', () => {
  async function callConfirm(): Promise<Response> {
    const { post } = await import('~/routes/api/audio/uploads.$id.confirm');
    return post({ request: bearerRequest(), params: { id: 'a1' } });
  }

  it('401s without a resolvable bearer identity', async () => {
    resolveApiUser.mockResolvedValue(null);
    const res = await callConfirm();
    expect(res.status).toBe(401);
    expect(confirmAudioUpload).not.toHaveBeenCalled();
  });

  it('returns the confirm result on success', async () => {
    confirmAudioUpload.mockResolvedValue({ assetId: 'a1', status: 'pending' });
    const res = await callConfirm();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ assetId: 'a1', status: 'pending' });
  });

  it.each([
    'Audio asset not found',
    'File too large: 99 bytes exceeds 10',
    'Unsupported audio type: image/png',
    'Audio asset is not awaiting confirmation',
  ])('400s with the verbatim message for caller error %j', async (message) => {
    confirmAudioUpload.mockRejectedValue(new Error(message));
    const res = await callConfirm();
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: message });
  });

  it('500s (not 400s) for an infrastructure failure, and does not echo it', async () => {
    // A retryable R2/Mongo outage. Reported as 400 an external client treats it
    // as permanent and stops retrying — and POST /api/audio/uploads already
    // returns 500 for this exact failure class, so the two routes disagreed.
    confirmAudioUpload.mockRejectedValue(new Error('connect ETIMEDOUT bucket.r2.example'));
    const res = await callConfirm();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Confirm failed' });
  });
});

describe('POST /api/audio/uploads', () => {
  const VALID_BODY = {
    filename: 'storm.wav',
    contentType: 'audio/wav',
    bytes: 1024,
    kind: 'ambience',
  };

  async function callCreate(body?: unknown): Promise<Response> {
    const { post } = await import('~/routes/api/audio/uploads');
    return post({ request: bearerRequest(body) });
  }

  it('401s without a resolvable bearer identity', async () => {
    resolveApiUser.mockResolvedValue(null);
    expect((await callCreate(VALID_BODY)).status).toBe(401);
    expect(createAudioUpload).not.toHaveBeenCalled();
  });

  it('400s on a payload the schema rejects', async () => {
    const res = await callCreate({ filename: 'x.wav' });
    expect(res.status).toBe(400);
    expect(createAudioUpload).not.toHaveBeenCalled();
  });

  it('passes the resolved bearer identity through as userId', async () => {
    createAudioUpload.mockResolvedValue({ assetId: 'a1', uploadUrl: 'u', key: 'k' });
    const res = await callCreate(VALID_BODY);
    expect(res.status).toBe(200);
    expect(createAudioUpload.mock.calls[0][0]).toMatchObject({ userId: 'mongo-id-1' });
  });

  it('500s on an infrastructure failure', async () => {
    createAudioUpload.mockRejectedValue(new Error('R2 configuration incomplete'));
    const res = await callCreate(VALID_BODY);
    expect(res.status).toBe(500);
  });
});
