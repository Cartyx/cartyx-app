import { useState } from 'react';

const BATCH_MIN = 1;
const BATCH_MAX = 20;

/** Modal counter (1–20) for shift-drag batch placement of a monster. */
export function MonsterBatchDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: (count: number) => void;
}) {
  const [count, setCount] = useState(1);
  const clampCount = (n: number) => Math.max(BATCH_MIN, Math.min(BATCH_MAX, n));

  return (
    <div
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="monster-batch-dialog"
    >
      <div
        role="dialog"
        aria-labelledby="monster-batch-title"
        className="w-full max-w-xs rounded-lg border border-white/10 bg-[#0D1117] p-4 shadow-2xl"
      >
        <h2 id="monster-batch-title" className="font-sans text-sm font-bold text-slate-200">
          Place {name}
        </h2>
        <p className="font-sans mt-1 text-xs text-slate-400">
          How many should be scattered on the map?
        </p>

        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Decrease"
            onClick={() => setCount((c) => clampCount(c - 1))}
            disabled={count <= BATCH_MIN}
            data-testid="monster-batch-decrement"
            className="flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/[0.03] font-sans text-lg text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
          >
            −
          </button>
          <span
            className="min-w-[2.5rem] text-center font-mono text-2xl font-bold tabular-nums text-white"
            data-testid="monster-batch-count"
            aria-live="polite"
          >
            {count}
          </span>
          <button
            type="button"
            aria-label="Increase"
            onClick={() => setCount((c) => clampCount(c + 1))}
            disabled={count >= BATCH_MAX}
            data-testid="monster-batch-increment"
            className="flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/[0.03] font-sans text-lg text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
          >
            +
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 font-sans text-xs font-semibold text-slate-300 hover:bg-white/[0.07]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(clampCount(count))}
            data-testid="monster-batch-place"
            className="rounded bg-blue-600 px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-blue-500"
          >
            Place {count}
          </button>
        </div>
      </div>
    </div>
  );
}
