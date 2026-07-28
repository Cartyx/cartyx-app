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

  it('restores focus to the trigger when an item is chosen', async () => {
    // Several items open a dialog, and useFocusTrap captures
    // `document.activeElement` during the dialog's FIRST RENDER — which lands
    // on the chosen menuitem, about to unmount in that same commit. The trap
    // then declines to restore focus to a detached node and the keyboard user
    // is stranded on <body>. Handing focus back to the still-mounted trigger
    // before running the action gives the dialog a durable opener.
    const user = userEvent.setup();
    let focusedAtSelect: Element | null = null;
    const onSelect = vi.fn(() => {
      focusedAtSelect = document.activeElement;
    });
    render(
      <OverflowMenu items={[{ key: 'edit', label: 'Edit', onSelect }]} label="Item actions" />
    );
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    // Focus is on the trigger at the moment the action runs — not on the
    // menuitem that is about to disappear.
    expect(focusedAtSelect).toBe(trigger);
    expect(trigger).toHaveFocus();
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
    // Opening the menu already focuses the first item (see the dedicated
    // focus-on-open test below), so roving starts from there.
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

  it('skips a disabled item when roving focus with the arrow keys', async () => {
    const user = userEvent.setup();
    const threeItems = [
      { key: 'edit', label: 'Edit', onSelect: vi.fn() },
      { key: 'show', label: 'Show on Tab', onSelect: vi.fn(), disabled: true },
      { key: 'delete', label: 'Delete', onSelect: vi.fn(), danger: true },
    ];
    render(<OverflowMenu items={threeItems} label="Item actions" />);
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<OverflowMenu items={[]} label="Item actions" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('focuses the first enabled item when the menu opens', async () => {
    const user = userEvent.setup();
    const withDisabledFirst = [
      { key: 'push', label: 'Push', onSelect: vi.fn(), disabled: true },
      { key: 'edit', label: 'Edit', onSelect: vi.fn() },
      { key: 'delete', label: 'Delete', onSelect: vi.fn(), danger: true },
    ];
    render(<OverflowMenu items={withDisabledFirst} label="Item actions" />);
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    // The first item is disabled, so focus should skip it and land on 'Edit'.
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('closes when focus leaves the menu, but stays open when focus moves between items', async () => {
    const user = userEvent.setup();
    render(
      <>
        <OverflowMenu items={items} label="Item actions" />
        <button type="button">Outside</button>
      </>
    );
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Roving between items (focus stays inside the menu container) must not close it.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Tabbing to an element outside the menu moves focus out entirely, and should close it.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps the trigger reachable on touch devices via an always-visible class', () => {
    render(<OverflowMenu items={items} label="Item actions" />);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    // jsdom has no real media queries, so assert the Tailwind arbitrary variant
    // class is present rather than asserting computed opacity.
    expect(trigger.className).toContain('[@media(hover:none)]:opacity-100');
    expect(trigger.className).toContain('focus:opacity-100');
  });
});
