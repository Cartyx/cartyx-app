import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AudioAssetData } from '~/types/audio';

const listAudioAssetsFn = vi.fn();
const bulkTagAudioAssetsFn = vi.fn();
const updateAudioAssetFn = vi.fn();
const deleteAudioAssetFn = vi.fn();

const retryAudioAssetFn = vi.fn();

vi.mock('~/utils/audio-server-fns', () => ({
  listAudioAssetsFn: (...args: unknown[]) => listAudioAssetsFn(...args),
  bulkTagAudioAssetsFn: (...args: unknown[]) => bulkTagAudioAssetsFn(...args),
  updateAudioAssetFn: (...args: unknown[]) => updateAudioAssetFn(...args),
  deleteAudioAssetFn: (...args: unknown[]) => deleteAudioAssetFn(...args),
  retryAudioAssetFn: (...args: unknown[]) => retryAudioAssetFn(...args),
}));

// Topbar reads the session through useAuth; stub it so the route can render it
// without a router/auth provider.
const useAuth = vi.fn(() => ({ user: { id: 'u1', name: 'GM' }, logout: vi.fn() }));
vi.mock('~/hooks/useAuth', () => ({ useAuth: () => useAuth() }));

const getMe = vi.fn();
vi.mock('~/server/functions/rpc', () => ({ getMe: (...args: unknown[]) => getMe(...args) }));

const captureException = vi.fn();
vi.mock('~/utils/telemetry-client', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureEvent: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: (opts: unknown) => opts,
  // Topbar/UserMenu render <Link>s; a plain anchor is enough to assert the nav
  // chrome mounted without standing up a real router.
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// Replaces the real AudioWaveform (up to ~400 <rect>s per row) with a call
// counter, mirroring AudioLibraryBrowser.test.tsx's own memoization guard —
// here to prove the ROUTE's callbacks (not just the browser's pass-through)
// are stable enough for AudioAssetRow's React.memo to bail out.
const { waveformSpy } = vi.hoisted(() => ({ waveformSpy: vi.fn(() => null) }));
vi.mock('~/components/audio/AudioWaveform', () => ({ AudioWaveform: waveformSpy }));

import {
  AudioLibraryPage,
  shouldPoll,
  audioBeforeLoad,
  pickPlaybackSources,
  flattenAudioPages,
} from '~/routes/audio';

function mkAsset(overrides: Partial<AudioAssetData> = {}): AudioAssetData {
  return {
    id: 'a1',
    ownerId: 'u1',
    title: 'Storm — Heavy',
    kind: 'ambience',
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 10_000,
    durationSamples: 480_000,
    loudnessTargetLufs: -20,
    peaks: [0.1, 0.5, 0.3],
    renditions: { opus: { key: 'k1', url: 'https://cdn.example/a1.ogg', bytes: 100 } },
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AudioLibraryPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  listAudioAssetsFn.mockReset();
  bulkTagAudioAssetsFn.mockReset();
  updateAudioAssetFn.mockReset();
  deleteAudioAssetFn.mockReset();
  retryAudioAssetFn.mockReset();
  captureException.mockReset();
  getMe.mockReset();
  listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
});

describe('flattenAudioPages', () => {
  it('concatenates every loaded page in order', () => {
    const p1 = mkAsset({ id: 'a1' });
    const p2 = mkAsset({ id: 'a2' });
    expect(
      flattenAudioPages({
        pages: [
          { items: [p1], nextCursor: 'c' },
          { items: [p2], nextCursor: null },
        ],
      })
    ).toEqual([p1, p2]);
  });

  it('returns an empty list before anything has loaded', () => {
    expect(flattenAudioPages(undefined)).toEqual([]);
  });

  it('keeps the poll alive for an in-flight asset on a later page', () => {
    // A naive `pages[0].items` would go quiet the moment the user loaded a
    // second page containing the only unfinished asset.
    const flat = flattenAudioPages({
      pages: [
        { items: [mkAsset({ id: 'a1', status: 'ready' })], nextCursor: 'c' },
        { items: [mkAsset({ id: 'a2', status: 'pending' })], nextCursor: null },
      ],
    });
    expect(shouldPoll(flat)).toBe(true);
  });
});

describe('shouldPoll', () => {
  it('polls only while an asset is still processing', async () => {
    expect(shouldPoll([{ status: 'ready' }, { status: 'failed' }] as never)).toBe(false);
    expect(shouldPoll([{ status: 'ready' }, { status: 'pending' }] as never)).toBe(true);
    expect(shouldPoll([{ status: 'processing' }] as never)).toBe(true);
    expect(shouldPoll([] as never)).toBe(false);
  });
});

describe('beforeLoad auth guard', () => {
  it('redirects to / with session_expired when there is no user', async () => {
    getMe.mockResolvedValue(null);
    await expect(audioBeforeLoad()).rejects.toMatchObject({
      to: '/',
      search: { reason: 'session_expired' },
    });
  });

  it('lets the request through and returns the user when a session exists', async () => {
    getMe.mockResolvedValue({ id: 'u1', role: 'gm' });
    await expect(audioBeforeLoad()).resolves.toEqual({ user: { id: 'u1', role: 'gm' } });
  });
});

describe('pickPlaybackSources', () => {
  it('offers an opus source when present', () => {
    const asset = mkAsset({
      renditions: { opus: { key: 'k', url: 'https://cdn/x.ogg', bytes: 1 } },
    });
    expect(pickPlaybackSources(asset)).toEqual([{ src: 'https://cdn/x.ogg', type: 'audio/ogg' }]);
  });

  it('offers an aac source when present', () => {
    const asset = mkAsset({
      renditions: { aac: { key: 'k', url: 'https://cdn/x.m4a', bytes: 1 } },
    });
    expect(pickPlaybackSources(asset)).toEqual([{ src: 'https://cdn/x.m4a', type: 'audio/mp4' }]);
  });

  it('offers both when both renditions exist, opus first', () => {
    const asset = mkAsset({
      renditions: {
        opus: { key: 'k', url: 'https://cdn/x.ogg', bytes: 1 },
        aac: { key: 'k2', url: 'https://cdn/x.m4a', bytes: 1 },
      },
    });
    expect(pickPlaybackSources(asset)).toEqual([
      { src: 'https://cdn/x.ogg', type: 'audio/ogg' },
      { src: 'https://cdn/x.m4a', type: 'audio/mp4' },
    ]);
  });

  it('returns no candidates when neither rendition has finished transcoding', () => {
    const asset = mkAsset({ renditions: {} });
    expect(pickPlaybackSources(asset)).toEqual([]);
  });
});

describe('AudioLibraryPage', () => {
  it('lists assets returned by listAudioAssetsFn', async () => {
    listAudioAssetsFn.mockResolvedValue({
      items: [mkAsset({ id: 'a1', title: 'Storm' })],
      nextCursor: null,
    });
    renderPage();
    expect(await screen.findByText('Storm')).toBeInTheDocument();
  });

  it('does not render a playable element for an asset with no finished renditions', async () => {
    listAudioAssetsFn.mockResolvedValue({
      items: [mkAsset({ id: 'a1', title: 'Storm', renditions: {}, status: 'ready' })],
      nextCursor: null,
    });
    renderPage();
    await screen.findByText('Storm');
    // Play button is only rendered for ready assets by AudioAssetRow, so we can click it,
    // but no <audio> element should ever mount for a rendition-less asset.
    const playButton = screen.queryByRole('button', { name: /play storm/i });
    if (playButton) await userEvent.click(playButton);
    expect(document.querySelector('audio')).not.toBeInTheDocument();
  });

  it('renders a playable audio element with source candidates when Play is clicked', async () => {
    listAudioAssetsFn.mockResolvedValue({
      items: [
        mkAsset({
          id: 'a1',
          title: 'Storm',
          renditions: { opus: { key: 'k', url: 'https://cdn/storm.ogg', bytes: 1 } },
        }),
      ],
      nextCursor: null,
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /play storm/i }));
    const audioEl = document.querySelector('audio');
    expect(audioEl).toBeInTheDocument();
    const source = audioEl?.querySelector('source');
    expect(source?.getAttribute('src')).toBe('https://cdn/storm.ogg');
    expect(source?.getAttribute('type')).toBe('audio/ogg');
  });

  describe('bulk tag apply guard', () => {
    it('does not call bulkTagAudioAssetsFn when Apply is clicked with an untouched payload', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' })],
        nextCursor: null,
      });
      renderPage();
      await userEvent.click(await screen.findByRole('checkbox', { name: /select storm/i }));

      const applyButton = await screen.findByRole('button', { name: /^apply$/i });
      expect(applyButton).toBeDisabled();
      await userEvent.click(applyButton);
      expect(bulkTagAudioAssetsFn).not.toHaveBeenCalled();
    });

    it('clears the selection after a successful bulk apply', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' })],
        nextCursor: null,
      });
      bulkTagAudioAssetsFn.mockResolvedValue({ modified: 1 });
      renderPage();

      await userEvent.click(await screen.findByRole('checkbox', { name: /select storm/i }));
      await userEvent.type(screen.getByLabelText(/tags to apply/i), 'wind');
      await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

      await waitFor(() =>
        expect(bulkTagAudioAssetsFn).toHaveBeenCalledWith({
          data: { ids: ['a1'], tags: ['wind'], tagMode: 'add' },
        })
      );

      // Selection cleared: the bulk tag bar (only rendered when something is
      // selected) disappears, and the row's checkbox reverts to unchecked.
      await waitFor(() => expect(screen.queryByText(/1 selected/i)).not.toBeInTheDocument());
      expect(screen.getByRole('checkbox', { name: /select storm/i })).not.toBeChecked();
    });

    it('surfaces an error and does not clear selection when the bulk apply fails', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' })],
        nextCursor: null,
      });
      bulkTagAudioAssetsFn.mockRejectedValue(new Error('bulk tag boom'));
      renderPage();

      await userEvent.click(await screen.findByRole('checkbox', { name: /select storm/i }));
      await userEvent.type(screen.getByLabelText(/tags to apply/i), 'wind');
      await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

      expect(await screen.findByText(/bulk tag boom/i)).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /select storm/i })).toBeChecked();
    });
  });

  describe('delete', () => {
    it('keeps the confirm dialog open and shows an error when the delete fails', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' })],
        nextCursor: null,
      });
      deleteAudioAssetFn.mockRejectedValue(new Error('delete boom'));
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /delete storm/i }));
      expect(screen.getByText(/delete "storm/i)).toBeInTheDocument();

      const dialog = screen.getByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }));

      expect(await screen.findByText(/failed to delete/i)).toBeInTheDocument();
      // Dialog must still be open — a failed delete must never look like it worked.
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(screen.getByText('Storm')).toBeInTheDocument();
    });

    it('closes the dialog and removes the asset after a successful delete', async () => {
      listAudioAssetsFn
        .mockResolvedValueOnce({ items: [mkAsset({ id: 'a1', title: 'Storm' })], nextCursor: null })
        .mockResolvedValue({ items: [], nextCursor: null });
      deleteAudioAssetFn.mockResolvedValue({ deleted: true });
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /delete storm/i }));
      const dialog = screen.getByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(deleteAudioAssetFn).toHaveBeenCalledWith({ data: { id: 'a1' } });
    });
  });

  describe('edit', () => {
    it('saves only changed fields and closes the modal on success', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' })],
        nextCursor: null,
      });
      updateAudioAssetFn.mockResolvedValue({ ...mkAsset(), title: 'Storm 2' });
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /edit storm/i }));
      const titleInput = await screen.findByLabelText('Title');
      await userEvent.clear(titleInput);
      await userEvent.type(titleInput, 'Storm 2');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() =>
        expect(updateAudioAssetFn).toHaveBeenCalledWith({ data: { id: 'a1', title: 'Storm 2' } })
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('shows a saving state and an error when the save fails, without closing the modal', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' })],
        nextCursor: null,
      });
      updateAudioAssetFn.mockRejectedValue(new Error('save boom'));
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /edit storm/i }));
      const titleInput = await screen.findByLabelText('Title');
      await userEvent.clear(titleInput);
      await userEvent.type(titleInput, 'Storm 2');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(await screen.findByText(/save boom/i)).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('AudioAssetRow memoization', () => {
    it('does not re-render every row waveform when only one row is (de)selected', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' }), mkAsset({ id: 'a2', title: 'Tavern' })],
        nextCursor: null,
      });
      waveformSpy.mockClear();
      renderPage();
      await screen.findByText('Storm');
      await screen.findByText('Tavern');

      const initialCalls = waveformSpy.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);

      await userEvent.click(screen.getByRole('checkbox', { name: /select tavern/i }));

      // Only the Tavern row's props actually changed (selected: false ->
      // true). If the route handed AudioLibraryBrowser a freshly-created
      // inline closure for onToggleSelect/onPlay/onEdit/onDelete on every
      // render, AudioAssetRow's memo would bail out for EVERY row, not just
      // the one that changed, doubling the waveform call count instead of
      // adding exactly one more.
      expect(waveformSpy.mock.calls.length).toBe(initialCalls + 1);
    });
  });

  describe('nav chrome', () => {
    it('renders the shared Topbar so the page is escapable without browser back', async () => {
      listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
      renderPage();
      await screen.findByText(/audio library/i);
      expect(screen.getByRole('link', { name: 'CARTYX' })).toHaveAttribute('href', '/campaigns');
    });
  });

  describe('pagination', () => {
    it('requests the first page with no cursor', async () => {
      listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
      renderPage();
      await waitFor(() => expect(listAudioAssetsFn).toHaveBeenCalled());
      const data = listAudioAssetsFn.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.cursor).toBeUndefined();
      expect(data.limit).toBe(50);
    });

    it('offers no Load more control when the server reports no next page', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm' })],
        nextCursor: null,
      });
      renderPage();
      await screen.findByText('Storm');
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('fetches the next page with the returned cursor and appends its rows', async () => {
      listAudioAssetsFn
        .mockResolvedValueOnce({
          items: [mkAsset({ id: 'a1', title: 'Storm' })],
          nextCursor: 'cursor-1',
        })
        .mockResolvedValueOnce({
          items: [mkAsset({ id: 'a2', title: 'Tavern' })],
          nextCursor: null,
        });
      renderPage();
      await screen.findByText('Storm');

      // Before this, the route hardcoded limit: 50 and never read nextCursor —
      // encodeAudioCursor/decodeAudioCursor had zero production callers and a
      // GM with 60 assets silently never saw 10 of them.
      await userEvent.click(await screen.findByRole('button', { name: /load more/i }));

      expect(await screen.findByText('Tavern')).toBeInTheDocument();
      // The first page's rows are still on screen — this appends, not replaces.
      expect(screen.getByText('Storm')).toBeInTheDocument();
      const secondCall = listAudioAssetsFn.mock.calls[1][0].data as Record<string, unknown>;
      expect(secondCall.cursor).toBe('cursor-1');
      // Control disappears once the last page reports no further cursor.
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
      );
    });
  });

  describe('retry', () => {
    it('requeues a failed asset and refetches the list', async () => {
      listAudioAssetsFn
        .mockResolvedValueOnce({
          items: [
            mkAsset({
              id: 'a1',
              title: 'Storm',
              status: 'failed',
              retryable: true,
              lastError: 'ffmpeg exploded',
            }),
          ],
          nextCursor: null,
        })
        .mockResolvedValue({
          items: [mkAsset({ id: 'a1', title: 'Storm', status: 'pending' })],
          nextCursor: null,
        });
      retryAudioAssetFn.mockResolvedValue(mkAsset({ id: 'a1', status: 'pending' }));
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /retry storm/i }));

      await waitFor(() => expect(retryAudioAssetFn).toHaveBeenCalledWith({ data: { id: 'a1' } }));
      // The row leaves the failed state once the refetched list lands.
      await waitFor(() => expect(screen.getByText(/queued — waiting to process/i)).toBeVisible());
    });

    it('surfaces an error when the retry fails, leaving the row failed', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [
          mkAsset({
            id: 'a1',
            title: 'Storm',
            status: 'failed',
            retryable: true,
            lastError: 'boom',
          }),
        ],
        nextCursor: null,
      });
      retryAudioAssetFn.mockRejectedValue(new Error('retry boom'));
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: /retry storm/i }));
      expect(await screen.findByText(/retry boom/i)).toBeInTheDocument();
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  describe('polling', () => {
    it('stops refetching once every asset has settled', async () => {
      listAudioAssetsFn.mockResolvedValue({
        items: [mkAsset({ id: 'a1', title: 'Storm', status: 'ready' })],
        nextCursor: null,
      });
      renderPage();
      await screen.findByText('Storm');
      expect(listAudioAssetsFn).toHaveBeenCalledTimes(1);
    });
  });
});
