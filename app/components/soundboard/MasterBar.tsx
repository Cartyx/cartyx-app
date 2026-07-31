import { Square } from 'lucide-react';

export interface MasterBarProps {
  /** `BoardState.masterVolume`, 0–1. */
  masterVolume: number;
  /** Called with the new 0–1 value as the master slider moves. The caller dispatches `{ type: 'setMasterVolume', volume }` (Task 9). */
  onMasterVolumeChange: (volume: number) => void;
  /** Called when Stop All is pressed. The caller dispatches `{ type: 'stopAll' }` — a panic button, not a reset: it silences every item without unloading the package or mood (see `boardReducer`'s own doc comment on `stopAll`). */
  onStopAll: () => void;
  /** How many items are currently playing — "clear indication of what is currently playing" per the design doc, since layered ambience is easy to lose track of. Also gates Stop All: nothing to stop when this is 0. */
  playingCount: number;
}

/**
 * The board's transport bar: master volume and the stop-all panic button,
 * plus a plain count of what's currently sounding. Deliberately narrow in
 * scope — the design doc's UI list also names the package picker and the
 * enable-audio affordance for this row, but both need data (the package
 * list query, `AudioContext` state) this purely-presentational component
 * has no business owning; Task 17 (the board route) composes those
 * alongside this bar rather than this bar reaching for them itself.
 */
export function MasterBar({
  masterVolume,
  onMasterVolumeChange,
  onStopAll,
  playingCount,
}: MasterBarProps) {
  return (
    <div
      data-testid="master-bar"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
    >
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Master volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          aria-label="Master volume"
          onChange={(e) => onMasterVolumeChange(Number(e.target.value))}
          className="w-32 accent-blue-500"
        />
        <span className="w-9 tabular-nums text-slate-400">{Math.round(masterVolume * 100)}%</span>
      </label>

      <span role="status" data-testid="playing-count" className="text-sm text-slate-400">
        {playingCount === 0 ? 'Nothing playing' : `${playingCount} playing`}
      </span>

      <button
        type="button"
        onClick={onStopAll}
        disabled={playingCount === 0}
        aria-label="Stop all"
        className="ml-auto flex items-center gap-1.5 rounded bg-red-600/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-600/90"
      >
        <Square className="h-3.5 w-3.5" aria-hidden="true" />
        Stop all
      </button>
    </div>
  );
}
