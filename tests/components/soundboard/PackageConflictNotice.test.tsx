import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageConflictNotice } from '~/components/soundboard/PackageConflictNotice';

const SAVED_AT = '2026-07-31T14:32:07.000Z';

describe('PackageConflictNotice', () => {
  /**
   * The requirement this component exists for: a conflict must not be a
   * one-way door. A notice offering only "reload" would be a discard with a
   * confirmation button on it, so BOTH outcomes are asserted present in the
   * same render — a component that dropped the overwrite path would still
   * pass a test that only looked for the reload one.
   */
  it('offers both ways out, and says what each one costs', () => {
    render(<PackageConflictNotice savedAt={SAVED_AT} onOverwrite={vi.fn()} onDiscard={vi.fn()} />);

    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent(/changed somewhere else/i);
    // The reassurance is load-bearing copy, not decoration: it is what tells
    // the user their unsaved work is still there and they are choosing, not
    // recovering.
    expect(notice).toHaveTextContent(/nothing has been lost/i);

    expect(screen.getByRole('button', { name: /keep my edits and overwrite/i })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /discard my edits and load the saved version/i })
    ).toBeEnabled();
  });

  it('calls the handler for whichever choice was made', async () => {
    const user = userEvent.setup();
    const onOverwrite = vi.fn();
    const onDiscard = vi.fn();
    render(
      <PackageConflictNotice savedAt={SAVED_AT} onOverwrite={onOverwrite} onDiscard={onDiscard} />
    );

    await user.click(screen.getByRole('button', { name: /keep my edits and overwrite/i }));
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: /discard my edits and load the saved version/i })
    );
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });

  /**
   * Asserted on the machine-readable `dateTime`, not on the rendered text:
   * the visible string comes from `toLocaleString()` and would make this test
   * a function of the runner's timezone and locale.
   */
  it('marks the saved-at timestamp up as a real time', () => {
    const { container } = render(
      <PackageConflictNotice savedAt={SAVED_AT} onOverwrite={vi.fn()} onDiscard={vi.fn()} />
    );
    expect(container.querySelector('time')).toHaveAttribute('dateTime', SAVED_AT);
  });

  /**
   * An absent or unparseable timestamp must not become "Invalid Date" on
   * screen, and must not cost the user their choices — the discard path does
   * not use this value at all.
   */
  it('renders without a timestamp rather than showing "Invalid Date"', () => {
    const { container } = render(
      <PackageConflictNotice savedAt="" onOverwrite={vi.fn()} onDiscard={vi.fn()} />
    );
    expect(container.querySelector('time')).toBeNull();
    expect(screen.getByRole('alert')).not.toHaveTextContent(/invalid date/i);
    expect(
      screen.getByRole('button', { name: /keep my edits and overwrite/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /discard my edits and load the saved version/i })
    ).toBeInTheDocument();
  });

  it('disables both choices while a save is in flight', () => {
    render(
      <PackageConflictNotice savedAt={SAVED_AT} onOverwrite={vi.fn()} onDiscard={vi.fn()} busy />
    );
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /discard my edits and load the saved version/i })
    ).toBeDisabled();
  });
});
