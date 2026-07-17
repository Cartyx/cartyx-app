import { useCallback, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useFocusTrap } from '~/hooks/useFocusTrap';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
  isLoading = false,
}: ConfirmDialogProps) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);

  // Auto-focus the cancel button for safety (destructive dialogs especially)
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const handleConfirm = useCallback(() => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    Promise.resolve(onConfirm()).finally(() => {
      submittingRef.current = false;
    });
  }, [onConfirm]);

  return (
    // role="presentation": backdrop click-to-close is a convenience; Escape key handler closes the dialog
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-lg border border-white/[0.07] bg-[#0D1117] shadow-2xl shadow-black/60"
      >
        <div className="px-4 py-3 border-b border-white/[0.07]">
          <h2 className="font-sans font-semibold text-xs text-white">{title}</h2>
        </div>

        <div className="p-4">
          <p className="font-sans text-xs text-slate-400 leading-relaxed">{message}</p>

          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="rounded px-3 py-1.5 font-sans text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isLoading}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-sans text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
