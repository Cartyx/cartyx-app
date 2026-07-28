import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useFocusTrap } from '~/hooks/useFocusTrap';

function TrapDialog() {
  const trapRef = useFocusTrap<HTMLDivElement>();
  return (
    <div ref={trapRef} role="dialog">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- harness reproduces a real consumer (ScreenNameDialog) that autoFocuses a child input */}
      <input autoFocus placeholder="name" />
    </div>
  );
}

function Harness({ open }: { open: boolean }) {
  return (
    <div>
      <button type="button">Opener</button>
      {open && <TrapDialog />}
    </div>
  );
}

describe('useFocusTrap', () => {
  it('restores focus to the true opener on unmount, even when a child autoFocuses first', () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    expect(opener).toHaveFocus();

    rerender(<Harness open={true} />);
    // The dialog's own child autoFocus commits before useFocusTrap's effect runs,
    // so by the time the effect body would read document.activeElement, it is
    // already this input rather than the true opener button.
    expect(screen.getByPlaceholderText('name')).toHaveFocus();

    rerender(<Harness open={false} />);
    // Restoration must go to the button that actually had focus before the
    // dialog opened, not be dropped to <body> because the effect-body capture
    // grabbed the (now-removed) autoFocused input instead.
    expect(opener).toHaveFocus();
  });
});
