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

  /**
   * A REFUSAL IS NOT A FAULT — the client half of a rule the server already
   * enforces.
   *
   * `AudioClientError` exists so that a refusal the caller can trigger at
   * will (over quota, over the pending-job cap, rate-limited, a guessed id)
   * files no GlitchTip event, because otherwise report volume is the
   * caller's own parameter. `reportAudioError` implements that server-side.
   * This `catch` used to undo it from the other side of the wire: a GM
   * sitting at their storage quota filed one client error per upload attempt,
   * and a folder drop that met the job cap filed one per refused file.
   *
   * The refusal crosses as a plain `Error` carrying the server class's
   * `name`, which is why the check keys on that (see
   * `~/lib/audio-client-error.ts`) and why this test constructs the rejection
   * the same way the wire does — a real `AudioClientError` instance would
   * pass against an `instanceof` implementation that cannot work in a
   * browser.
   */
  it('files no telemetry for a server refusal, but still rethrows it', async () => {
    const { captureException } = await import('~/utils/telemetry-client');
    const refusal = Object.assign(new Error('Storage quota exceeded: 3 of 2 bytes used.'), {
      name: 'AudioClientError',
    });
    createFn.mockRejectedValue(refusal);

    const { uploadAudioFile } = await import('~/utils/uploadAudio');
    const file = new File([new Uint8Array([1])], 'x.wav', { type: 'audio/wav' });
    await expect(uploadAudioFile(file, { kind: 'ambience' })).rejects.toThrow(/storage quota/i);

    // Rethrown, so the dropzone still renders it against the file. Only the
    // fault report is suppressed.
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it('still files telemetry for a genuine failure', async () => {
    // The control for the test above: without this, deleting the capture call
    // entirely would leave that test green.
    const { captureException } = await import('~/utils/telemetry-client');
    createFn.mockRejectedValue(new Error('502 Bad Gateway'));

    const { uploadAudioFile } = await import('~/utils/uploadAudio');
    const file = new File([new Uint8Array([1])], 'x.wav', { type: 'audio/wav' });
    await expect(uploadAudioFile(file, { kind: 'ambience' })).rejects.toThrow(/bad gateway/i);
    expect(vi.mocked(captureException)).toHaveBeenCalledTimes(1);
  });
});
