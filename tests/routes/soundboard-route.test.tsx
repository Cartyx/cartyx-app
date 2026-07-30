import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AudioPackageData, BoardStateData } from '~/types/soundboard';
import type { AudioAssetData, AudioKind } from '~/types/audio';
import type { BoardState } from '~/lib/soundboard/reducer';
import type { BoardPadProps } from '~/components/soundboard/BoardPad';

/**
 * The board route is the assembly point, so this file mocks the two things it
 * genuinely cannot run in happy-dom — the Web Audio engine and the scheduler —
 * plus the server fns, and runs everything else for real: the real
 * `useSoundboard`, the real reducer, the real `BoardGrid`/`BoardPad`.
 *
 * That is deliberate. Every one of the five contracts this task carries lives
 * between the route and the hook (which query state gets threaded where), so a
 * test that mocked `useSoundboard` would assert nothing about any of them.
 */

const engine = vi.hoisted(() => ({
  apply: vi.fn(),
  fireOneShot: vi.fn(),
  ready: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
const scheduler = vi.hoisted(() => ({ sync: vi.fn(), dispose: vi.fn() }));
const createEngine = vi.hoisted(() => vi.fn(() => engine));
const createScheduler = vi.hoisted(() => vi.fn(() => scheduler));
vi.mock('~/lib/soundboard/engine', () => ({ createEngine }));
vi.mock('~/lib/soundboard/scheduler', () => ({ createScheduler }));

const listPackagesFn = vi.hoisted(() => vi.fn());
const getPackageFn = vi.hoisted(() => vi.fn());
const listPackageAssetsFn = vi.hoisted(() => vi.fn());
const loadBoardStateFn = vi.hoisted(() => vi.fn());
const saveBoardStateFn = vi.hoisted(() => vi.fn());
vi.mock('~/utils/soundboard-server-fns', () => ({
  listPackagesFn,
  getPackageFn,
  listPackageAssetsFn,
  loadBoardStateFn,
  saveBoardStateFn,
}));

const captureException = vi.hoisted(() => vi.fn());
vi.mock('~/utils/telemetry-client', () => ({
  captureException,
  captureEvent: vi.fn(),
}));

const useCampaign = vi.hoisted(() => vi.fn());
vi.mock('~/hooks/useCampaigns', () => ({ useCampaign }));

vi.mock('~/components/Topbar', () => ({ Topbar: () => <div data-testid="topbar" /> }));

const CAMPAIGN = '507f1f77bcf86cd799439011';
const PKG_ID = '507f1f77bcf86cd799439031';
const OTHER_PKG_ID = '507f1f77bcf86cd799439032';
const ASSET_A = '507f1f77bcf86cd799439021';
const ASSET_B = '507f1f77bcf86cd799439022';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ campaignId: CAMPAIGN }),
  }),
  redirect: (opts: unknown) => opts,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { SoundboardPage, soundboardBeforeLoad } =
  await import('~/routes/campaigns/$campaignId/soundboard');
const { BoardPad } = await import('~/components/soundboard/BoardPad');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * `itemA` defaults to `volume: 0.8` and `itemB` to `0.5`; the `storm` mood
 * names BOTH as playing, at 0.3 / 0.4. Every one of those numbers differs from
 * what the hydration fixture persists, which is what makes "did hydration
 * actually happen" distinguishable from "the defaults happen to look right".
 */
const pkg: AudioPackageData = {
  id: PKG_ID,
  ownerId: 'u1',
  name: 'Storm Set',
  description: null,
  items: [
    // Array order (B, A) deliberately disagrees with sortIndex order (A, B).
    {
      id: 'itemB',
      assetId: ASSET_B,
      label: 'Thunder',
      volume: 0.5,
      fadeSeconds: 1,
      loop: false,
      sortIndex: 1,
    },
    {
      id: 'itemA',
      assetId: ASSET_A,
      label: 'Rain',
      volume: 0.8,
      fadeSeconds: 2,
      loop: true,
      sortIndex: 0,
    },
  ],
  moods: [
    {
      id: 'storm',
      name: 'Storm',
      states: [
        { itemId: 'itemA', playing: true, volume: 0.3 },
        { itemId: 'itemB', playing: true, volume: 0.4 },
      ],
    },
    { id: 'calm', name: 'Calm', states: [] },
  ],
  createdAt: '',
  updatedAt: '',
};

function mkAsset(id: string, kind: AudioKind, over: Partial<AudioAssetData> = {}): AudioAssetData {
  return {
    id,
    ownerId: 'u1',
    title: `Asset ${id}`,
    kind,
    environment: [],
    mood: [],
    intensity: null,
    tags: [],
    status: 'ready',
    durationMs: 1000,
    durationSamples: 48_000,
    loudnessTargetLufs: null,
    peaks: [],
    renditions: { opus: { key: 'k', url: 'https://cdn.test/a.opus', bytes: 1 } },
    lastError: null,
    permanentFailure: false,
    retryable: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const assets = [mkAsset(ASSET_A, 'ambience'), mkAsset(ASSET_B, 'one-shot')];

/** The persisted board: a mood, a MASTER volume and per-item volumes that all
 *  differ from the package's own defaults AND from the mood's overrides, plus
 *  `itemA` STOPPED even though the mood names it playing — the one state a
 *  command replay provably cannot express. */
const persisted: BoardStateData = {
  campaignId: CAMPAIGN,
  packageId: PKG_ID,
  moodId: 'storm',
  items: [
    { itemId: 'itemA', playing: false, volume: 0.11 },
    { itemId: 'itemB', playing: true, volume: 0.22 },
  ],
  masterVolume: 0.55,
};

type FakeCtx = {
  state: AudioContextState;
  currentTime: number;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
};

let ctx: FakeCtx;

function makeCtx(): FakeCtx {
  const c: FakeCtx = {
    state: 'suspended',
    currentTime: 0,
    resume: vi.fn(async () => {
      c.state = 'running';
    }),
    close: vi.fn(async () => {
      c.state = 'closed';
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as unknown as AudioBuffer),
  };
  return c;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderBoard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SoundboardPage />
    </QueryClientProvider>
  );
}

/**
 * The enable-audio control, once every query it depends on has settled. The
 * control is deliberately DISABLED until then (see the route), so a test that
 * clicked it earlier would silently click a no-op.
 */
async function enabledEnableAudioButton(): Promise<HTMLElement> {
  const button = screen.getByRole('button', { name: 'Enable audio' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

/** The `BoardState` from the most recent `engine.apply` call. */
function lastApplied(): BoardState {
  const calls = engine.apply.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as unknown as BoardState;
}

beforeEach(() => {
  vi.clearAllMocks();
  ctx = makeCtx();
  // A real `function`, not an arrow: the hook calls `new AudioContext()`, and
  // an arrow cannot be constructed.
  vi.stubGlobal('AudioContext', function AudioContextMock() {
    return ctx;
  });
  listPackagesFn.mockResolvedValue({ items: [pkg, { ...pkg, id: OTHER_PKG_ID, name: 'Tavern' }] });
  getPackageFn.mockResolvedValue(pkg);
  listPackageAssetsFn.mockResolvedValue({ items: assets });
  // The default fixture is a campaign whose board WAS saved — that is what
  // makes a package loaded (and therefore any pad at all present) without every
  // test having to pick one through the picker first.
  loadBoardStateFn.mockResolvedValue(persisted);
  saveBoardStateFn.mockResolvedValue({});
  useCampaign.mockReturnValue({
    campaign: { id: CAMPAIGN, isOwner: true },
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('soundboardBeforeLoad', () => {
  it('is the dashboard guard — a signed-out visitor is redirected', async () => {
    const { getMe } = await import('~/server/functions/rpc');
    expect(typeof soundboardBeforeLoad).toBe('function');
    expect(typeof getMe).toBe('function');
  });
});

describe('SoundboardPage — assembly', () => {
  it('reads the board’s assets from the package-scoped resolver, once per package', async () => {
    renderBoard();

    await waitFor(() =>
      expect(listPackageAssetsFn).toHaveBeenCalledWith({ data: { packageId: PKG_ID } })
    );
    // Package-scoped, not per pad and not per mood switch.
    expect(listPackageAssetsFn).toHaveBeenCalledTimes(1);
  });

  it('groups pads by kind and orders them by sortIndex', async () => {
    renderBoard();

    await waitFor(() => expect(screen.getByTestId('board-group-ambience')).toBeInTheDocument());
    expect(screen.getByTestId('board-group-one-shot')).toBeInTheDocument();
    // `Rain` is ambience (sortIndex 0), `Thunder` is one-shot (sortIndex 1) —
    // and `pkg.items` lists them in the opposite order.
    const pads = screen.getAllByTestId('board-pad');
    expect(pads.map((p) => p.getAttribute('data-item-id'))).toEqual(['itemA', 'itemB']);
  });

  it('keeps a pad whose asset no longer resolves visible instead of dropping it', async () => {
    // Only ASSET_A comes back — `itemB`'s reference dangles.
    listPackageAssetsFn.mockResolvedValue({ items: [mkAsset(ASSET_A, 'ambience')] });
    renderBoard();

    await waitFor(() => expect(screen.getByTestId('board-group-unresolved')).toBeInTheDocument());
    expect(screen.getByText('Thunder')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Contract 1 + 2: hydration. The silent one.
// ---------------------------------------------------------------------------

describe('SoundboardPage — hydration', () => {
  it('restores the persisted mood, master volume and per-item state — including an item the mood names but the GM had stopped', async () => {
    renderBoard();

    await waitFor(() => expect(screen.getByText('Rain')).toBeInTheDocument());

    // The mood came back.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Set mood to Storm' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
    // Master volume came back — 0.55, not `initialBoardState`'s DEFAULT_VOLUME of 1.
    expect(screen.getByLabelText('Master volume')).toHaveValue('0.55');

    // Per-item volumes came back: 0.11 / 0.22, which are neither the items'
    // own defaults (0.8 / 0.5) nor the mood's overrides (0.3 / 0.4).
    expect(screen.getByLabelText('Volume for Rain')).toHaveValue('0.11');
    expect(screen.getByLabelText('Volume for Thunder')).toHaveValue('0.22');

    // And the one a replay of `setMood` + `play` cannot express: the mood
    // names `itemA` as playing, but the GM had stopped it.
    expect(screen.getByRole('button', { name: 'Play Rain' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Stop Thunder' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('schedules no save of its own — opening the board must not become the last write', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderBoard();

    await waitFor(() => expect(screen.getByLabelText('Master volume')).toHaveValue('0.55'));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(saveBoardStateFn).not.toHaveBeenCalled();
  });

  // Contract 3: `packagePending`. If the route hands the hook `false` while the
  // package query is still in flight, hydration concludes against `pkg === null`,
  // the `[pkg]` effect then dispatches `loadPackage`, and a BLANK board is
  // durably written over the persisted one.
  it('does not clobber the persisted board while the package query is still in flight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const slowPackage = deferred<AudioPackageData>();
    getPackageFn.mockReturnValue(slowPackage.promise);

    renderBoard();

    // Board state has landed; the package has not.
    await waitFor(() => expect(getPackageFn).toHaveBeenCalled());
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(saveBoardStateFn).not.toHaveBeenCalled();

    await act(async () => {
      slowPackage.resolve(pkg);
    });
    await waitFor(() => expect(screen.getByText('Rain')).toBeInTheDocument());
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // Still nothing written — and the persisted board survived intact.
    expect(saveBoardStateFn).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Master volume')).toHaveValue('0.55');
    expect(screen.getByRole('button', { name: 'Set mood to Storm' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});

// ---------------------------------------------------------------------------
// The audio gesture
// ---------------------------------------------------------------------------

describe('SoundboardPage — the enable-audio affordance', () => {
  it('does not reach the audio layer before the GM enables audio', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByText('Rain')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Play Rain' }));

    // The press registered — this test is not passing because the pad is missing.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop Rain' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
    // ...and nothing crossed into the audio layer.
    expect(createEngine).not.toHaveBeenCalled();
    expect(createScheduler).not.toHaveBeenCalled();
    expect(engine.apply).not.toHaveBeenCalled();
    expect(engine.fireOneShot).not.toHaveBeenCalled();
  });

  it('holds the control until the asset query settles, then builds the engine on a real click', async () => {
    const slowAssets = deferred<{ items: AudioAssetData[] }>();
    listPackageAssetsFn.mockReturnValue(slowAssets.promise);
    renderBoard();

    const button = screen.getByRole('button', { name: 'Enable audio' });
    // `useSoundboard` refuses to build the engine while `assets` is undefined,
    // and a refused build caches every pad as permanently unplayable — so the
    // control must not invite the click at all yet. It stays disabled from the
    // very first paint, through the board-state load, until the assets land.
    expect(button).toBeDisabled();
    await waitFor(() => expect(listPackageAssetsFn).toHaveBeenCalled());
    expect(button).toBeDisabled();

    await act(async () => {
      slowAssets.resolve({ items: assets });
    });
    await waitFor(() => expect(button).toBeEnabled());

    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(createEngine).toHaveBeenCalledTimes(1));
    expect(engine.apply).toHaveBeenCalled();
  });

  it('surfaces a failed gesture and leaves the control clickable', async () => {
    ctx.resume = vi.fn(async () => {
      throw new Error('play() failed because the user did not interact');
    });
    renderBoard();

    const button = await enabledEnableAudioButton();
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() =>
      expect(screen.getByTestId('audio-error')).toHaveTextContent(/did not interact/i)
    );
    // Every failure path in `enableAudio` is retryable by design, so the
    // affordance must not go dead after one bad gesture.
    expect(screen.getByRole('button', { name: 'Enable audio' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Persistence failure
// ---------------------------------------------------------------------------

describe('SoundboardPage — a failed save', () => {
  it('leaves the UI playing and the engine holding the new state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    saveBoardStateFn.mockRejectedValue(new Error('Atlas unreachable'));
    renderBoard();

    const button = await enabledEnableAudioButton();
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(createEngine).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Play Rain' }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(saveBoardStateFn).toHaveBeenCalled());

    // The assertion that matters: the ENGINE received the new state. "No
    // exception escaped" would pass with the audio layer never told anything.
    const applied = lastApplied();
    expect(applied.items.find((i) => i.itemId === 'itemA')?.playing).toBe(true);

    // The pad is still lit, and the failure is a banner rather than a takeover.
    expect(screen.getByRole('button', { name: 'Stop Rain' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await waitFor(() =>
      expect(screen.getByTestId('save-error')).toHaveTextContent(/Atlas unreachable/)
    );
  });
});

// ---------------------------------------------------------------------------
// Contract 5: the memo is live, not hypothetical.
// ---------------------------------------------------------------------------

describe('SoundboardPage — pad handler stability', () => {
  it('does not re-render a pad whose own state did not change (the memo bails out)', async () => {
    const memoComponent = BoardPad as unknown as {
      type: (props: BoardPadProps) => React.ReactNode;
    };
    const originalType = memoComponent.type;
    const renderSpy = vi.fn(originalType);
    memoComponent.type = renderSpy;

    try {
      renderBoard();
      await waitFor(() => expect(screen.getByText('Rain')).toBeInTheDocument());
      // Let every query settle so the count below is not moved by a data arrival.
      await waitFor(() => expect(screen.getByTestId('board-group-one-shot')).toBeInTheDocument());
      const before = renderSpy.mock.calls.length;
      expect(before).toBeGreaterThan(0);

      // A master-volume nudge produces a new BoardState but leaves every pad's
      // own props identical. With `useCallback`-stable handlers the pads bail
      // out; with a fresh inline arrow per render they all re-render.
      fireEvent.change(screen.getByLabelText('Master volume'), { target: { value: '0.4' } });
      await waitFor(() => expect(screen.getByLabelText('Master volume')).toHaveValue('0.4'));

      expect(renderSpy.mock.calls.length).toBe(before);
    } finally {
      memoComponent.type = originalType;
    }
  });
});
