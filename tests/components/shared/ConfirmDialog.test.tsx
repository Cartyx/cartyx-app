import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';

describe('ConfirmDialog (a11y)', () => {
  const defaultProps = {
    title: 'Delete Screen',
    message: 'Are you sure?',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('restores focus to the opener element after the dialog closes', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <div>
          <button type="button">Open dialog</button>
          {open && <ConfirmDialog {...defaultProps} />}
        </div>
      );
    }

    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    expect(opener).toHaveFocus();

    rerender(<Harness open={true} />);
    // Dialog auto-focuses Cancel while open.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    rerender(<Harness open={false} />);
    expect(opener).toHaveFocus();
  });

  it('does not dismiss on Escape while isLoading', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} isLoading />);

    await user.keyboard('{Escape}');

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('has aria-describedby pointing at the message', () => {
    render(<ConfirmDialog {...defaultProps} />);

    const dialog = screen.getByRole('alertdialog');
    const describedById = dialog.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();

    const messageEl = document.getElementById(describedById!);
    expect(messageEl).not.toBeNull();
    expect(messageEl).toHaveTextContent('Are you sure?');
  });
});
