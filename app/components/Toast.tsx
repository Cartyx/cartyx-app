import { useState, useCallback, useEffect, useRef } from 'react';

export type ToastVariant = 'info' | 'error';

interface ToastState {
  message: string;
  variant: ToastVariant;
  visible: boolean;
}

let _showToast: ((msg: string, variant: ToastVariant) => void) | null = null;

/** Show a transient toast. `variant` defaults to 'info'; use 'error' for failures. */
export function showToast(message: string, variant: ToastVariant = 'info') {
  _showToast?.(message, variant);
}

export function Toast() {
  const [state, setState] = useState<ToastState>({
    message: '',
    variant: 'info',
    visible: false,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, variant: ToastVariant) => {
    // Clear any existing timeout
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({ message, variant, visible: true });
    // Errors linger a little longer so they're not missed.
    timerRef.current = setTimeout(
      () => {
        setState((s) => ({ ...s, visible: false }));
        timerRef.current = null;
      },
      variant === 'error' ? 4000 : 2400
    );
  }, []);

  // Register/cleanup global handler
  useEffect(() => {
    _showToast = show;
    return () => {
      _showToast = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [show]);

  const palette =
    state.variant === 'error'
      ? 'bg-slate-800 border-red-500/40 text-red-300'
      : 'bg-slate-800 border-blue-500/30 text-blue-300';

  return (
    <div
      role={state.variant === 'error' ? 'alert' : 'status'}
      aria-live={state.variant === 'error' ? 'assertive' : 'polite'}
      className={`fixed bottom-7 left-1/2 z-50 -translate-x-1/2 transition-transform duration-300 ease-spring
        rounded-xl border px-5 py-3 text-sm font-medium whitespace-nowrap ${palette}
        ${state.visible ? 'translate-y-0' : 'translate-y-20 pointer-events-none'}`}
    >
      {state.message}
    </div>
  );
}
