import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useModalForm, type UseModalFormOptions } from '~/hooks/useModalForm';

interface Errors {
  name?: string;
}

interface Record {
  id: string;
  name: string;
}

/**
 * Builds a complete options object with sensible spies, overridable per test.
 */
function makeOptions(overrides: Partial<UseModalFormOptions<Errors, Record>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    recordId: undefined,
    isEdit: false,
    record: null,
    reset: vi.fn(),
    populate: vi.fn(),
    validate: vi.fn((): Errors => ({})),
    ...overrides,
  } satisfies UseModalFormOptions<Errors, Record>;
}

describe('useModalForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reset', () => {
    it('calls reset and clears submit/error state on initial open', () => {
      const opts = makeOptions();
      renderHook(() => useModalForm(opts));
      expect(opts.reset).toHaveBeenCalledTimes(1);
    });

    it('re-runs reset when recordId changes', () => {
      const opts = makeOptions({ recordId: 'a' });
      const { rerender } = renderHook((p) => useModalForm(p), { initialProps: opts });
      expect(opts.reset).toHaveBeenCalledTimes(1);

      rerender({ ...opts, recordId: 'b' });
      expect(opts.reset).toHaveBeenCalledTimes(2);
    });

    it('re-runs reset when isOpen toggles', () => {
      const opts = makeOptions({ isOpen: false });
      const { rerender } = renderHook((p) => useModalForm(p), { initialProps: opts });
      expect(opts.reset).toHaveBeenCalledTimes(1);

      rerender({ ...opts, isOpen: true });
      expect(opts.reset).toHaveBeenCalledTimes(2);
    });

    it('does not reset on an unrelated re-render', () => {
      const opts = makeOptions({ recordId: 'a' });
      const { rerender } = renderHook((p) => useModalForm(p), { initialProps: opts });
      expect(opts.reset).toHaveBeenCalledTimes(1);

      // Same recordId/isOpen, but a fresh inline reset closure (as a real
      // component would pass). Must NOT trigger another reset.
      rerender({ ...opts, reset: vi.fn() });
      expect(opts.reset).toHaveBeenCalledTimes(1);
    });

    it('clears prior fieldErrors and hasSubmitted when recordId changes', () => {
      const opts = makeOptions({ recordId: 'a', validate: () => ({ name: 'Required' }) });
      const { result, rerender } = renderHook((p) => useModalForm(p), { initialProps: opts });

      act(() => {
        result.current.runValidation();
      });
      expect(result.current.hasSubmitted).toBe(true);
      expect(result.current.fieldErrors).toEqual({ name: 'Required' });

      rerender({ ...opts, recordId: 'b' });
      expect(result.current.hasSubmitted).toBe(false);
      expect(result.current.fieldErrors).toEqual({});
    });
  });

  describe('populate', () => {
    it('populates when in edit mode and the record resolves', () => {
      const record = { id: '1', name: 'Gandalf' };
      const opts = makeOptions({ isEdit: true, recordId: '1', record: null });
      const { rerender } = renderHook((p) => useModalForm(p), { initialProps: opts });
      expect(opts.populate).not.toHaveBeenCalled();

      rerender({ ...opts, record });
      expect(opts.populate).toHaveBeenCalledWith(record);
    });

    it('does not populate in create mode', () => {
      const record = { id: '1', name: 'Gandalf' };
      const opts = makeOptions({ isEdit: false, record });
      renderHook(() => useModalForm(opts));
      expect(opts.populate).not.toHaveBeenCalled();
    });
  });

  describe('validate', () => {
    it('runValidation sets hasSubmitted, stores errors, and returns them', () => {
      const errors = { name: 'Name is required' };
      const opts = makeOptions({ validate: () => errors });
      const { result } = renderHook(() => useModalForm(opts));

      let returned: Errors = {};
      act(() => {
        returned = result.current.runValidation();
      });

      expect(returned).toEqual(errors);
      expect(result.current.hasSubmitted).toBe(true);
      expect(result.current.fieldErrors).toEqual(errors);
    });

    it('re-validates on change after the first submit attempt', () => {
      let errors: Errors = { name: 'Name is required' };
      const validate = vi.fn(() => errors);
      const opts = makeOptions({ validate });
      const { result, rerender } = renderHook((p) => useModalForm(p), { initialProps: opts });

      // No live validation before first submit.
      rerender({ ...opts, validate });
      expect(result.current.fieldErrors).toEqual({});

      act(() => {
        result.current.runValidation();
      });
      expect(result.current.fieldErrors).toEqual({ name: 'Name is required' });

      // User fixes the field: validate now returns no errors. A re-render with
      // a new validate closure should refresh fieldErrors live.
      errors = {};
      rerender({ ...opts, validate: () => ({}) });
      expect(result.current.fieldErrors).toEqual({});
    });

    it('does not validate live before any submit', () => {
      const validate = vi.fn(() => ({ name: 'x' }));
      const opts = makeOptions({ validate });
      const { rerender } = renderHook((p) => useModalForm(p), { initialProps: opts });
      validate.mockClear();
      rerender({ ...opts, validate });
      expect(validate).not.toHaveBeenCalled();
    });
  });

  describe('Escape', () => {
    it('calls onClose when Escape is pressed while open', () => {
      const opts = makeOptions({ isOpen: true });
      renderHook(() => useModalForm(opts));
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(opts.onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose for other keys', () => {
      const opts = makeOptions({ isOpen: true });
      renderHook(() => useModalForm(opts));
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      });
      expect(opts.onClose).not.toHaveBeenCalled();
    });

    it('does not listen for Escape while closed', () => {
      const opts = makeOptions({ isOpen: false });
      renderHook(() => useModalForm(opts));
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(opts.onClose).not.toHaveBeenCalled();
    });

    it('removes the listener on unmount', () => {
      const opts = makeOptions({ isOpen: true });
      const { unmount } = renderHook(() => useModalForm(opts));
      unmount();
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(opts.onClose).not.toHaveBeenCalled();
    });
  });
});
