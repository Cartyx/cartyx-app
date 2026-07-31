import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageList } from '~/components/soundboard/PackageList';
import type { AudioPackageSummaryData } from '~/types/soundboard';

function makePackage(overrides: Partial<AudioPackageSummaryData> = {}): AudioPackageSummaryData {
  return {
    id: 'p1',
    ownerId: 'u1',
    name: 'Tavern Ambience',
    description: 'Crowd chatter and mugs',
    itemCount: 0,
    moodCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PackageList', () => {
  // The load-bearing test: a fixture with ONE system row and ONE user row in
  // the SAME render, so a component that renders identical affordances for
  // both (e.g. Edit on everything) cannot pass by accident. Absence of Edit
  // on the system row is asserted explicitly — presence of Clone alone would
  // not catch a component that also renders Edit.
  it('shows Clone (not Edit) on a system row, and Edit on a user row, in the same render', async () => {
    const user = userEvent.setup();
    const systemPkg = makePackage({ id: 'sys1', ownerId: null, name: 'Storm Basics' });
    const userPkg = makePackage({ id: 'own1', ownerId: 'u1', name: 'My Tavern' });

    render(
      <PackageList
        packages={[systemPkg, userPkg]}
        onEdit={vi.fn()}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Storm Basics actions' }));
    const systemMenu = screen.getByRole('menu', { name: 'Storm Basics actions' });
    expect(within(systemMenu).getByRole('menuitem', { name: /clone/i })).toBeInTheDocument();
    expect(within(systemMenu).queryByRole('menuitem', { name: /edit/i })).not.toBeInTheDocument();
    expect(within(systemMenu).queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'My Tavern actions' }));
    const userMenu = screen.getByRole('menu', { name: 'My Tavern actions' });
    expect(within(userMenu).getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
    expect(within(userMenu).queryByRole('menuitem', { name: /clone/i })).not.toBeInTheDocument();
  });

  it('visually distinguishes a system package with a badge', () => {
    const systemPkg = makePackage({ id: 'sys1', ownerId: null, name: 'Storm Basics' });
    const userPkg = makePackage({ id: 'own1', ownerId: 'u1', name: 'My Tavern' });
    render(<PackageList packages={[systemPkg, userPkg]} />);

    const rows = screen.getAllByTestId('package-row');
    expect(within(rows[0]).getByTestId('system-badge')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('system-badge')).not.toBeInTheDocument();
  });

  it('calls onClone with the package when Clone is selected', async () => {
    const user = userEvent.setup();
    const onClone = vi.fn();
    const systemPkg = makePackage({ id: 'sys1', ownerId: null, name: 'Storm Basics' });
    render(<PackageList packages={[systemPkg]} onClone={onClone} />);

    await user.click(screen.getByRole('button', { name: 'Storm Basics actions' }));
    await user.click(screen.getByRole('menuitem', { name: /clone/i }));

    expect(onClone).toHaveBeenCalledWith(systemPkg);
  });

  it('calls onEdit and onDelete with the package for a user row', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const userPkg = makePackage({ id: 'own1', ownerId: 'u1', name: 'My Tavern' });
    render(<PackageList packages={[userPkg]} onEdit={onEdit} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'My Tavern actions' }));
    await user.click(screen.getByRole('menuitem', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(userPkg);

    await user.click(screen.getByRole('button', { name: 'My Tavern actions' }));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(userPkg);
  });

  it('disables Clone for the package currently being cloned', async () => {
    const user = userEvent.setup();
    const systemPkg = makePackage({ id: 'sys1', ownerId: null, name: 'Storm Basics' });
    render(<PackageList packages={[systemPkg]} onClone={vi.fn()} cloningId="sys1" />);

    await user.click(screen.getByRole('button', { name: 'Storm Basics actions' }));
    expect(screen.getByRole('menuitem', { name: /clone/i })).toBeDisabled();
  });

  it('shows an empty state when there are no packages', () => {
    render(<PackageList packages={[]} />);
    expect(screen.getByText(/no.*packages/i)).toBeInTheDocument();
  });

  it('summarizes a package from server-supplied counts, never from the arrays themselves', () => {
    // The row renders `itemCount`/`moodCount` — the numbers Mongo's `$size`
    // computed — because `listPackages` deliberately never sends `items[]` or
    // `moods[]`. A maxed package is ~410 KiB of embedded arrays, and shipping
    // them per row so a component could call `.length` made an unpaginated
    // list an OOM path on a single 512Mi pod.
    const pkg = makePackage({ itemCount: 2, moodCount: 1 });
    render(<PackageList packages={[pkg]} />);
    expect(screen.getByText(/2 items?/i)).toBeInTheDocument();
    expect(screen.getByText(/1 mood/i)).toBeInTheDocument();
  });
});
