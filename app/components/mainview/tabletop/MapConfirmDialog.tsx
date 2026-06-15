import { useId, type ReactNode } from 'react';

interface MapConfirmDialogProps {
  /** Heading text (rendered as a destructive/rose alertdialog title). */
  title: string;
  /** Body content (supports inline emphasis spans). */
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional testid for the confirm button. */
  confirmTestId?: string;
}

/**
 * A small destructive-confirm alertdialog scoped to the map stage
 * (`absolute inset-0`, so it overlays only the stage, not the whole page).
 * Used by the token-remove and clear-drawings confirmations. The confirm button
 * is focused on mount so Enter immediately confirms (keyboard continuity for a
 * dialog opened by the Delete key).
 */
export function MapConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  confirmTestId,
}: MapConfirmDialogProps) {
  const titleId = useId();
  return (
    <div
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
    >
      <div
        role="alertdialog"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-lg border border-white/10 bg-[#0D1117] p-4 shadow-2xl"
      >
        <h2
          id={titleId}
          className="font-sans text-sm font-bold uppercase tracking-widest text-rose-400"
        >
          {title}
        </h2>
        <p className="font-sans mt-2 text-xs text-slate-300">{children}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 font-sans text-xs font-semibold text-slate-300 hover:bg-white/[0.07]"
          >
            Cancel
          </button>
          <button
            type="button"
            ref={(el) => {
              if (el) el.focus();
            }}
            onClick={onConfirm}
            data-testid={confirmTestId}
            className="rounded bg-rose-500 px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-rose-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
