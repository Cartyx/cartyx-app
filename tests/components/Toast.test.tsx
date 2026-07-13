import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast, showToast } from '~/components/Toast';

describe('Toast', () => {
  it('shows an error-variant toast with an assertive alert role', () => {
    render(<Toast />);
    act(() => showToast('Couldn’t place the spell effect. Please try again.', 'error'));
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent('Couldn’t place the spell effect');
    expect(el).toHaveAttribute('aria-live', 'assertive');
  });

  it('defaults to the info variant (polite status role)', () => {
    render(<Toast />);
    act(() => showToast('Invite code copied'));
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Invite code copied');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });
});
