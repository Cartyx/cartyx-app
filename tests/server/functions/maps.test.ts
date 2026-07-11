import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/server/utils/requireCampaignMember', () => ({
  requireCampaignMember: vi.fn(),
}));
vi.mock('~/server/db/models/Map', () => ({
  Map: { find: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('~/server/db/models/TabletopScreen', () => ({
  TabletopScreen: { updateOne: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('~/server/db/models/Location', () => ({
  Location: { findOne: vi.fn() },
}));

const mockCreatePartyBroadcastToken = vi.fn();
vi.mock('~/server/session', () => ({
  createPartyBroadcastToken: (...args: unknown[]) => mockCreatePartyBroadcastToken(...args),
}));

import { broadcastActiveMapChanged } from '~/server/functions/maps';

describe('broadcastActiveMapChanged — REALTIME_INTERNAL_HOST resolution', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedEnv.REALTIME_INTERNAL_HOST = process.env.REALTIME_INTERNAL_HOST;
    savedEnv.VITE_PUBLIC_PARTYKIT_HOST = process.env.VITE_PUBLIC_PARTYKIT_HOST;
    delete process.env.REALTIME_INTERNAL_HOST;
    delete process.env.VITE_PUBLIC_PARTYKIT_HOST;

    mockCreatePartyBroadcastToken.mockReset();
    mockCreatePartyBroadcastToken.mockResolvedValue('broadcast-token');

    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    vi.unstubAllGlobals();
  });

  it('no-ops (does not call fetch) when neither host var is set', async () => {
    await broadcastActiveMapChanged('campaign-1', 'map-1', 'screen-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to VITE_PUBLIC_PARTYKIT_HOST when REALTIME_INTERNAL_HOST is unset (local-dev behavior)', async () => {
    process.env.VITE_PUBLIC_PARTYKIT_HOST = 'localhost:1999';
    await broadcastActiveMapChanged('campaign-1', 'map-1', 'screen-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:1999/parties/tabletop_map/tabletop-map-campaign-1');
  });

  it('treats an empty REALTIME_INTERNAL_HOST (dotenv "VAR=" line) as unset and falls through to the fallback host', async () => {
    process.env.REALTIME_INTERNAL_HOST = '';
    process.env.VITE_PUBLIC_PARTYKIT_HOST = 'localhost:1999';
    await broadcastActiveMapChanged('campaign-1', 'map-1', 'screen-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:1999/parties/tabletop_map/tabletop-map-campaign-1');
  });

  it('prefers REALTIME_INTERNAL_HOST over VITE_PUBLIC_PARTYKIT_HOST when both are set', async () => {
    process.env.REALTIME_INTERNAL_HOST = 'realtime:1999';
    process.env.VITE_PUBLIC_PARTYKIT_HOST = 'localhost:1999';
    await broadcastActiveMapChanged('campaign-1', 'map-1', 'screen-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://realtime:1999/parties/tabletop_map/tabletop-map-campaign-1');
  });

  it('uses http (not https) for REALTIME_INTERNAL_HOST even though the hostname is not "localhost"', async () => {
    process.env.REALTIME_INTERNAL_HOST = 'realtime:1999';
    await broadcastActiveMapChanged('campaign-1', null, null);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.startsWith('http://')).toBe(true);
  });

  it('still uses https for a non-local VITE_PUBLIC_PARTYKIT_HOST when REALTIME_INTERNAL_HOST is unset (existing heuristic preserved)', async () => {
    process.env.VITE_PUBLIC_PARTYKIT_HOST = 'realtime.example.com';
    await broadcastActiveMapChanged('campaign-1', null, null);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.startsWith('https://')).toBe(true);
  });

  it('sends the signed broadcast token and payload', async () => {
    process.env.REALTIME_INTERNAL_HOST = 'realtime:1999';
    await broadcastActiveMapChanged('campaign-1', 'map-9', 'screen-2');
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer broadcast-token');
    expect(JSON.parse(init.body)).toEqual({
      type: 'map:active-changed',
      mapId: 'map-9',
      screenId: 'screen-2',
    });
  });

  it('swallows fetch errors (best-effort broadcast)', async () => {
    process.env.REALTIME_INTERNAL_HOST = 'realtime:1999';
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await expect(
      broadcastActiveMapChanged('campaign-1', 'map-1', 'screen-1')
    ).resolves.toBeUndefined();
  });
});
