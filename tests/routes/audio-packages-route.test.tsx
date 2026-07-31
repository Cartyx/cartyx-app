import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AudioPackageData, AudioPackageSummaryData } from '~/types/soundboard';

const listPackagesFn = vi.fn();
const createPackageFn = vi.fn();
const clonePackageFn = vi.fn();
const deletePackageFn = vi.fn();
vi.mock('~/utils/soundboard-server-fns', () => ({
  listPackagesFn: (...args: unknown[]) => listPackagesFn(...args),
  createPackageFn: (...args: unknown[]) => createPackageFn(...args),
  clonePackageFn: (...args: unknown[]) => clonePackageFn(...args),
  deletePackageFn: (...args: unknown[]) => deletePackageFn(...args),
}));

const captureException = vi.fn();
vi.mock('~/utils/telemetry-client', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureEvent: vi.fn(),
}));

// Same mocking convention as `audio-packages-package-id-route.test.tsx`:
// `createFileRoute` returns the options object as-is (this route's
// `beforeLoad`/`component` aren't exercised through the router's own
// matching machinery here), and `useNavigate` returns a spy this file
// asserts on directly — Task 13/14's own route tests don't need `useNavigate`
// (list route had no navigation-on-success path before this task; the
// editor route reads `packageId` from `useParams`, not `useNavigate`).
const navigateSpy = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  redirect: (opts: unknown) => opts,
  useNavigate: () => navigateSpy,
}));

import { PackagesListPage, cloneDisplayName } from '~/routes/audio_.packages';

beforeEach(() => {
  listPackagesFn.mockReset();
  createPackageFn.mockReset();
  clonePackageFn.mockReset();
  deletePackageFn.mockReset();
  captureException.mockReset();
  navigateSpy.mockReset();
});

function mkPackage(overrides: Partial<AudioPackageData> = {}): AudioPackageData {
  return {
    id: 'p1',
    ownerId: 'u1',
    name: 'Tavern Ambience',
    description: null,
    items: [],
    moods: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * What `listPackages` returns — a SUMMARY row. Deliberately a different shape
 * from `mkPackage` above (which is what `createPackage`/`clonePackage` return):
 * the list never receives `items[]`/`moods[]` at all, only their sizes, because
 * shipping ~410 KiB of embedded arrays per row on an unpaginated list was an
 * out-of-memory path on a single 512Mi pod.
 */
function mkSummary(overrides: Partial<AudioPackageSummaryData> = {}): AudioPackageSummaryData {
  return {
    id: 'p1',
    ownerId: 'u1',
    name: 'Tavern Ambience',
    description: null,
    itemCount: 0,
    moodCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <PackagesListPage />
    </QueryClientProvider>
  );
}

describe('PackagesListPage — create a package', () => {
  // Load-bearing: asserts the ACTUAL argument `createPackageFn` was called
  // with, not merely that it was called — a handler that calls
  // `createPackageFn({ data: {} })` (missing/wrong `name`) would pass a
  // weaker "was called" assertion but fails this one, and would fail
  // `createPackageSchema`'s `min(1)` server-side.
  it('"New package" calls createPackageFn with a valid createPackageSchema payload, then navigates to the editor for the created id', async () => {
    const user = userEvent.setup();
    listPackagesFn.mockResolvedValue({ items: [] });
    const created = mkPackage({ id: 'new1', name: 'New Package' });
    createPackageFn.mockResolvedValue(created);

    renderPage();
    await screen.findByText(/no.*packages/i);

    await user.click(screen.getByRole('button', { name: /new package/i }));

    await waitFor(() => expect(createPackageFn).toHaveBeenCalledTimes(1));
    expect(createPackageFn).toHaveBeenCalledWith({ data: { name: 'New Package' } });

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/audio/packages/$packageId',
        params: { packageId: 'new1' },
      })
    );
  });

  it('surfaces a create failure without navigating', async () => {
    const user = userEvent.setup();
    listPackagesFn.mockResolvedValue({ items: [] });
    createPackageFn.mockRejectedValue(new Error('boom'));

    renderPage();
    await screen.findByText(/no.*packages/i);

    await user.click(screen.getByRole('button', { name: /new package/i }));

    await screen.findByText(/boom/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('PackagesListPage — name a clone', () => {
  // Load-bearing: `clonePackage` (Task 5) already accepts an optional
  // `data.name` — the gap this task closes is that the route never supplied
  // one. Asserts the exact computed name, not merely that `clonePackageFn`
  // was called with SOME `name`.
  it('clones a system package with a "(copy)"-suffixed name computed client-side, distinguishing it from the source', async () => {
    const user = userEvent.setup();
    const systemPkg = mkSummary({ id: 'sys1', ownerId: null, name: 'Storm Basics' });
    listPackagesFn.mockResolvedValue({ items: [systemPkg] });
    clonePackageFn.mockResolvedValue(mkPackage({ id: 'clone1', name: 'Storm Basics (copy)' }));

    renderPage();
    await screen.findByText('Storm Basics');

    await user.click(screen.getByRole('button', { name: 'Storm Basics actions' }));
    await user.click(screen.getByRole('menuitem', { name: /clone/i }));

    await waitFor(() => expect(clonePackageFn).toHaveBeenCalledTimes(1));
    expect(clonePackageFn).toHaveBeenCalledWith({
      data: { id: 'sys1', name: 'Storm Basics (copy)' },
    });
  });
});

describe('cloneDisplayName', () => {
  it('appends the "(copy)" suffix to a normal-length name', () => {
    expect(cloneDisplayName('Storm Basics')).toBe('Storm Basics (copy)');
  });

  // Review finding: `clonePackageSchema.name` is `max(200)`. A source name
  // near that cap plus the 7-char suffix would overflow it, and the UI must
  // not offer a clone action the server is guaranteed to reject. Built at
  // the actual boundary — a source name whose suffixed form would be exactly
  // one character over the cap — not "a long name", so the clamp's off-by-one
  // is exercised, not just its general existence.
  it('clamps the base name so the suffixed result never exceeds the schema max (200)', () => {
    const longName = 'x'.repeat(200); // 200 + ' (copy)' (7) = 207, 7 over the cap
    const result = cloneDisplayName(longName);
    expect(result).toHaveLength(200);
    expect(result.endsWith(' (copy)')).toBe(true);
    expect(result).toBe(`${'x'.repeat(193)} (copy)`);
  });

  it('does not clamp a name exactly at the boundary where the suffixed result equals the cap', () => {
    const boundaryName = 'x'.repeat(193); // 193 + 7 = 200, exactly the cap
    expect(cloneDisplayName(boundaryName)).toBe(`${boundaryName} (copy)`);
    expect(cloneDisplayName(boundaryName)).toHaveLength(200);
  });
});
