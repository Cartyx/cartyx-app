import { describe, it, expect, vi, beforeEach } from 'vitest';

const createFn = vi.fn();
const confirmFn = vi.fn();
vi.mock('~/utils/audio-server-fns', () => ({
  createAudioUploadFn: (...a: unknown[]) => createFn(...a),
  confirmAudioUploadFn: (...a: unknown[]) => confirmFn(...a),
}));
vi.mock('~/utils/telemetry-client', () => ({ captureException: vi.fn() }));
vi.mock('~/utils/backend-health', () => ({
  isBackendDown: () => false,
  reportBackendFailure: vi.fn(),
}));

describe('uploadAudioFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFn.mockResolvedValue({ assetId: 'a1', uploadUrl: 'https://put', key: 'k' });
    confirmFn.mockResolvedValue({ assetId: 'a1', status: 'pending' });
    global.fetch = vi.fn(async () => new Response(null, { status: 200 })) as never;
  });

  it('presigns, PUTs the bytes, then confirms', async () => {
    const { uploadAudioFile } = await import('~/utils/uploadAudio');
    const bytes = new Uint8Array([1, 2, 3]);
    const file = new File([bytes], 'storm.wav', { type: 'audio/wav' });
    const r = await uploadAudioFile(file, { kind: 'ambience' });
    expect(r.assetId).toBe('a1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://put',
      expect.objectContaining({ method: 'PUT' })
    );
    // Pin the actual body/content-type carried by the PUT, not just the URL/method —
    // a call that silently dropped the bytes or sent the wrong content type would
    // still satisfy the assertion above.
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(file);
    expect((init.body as File).type).toBe('audio/wav');
    expect(new Headers(init.headers).get('Content-Type')).toBe('audio/wav');
    expect(confirmFn).toHaveBeenCalled();
  });

  it('does not confirm when the PUT fails', async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 500 })) as never;
    const { uploadAudioFile } = await import('~/utils/uploadAudio');
    const file = new File([new Uint8Array([1])], 'x.wav', { type: 'audio/wav' });
    await expect(uploadAudioFile(file, { kind: 'ambience' })).rejects.toThrow(/upload failed/i);
    expect(confirmFn).not.toHaveBeenCalled();
  });
});
