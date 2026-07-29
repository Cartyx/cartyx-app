import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseDsn, buildEvent, captureException } from '../src/telemetry.js';

/**
 * B8 — `grep captureException audio-worker/src/` used to return nothing. Every
 * other service in this repo reports to GlitchTip (CLAUDE.md's telemetry
 * convention), so worker failures were invisible in the one tool the team
 * watches for exactly this.
 */
const DSN = 'https://abc123@glitchtip.test/7';

afterEach(() => {
  delete process.env.GLITCHTIP_DSN;
  vi.unstubAllGlobals();
});

describe('parseDsn', () => {
  it('derives the store URL and key', () => {
    expect(parseDsn(DSN)).toEqual({
      url: 'https://glitchtip.test/api/7/store/',
      key: 'abc123',
    });
  });

  it.each([undefined, '', 'not a url', 'https://glitchtip.test/7', 'https://abc@glitchtip.test'])(
    'returns null for %j rather than throwing',
    (value) => {
      // A typo'd DSN must degrade to "no telemetry" — never to a crash in the
      // error path of something that was already failing.
      expect(parseDsn(value)).toBeNull();
    }
  );
});

describe('captureException', () => {
  it('is a no-op when no DSN is configured', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    captureException(new Error('boom'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a Sentry-protocol event to the store endpoint', () => {
    process.env.GLITCHTIP_DSN = DSN;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    captureException(new Error('boom'), { assetId: 'a1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://glitchtip.test/api/7/store/');
    expect(init.headers['X-Sentry-Auth']).toContain('sentry_key=abc123');
    const body = JSON.parse(init.body as string);
    expect(body.exception.values[0]).toMatchObject({ type: 'Error', value: 'boom' });
    expect(body.extra.assetId).toBe('a1');
  });

  it('returns without awaiting, and survives an unreachable GlitchTip', async () => {
    process.env.GLITCHTIP_DSN = DSN;
    let settle: () => void = () => undefined;
    const pending = new Promise((_, reject) => {
      settle = () => reject(new Error('unreachable'));
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending)
    );

    // Synchronous return is the contract: this worker is one sequential loop,
    // so anything that blocks in an error path blocks every user's queue.
    expect(captureException(new Error('boom'))).toBeUndefined();
    settle();
    await expect(pending).rejects.toThrow('unreachable');
    // ...and the rejection is handled, so no unhandled rejection kills the pod.
  });
});

describe('buildEvent', () => {
  it('wraps a non-Error throw so the report is still usable', () => {
    const event = buildEvent('just a string');
    expect(event.exception).toMatchObject({ values: [{ value: 'just a string' }] });
  });
});
