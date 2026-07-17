import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverflowMenu } from '~/components/shared/OverflowMenu';

const items = [
  { key: 'edit', label: 'Edit', onSelect: vi.fn() },
  { key: 'delete', label: 'Delete', onSelect: vi.fn(), danger: true },
];

describe('OverflowMenu', () => {
  it('is closed initially and reports collapsed state', () => {
    render(<OverflowMenu items={items} label="Item actions" />);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on trigger click and lists every item', async () => {
    const user = userEvent.setup();
    render(<OverflowMenu items={items} label="Item actions" />);
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('calls onSelect and closes when an item is chosen', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <OverflowMenu items={[{ key: 'edit', label: 'Edit', onSelect }]} label="Item actions" />
    );
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<OverflowMenu items={items} label="Item actions" />);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('moves focus between items with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<OverflowMenu items={items} label="Item actions" />);
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('does not fire onSelect for a disabled item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <OverflowMenu
        items={[{ key: 'push', label: 'Push', onSelect, disabled: true }]}
        label="Item actions"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Push' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<OverflowMenu items={[]} label="Item actions" />);
    expect(container).toBeEmptyDOMElement();
  });
});
