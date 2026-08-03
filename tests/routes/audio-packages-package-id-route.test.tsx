import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AudioPackageData, MoodData, PackageItemData } from '~/types/soundboard';

const getPackageFn = vi.fn();
const updatePackageFn = vi.fn();
vi.mock('~/utils/soundboard-server-fns', () => ({
  getPackageFn: (...args: unknown[]) => getPackageFn(...args),
  updatePackageFn: (...args: unknown[]) => updatePackageFn(...args),
}));

const listAudioAssetsFn = vi.fn();
vi.mock('~/utils/audio-server-fns', () => ({
  listAudioAssetsFn: (...args: unknown[]) => listAudioAssetsFn(...args),
}));

const useAuth = vi.fn(() => ({ user: { id: 'u1', name: 'GM' }, logout: vi.fn() }));
vi.mock('~/hooks/useAuth', () => ({ useAuth: () => useAuth() }));

const captureException = vi.fn();
vi.mock('~/utils/telemetry-client', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureEvent: vi.fn(),
}));

// `Route.useParams()` is called directly inside `PackageEditorPage` (not
// through the router's own matching machinery, which isn't stood up in this
// test) — the mocked `createFileRoute` attaches a `useParams` returning a
// fixed id, same shape `audio-route.test.tsx` uses for its own router mock.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ packageId: 'p1' }),
  }),
  redirect: (opts: unknown) => opts,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { PackageEditorPage, pruneOrphanedMoodStates } from '~/routes/audio_.packages_.$packageId';

// Mocks above are module-scoped `vi.fn()`s, not per-test — without a reset,
// `updatePackageFn`'s call count (and any other mock's) carries over between
// `it` blocks in this file, which is invisible in isolation (`vitest -t
// "..."`) and only shows up running the whole suite. Matches
// `audio-route.test.tsx`'s own `beforeEach` convention.
beforeEach(() => {
  getPackageFn.mockReset();
  updatePackageFn.mockReset();
  listAudioAssetsFn.mockReset();
  captureException.mockReset();
});

function mkItem(overrides: Partial<PackageItemData> = {}): PackageItemData {
  return {
    id: 'i1',
    assetId: '507f1f77bcf86cd799439011',
    label: 'Rain',
    volume: 1,
    fadeSeconds: 2,
    loop: true,
    sortIndex: 0,
    ...overrides,
  };
}

function mkPackage(overrides: Partial<AudioPackageData> = {}): AudioPackageData {
  return {
    id: 'p1',
    ownerId: 'u1',
    name: 'Storm Set',
    description: null,
    items: [],
    moods: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('pruneOrphanedMoodStates', () => {
  // The reviewer's fixture, verbatim in spirit: two items, one mood whose
  // states[] names BOTH — not one, which a wholesale-clear implementation
  // would also pass. `i1` carries a real per-state override (`volume: 0.35`,
  // different from the item's own `volume: 1`), so a "rebuild states from
  // remaining items" implementation (which would emit a fresh, default-only
  // state for `i1`) is also caught — its output would not match the
  // survivor's ORIGINAL state object.
  it("drops a removed item's state and leaves the surviving item's state untouched", () => {
    const items = [mkItem({ id: 'i1', volume: 1 }), mkItem({ id: 'i2', volume: 1 })];
    const survivorState = { itemId: 'i1', playing: true, volume: 0.35 };
    const moods: MoodData[] = [
      {
        id: 'm1',
        name: 'Overhead',
        states: [survivorState, { itemId: 'i2', playing: true }],
      },
    ];

    // "removing one": the items array passed in is what's left AFTER i2 was
    // removed from the package — exactly what `PackageEditor`'s `emit()`
    // produces and what the route's save path hands to this function.
    const remainingItems = items.filter((item) => item.id !== 'i2');

    const result = pruneOrphanedMoodStates(moods, remainingItems);

    expect(result).toHaveLength(1);
    expect(result[0].states).toHaveLength(1);
    // Deep-equal against the ORIGINAL object, not just `itemId` — this is
    // what catches a "rebuild from items" fix that would produce a
    // same-itemId state with the override stripped.
    expect(result[0].states[0]).toEqual(survivorState);
    expect(result[0].states.some((s) => s.itemId === 'i2')).toBe(false);
  });

  it('is a no-op when every state already names a surviving item', () => {
    const items = [mkItem({ id: 'i1' })];
    const moods: MoodData[] = [
      { id: 'm1', name: 'Overhead', states: [{ itemId: 'i1', playing: true }] },
    ];
    expect(pruneOrphanedMoodStates(moods, items)).toEqual(moods);
  });
});

describe('PackageEditorPage save path', () => {
  it('prunes an orphaned mood state and sends the pruned moods alongside items on save', async () => {
    const user = userEvent.setup();
    const item1 = mkItem({ id: 'i1', label: 'Rain', sortIndex: 0 });
    const item2 = mkItem({ id: 'i2', label: 'Thunder', sortIndex: 1 });
    const survivorState = { itemId: 'i1', playing: true, volume: 0.35 };
    const pkg = mkPackage({
      items: [item1, item2],
      moods: [
        { id: 'm1', name: 'Overhead', states: [survivorState, { itemId: 'i2', playing: true }] },
      ],
    });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockResolvedValue({
      ...pkg,
      items: [item1],
      moods: [{ id: 'm1', name: 'Overhead', states: [survivorState] }],
    });

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    // `findByText('Thunder')` is ambiguous now that `MoodEditor` (this
    // task) also renders one row per item, including "Thunder", for the
    // package's mood — so this waits on the one thing that's still unique:
    // the item row's own remove button (`MoodEditor` has no per-item remove
    // affordance, only "Remove mood <name>").
    await screen.findByRole('button', { name: /remove thunder/i });
    await user.click(screen.getByRole('button', { name: /remove thunder/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updatePackageFn).toHaveBeenCalledTimes(1));
    const call = updatePackageFn.mock.calls[0][0] as {
      data: { id: string; items: PackageItemData[]; moods: MoodData[] };
    };
    expect(call.data.id).toBe('p1');
    expect(call.data.items.map((i) => i.id)).toEqual(['i1']);
    expect(call.data.moods).toEqual([{ id: 'm1', name: 'Overhead', states: [survivorState] }]);
  });

  // Composition test: an item edit (PackageEditor/Task 14) and a mood edit
  // (MoodEditor/Task 15) made in the SAME sitting must land in the SAME
  // `updatePackageFn` call, not two separate racing writes. This is what
  // proves the "one save button" design actually holds together, not just
  // that each editor's own emitted array looks right in isolation.
  it('sends an item edit and a mood override edit from the same sitting in a single save call', async () => {
    const user = userEvent.setup();
    const item1 = mkItem({ id: 'i1', label: 'Rain', volume: 0.5, sortIndex: 0 });
    const pkg = mkPackage({
      items: [item1],
      moods: [{ id: 'm1', name: 'Overhead', states: [] }],
    });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockResolvedValue(pkg);

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    // Item edit: bump Rain's volume via PackageEditor's row.
    const itemSlider = await screen.findByRole('slider', { name: /volume for rain$/i });
    fireEvent.change(itemSlider, { target: { value: '0.9' } });

    // Mood edit: toggle Rain "playing" in the Overhead mood via MoodEditor —
    // this is the one place the two editors' fields could plausibly clash on
    // a naive `aria-label`, since both call their volume control "Volume for
    // Rain"; the mood one is disambiguated with "in this mood".
    const playingCheckbox = screen.getByRole('checkbox', { name: /playing rain in this mood/i });
    await user.click(playingCheckbox);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updatePackageFn).toHaveBeenCalledTimes(1));
    const call = updatePackageFn.mock.calls[0][0] as {
      data: { id: string; items: PackageItemData[]; moods: MoodData[] };
    };
    // Both edits present in the ONE call.
    expect(call.data.items[0].volume).toBe(0.9);
    expect(call.data.moods[0].states).toEqual([{ itemId: 'i1', playing: true }]);
  });

  // Task 22: the editor previously rendered `pkg.name` as a plain,
  // non-editable `<h1>`. This proves the rename reaches the SAME single
  // `updatePackageFn` call Task 15 built for `items`/`moods` — not a second,
  // racing write to the same document, which is exactly the defect Task 15's
  // own report was warned about and avoided. Asserting call COUNT (one) is
  // load-bearing: a naive "save the name separately" implementation would
  // still get the name to the server, just via a second call, and a test
  // that only checked the name arrived somewhere would not catch that.
  it('sends a renamed name in the SAME single updatePackageFn call that carries items and moods', async () => {
    const user = userEvent.setup();
    const item1 = mkItem({ id: 'i1', label: 'Rain', sortIndex: 0 });
    const pkg = mkPackage({
      name: 'Storm Set',
      items: [item1],
      moods: [{ id: 'm1', name: 'Overhead', states: [] }],
    });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockResolvedValue({ ...pkg, name: 'Thunderstorm Set' });

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    expect(nameInput).toHaveValue('Storm Set');
    await user.clear(nameInput);
    await user.type(nameInput, 'Thunderstorm Set');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updatePackageFn).toHaveBeenCalledTimes(1));
    const call = updatePackageFn.mock.calls[0][0] as {
      data: { id: string; name: string; items: PackageItemData[]; moods: MoodData[] };
    };
    expect(call.data.name).toBe('Thunderstorm Set');
    expect(call.data.items).toHaveLength(1);
    expect(call.data.moods).toHaveLength(1);
  });

  /**
   * Task 7: every save carries the revision it was built on. Asserted on the
   * VALUE, not merely on the key being present — a save that sent, say, the
   * draft's own `createdAt`, or a hard-coded `new Date().toISOString()`, would
   * satisfy the schema and be refused by Mongo on every single save.
   */
  it('sends the loaded package revision as the save precondition', async () => {
    const user = userEvent.setup();
    const pkg = mkPackage({ items: [mkItem()], updatedAt: '2026-03-04T05:06:07.000Z' });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockResolvedValue(pkg);

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    await user.type(nameInput, '!');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updatePackageFn).toHaveBeenCalledTimes(1));
    const call = updatePackageFn.mock.calls[0][0] as { data: { expectedUpdatedAt: string } };
    expect(call.data.expectedUpdatedAt).toBe('2026-03-04T05:06:07.000Z');
  });

  it('does not render an editable name field for a system package', async () => {
    const pkg = mkPackage({ ownerId: null, name: 'Storm Basics' });
    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    expect(nameInput).toHaveValue('Storm Basics');
    expect(nameInput).toBeDisabled();
  });
});

/**
 * Task 7's client half. The server refuses a save built on a stale read
 * (`PackageStaleWriteError`); what matters here is that the refusal costs the
 * user nothing until they say so.
 */
describe('PackageEditorPage stale-write conflict', () => {
  /**
   * Built to look exactly like what crosses the server-fn wire, which is NOT
   * an instance of the server's class: seroval reconstructs a plain `Error`
   * carrying the original `name` and own properties. A fixture that imported
   * `PackageStaleWriteError` and threw a real instance would pass even if the
   * route keyed on `instanceof` — and `instanceof` cannot work in the browser,
   * because the class lives in a module the client bundle never loads.
   */
  function wireStaleWriteError(currentUpdatedAt: string): Error {
    const e = new Error('This package changed somewhere else after you opened it.');
    e.name = 'PackageStaleWriteError';
    return Object.assign(e, { currentUpdatedAt });
  }

  it('surfaces the conflict, keeps the unsaved draft, and files no client error report', async () => {
    const user = userEvent.setup();
    const pkg = mkPackage({ items: [mkItem({ id: 'i1', label: 'Rain' })] });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockRejectedValue(wireStaleWriteError('2026-05-05T05:05:05.000Z'));

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    await user.clear(nameInput);
    await user.type(nameInput, 'My Renamed Set');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // The conflict is surfaced as its own thing, with both ways out.
    await screen.findByTestId('package-conflict-notice');
    expect(
      screen.getByRole('button', { name: /keep my edits and overwrite/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /discard my edits and load the saved version/i })
    ).toBeInTheDocument();

    // NOTHING SILENTLY DISCARDED: the refusal did not roll the editor back to
    // the server's version. The rename is still typed in, and the item is
    // still on the board.
    expect(screen.getByRole('textbox', { name: /package name/i })).toHaveValue('My Renamed Set');
    expect(screen.getByRole('button', { name: /remove rain/i })).toBeInTheDocument();

    // A refused write must not file a GlitchTip event — the same rule the
    // server applies to `PackageStaleWriteError`, applied on the client that
    // receives it. Two tabs on one package is expected, not a fault.
    expect(captureException).not.toHaveBeenCalled();
  });

  /**
   * "Keep my edits" is a RETRY against the newer revision, not a force flag:
   * the same draft, the precondition the refusal reported. Asserting the
   * second call's `expectedUpdatedAt` is what separates the two — a `force:
   * true` implementation would resend the ORIGINAL token (or none), and a
   * test that only checked "it saved again" would not notice.
   */
  it('replays the same draft against the revision the refusal reported', async () => {
    const user = userEvent.setup();
    const pkg = mkPackage({
      items: [mkItem({ id: 'i1', label: 'Rain' })],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockRejectedValueOnce(wireStaleWriteError('2026-05-05T05:05:05.000Z'));

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    await user.clear(nameInput);
    await user.type(nameInput, 'My Renamed Set');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await screen.findByTestId('package-conflict-notice');
    updatePackageFn.mockResolvedValue({ ...pkg, name: 'My Renamed Set' });
    await user.click(screen.getByRole('button', { name: /keep my edits and overwrite/i }));

    await waitFor(() => expect(updatePackageFn).toHaveBeenCalledTimes(2));
    const first = updatePackageFn.mock.calls[0][0] as { data: { expectedUpdatedAt: string } };
    const retry = updatePackageFn.mock.calls[1][0] as {
      data: { expectedUpdatedAt: string; name: string; items: PackageItemData[] };
    };
    expect(first.data.expectedUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(retry.data.expectedUpdatedAt).toBe('2026-05-05T05:05:05.000Z');
    // The draft itself is replayed unchanged — not re-derived from the server
    // copy, which would be a second chance to lose the edit.
    expect(retry.data.name).toBe('My Renamed Set');
    expect(retry.data.items.map((i) => i.id)).toEqual(['i1']);

    // Succeeded: the notice is gone.
    await waitFor(() =>
      expect(screen.queryByTestId('package-conflict-notice')).not.toBeInTheDocument()
    );
  });

  /**
   * The other door, and the only one that throws work away — which is why it
   * is a labelled button and not the automatic consequence of a conflict.
   */
  it('discards the local draft only when the user explicitly asks, and reloads the stored version', async () => {
    const user = userEvent.setup();
    const pkg = mkPackage({ name: 'Storm Set', items: [mkItem({ id: 'i1', label: 'Rain' })] });
    const serverVersion = mkPackage({
      name: 'Renamed By The Other Tab',
      items: [mkItem({ id: 'i1', label: 'Rain' })],
      updatedAt: '2026-05-05T05:05:05.000Z',
    });

    getPackageFn.mockResolvedValueOnce(pkg).mockResolvedValue(serverVersion);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockRejectedValue(wireStaleWriteError('2026-05-05T05:05:05.000Z'));

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    await user.clear(nameInput);
    await user.type(nameInput, 'My Renamed Set');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByTestId('package-conflict-notice');

    await user.click(
      screen.getByRole('button', { name: /discard my edits and load the saved version/i })
    );

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /package name/i })).toHaveValue(
        'Renamed By The Other Tab'
      )
    );
    expect(screen.queryByTestId('package-conflict-notice')).not.toBeInTheDocument();
    // The refusal is cleared too, not left behind as a red "failed to save"
    // line describing a conflict that has already been resolved.
    expect(screen.queryByText(/failed to save changes/i)).not.toBeInTheDocument();
  });

  /**
   * The guard must not swallow real failures. A non-conflict rejection still
   * takes the original path: the plain error line, and a GlitchTip report.
   */
  it('leaves an ordinary save failure reported and rendered as before', async () => {
    const user = userEvent.setup();
    const pkg = mkPackage({ items: [mkItem()] });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockRejectedValue(new Error('Database unavailable'));

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    await user.type(nameInput, '!');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await screen.findByText('Database unavailable');
    expect(screen.queryByTestId('package-conflict-notice')).not.toBeInTheDocument();
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
  });

  /**
   * The review's Important finding, pinned. The conflict notice SUPPRESSES the
   * generic error line (`!conflict && saveMutation.error`, in the route), so
   * if a failed overwrite left the conflict state standing, a retry that fails
   * with anything other than a stale write would render NOTHING AT ALL: the
   * button flips back from "Saving…" and the user's only signal that their
   * click did nothing is the absence of change.
   *
   * That is precisely why this test is written against what is ON SCREEN
   * rather than against state or call counts — the bug's whole signature is
   * that every other observable stays green (the mutation ran, the error was
   * captured, the notice is still correct) while the user is told nothing.
   *
   * The rejection here is deliberately the reachable one rather than a generic
   * 500: an empty `currentUpdatedAt` makes the overwrite send
   * `expectedUpdatedAt: ''`, which `updatePackageSchema`'s `.datetime()`
   * rejects at the server-fn validator.
   */
  it('renders a visible failure when the overwrite retry fails with a non-conflict error', async () => {
    const user = userEvent.setup();
    const pkg = mkPackage({ items: [mkItem({ id: 'i1', label: 'Rain' })] });

    getPackageFn.mockResolvedValue(pkg);
    listAudioAssetsFn.mockResolvedValue({ items: [], nextCursor: null });
    updatePackageFn.mockRejectedValueOnce(wireStaleWriteError(''));

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PackageEditorPage />
      </QueryClientProvider>
    );

    const nameInput = await screen.findByRole('textbox', { name: /package name/i });
    await user.clear(nameInput);
    await user.type(nameInput, 'My Renamed Set');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByTestId('package-conflict-notice');

    // The retry is refused by the input validator, not by the fence.
    updatePackageFn.mockRejectedValue(
      new Error('Invalid input: expected ISO datetime, received ""')
    );
    await user.click(screen.getByRole('button', { name: /keep my edits and overwrite/i }));

    // SOMETHING the user can see. Without the fix this assertion is the only
    // one in the file that fails — the notice below is still rendered, the
    // capture below still happens, and nothing else notices.
    await screen.findByText(/expected ISO datetime/i);
    expect(screen.queryByTestId('package-conflict-notice')).not.toBeInTheDocument();

    // Still a real fault, so it is still reported — only the stale-write
    // refusal is exempt.
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
    // And the draft is STILL intact: a failed overwrite must not cost the user
    // their edits any more than the original refusal did.
    expect(screen.getByRole('textbox', { name: /package name/i })).toHaveValue('My Renamed Set');
    expect(screen.getByRole('button', { name: /remove rain/i })).toBeInTheDocument();
  });
});
