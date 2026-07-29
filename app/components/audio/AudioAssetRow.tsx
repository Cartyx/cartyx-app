import { memo } from 'react';
import { Play, Pencil, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { AudioWaveform } from './AudioWaveform';
import type { AudioAssetData } from '~/types/audio';

/**
 * Formats a duration in milliseconds as `m:ss`.
 *
 * Returns an em dash for missing or invalid (negative) durations — assets
 * that haven't finished processing yet don't have a `durationMs`. Minutes
 * are not capped at 60, so durations over an hour render as e.g. `61:01`
 * rather than switching to an `h:mm:ss` format.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Props for the AudioAssetRow component. */
export interface AudioAssetRowProps {
  /** The asset to display. */
  asset: AudioAssetData;
  /** When true, renders a selection checkbox. Defaults to false. */
  selectable?: boolean;
  /** Checked state of the selection checkbox. */
  selected?: boolean;
  /** Called with the asset id when the selection checkbox is toggled. */
  onToggleSelect?: (id: string) => void;
  /** Called with the full asset when the play button is clicked (ready assets only — a non-ready asset has no rendition to play). */
  onPlay?: (asset: AudioAssetData) => void;
  /** Called with the full asset when the edit button is clicked. Available regardless of status: the edit modal only touches metadata (title/kind/facets/tags), none of which depend on the audio existing yet. */
  onEdit?: (asset: AudioAssetData) => void;
}

/**
 * A single row in the audio asset library. Purely presentational: it owns no
 * fetching, no mutations, and no routing — callers wire up `onPlay`/`onEdit`/
 * `onToggleSelect`. This keeps it reusable as-is for the phase 2 campaign
 * asset picker, which mounts the same component with different callbacks.
 *
 * Renders an `<li>` so it composes directly into a parent `<ul>` (see
 * `AudioLibraryBrowser`). Callers rendering a row standalone (tests,
 * Storybook) should wrap it in a `<ul>` themselves to keep the DOM valid.
 *
 * Memoized: each row renders an `AudioWaveform` with up to ~400 `<rect>`s,
 * so a library list can carry tens of thousands of SVG nodes. Without
 * `memo`, any re-render of the parent list (e.g. `AudioLibraryBrowser`
 * re-rendering because `selectedIds` got a new array reference from
 * toggling a checkbox) would reconcile every row's waveform, not just the
 * one that changed — selection is the primary interaction for the bulk
 * classification workflow this component exists to serve, so that's not
 * an edge case. This only pays off if callers pass stable
 * `onToggleSelect`/`onPlay`/`onEdit` references; `AudioLibraryBrowser`
 * forwards its own props straight through without wrapping them in new
 * closures, so memo bails out correctly as long as its caller does the
 * same.
 */
function AudioAssetRowComponent({
  asset,
  selectable = false,
  selected = false,
  onToggleSelect,
  onPlay,
  onEdit,
}: AudioAssetRowProps) {
  return (
    <li className="flex items-center gap-3 border-b border-white/[0.06] px-3 py-2">
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect?.(asset.id)}
          aria-label={`Select ${asset.title}`}
          className="h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.05] text-blue-500 focus:ring-blue-500/30"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-200">{asset.title}</span>
          <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            {asset.kind}
          </span>
        </div>
        <AudioWaveform peaks={asset.peaks} height={24} className="mt-1 text-blue-500/50" />
        {asset.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
            {asset.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        )}
      </div>

      <span className="shrink-0 tabular-nums text-sm text-slate-400">
        {formatDuration(asset.durationMs)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        {asset.status === 'ready' && (
          <button
            type="button"
            onClick={() => onPlay?.(asset)}
            aria-label={`Play ${asset.title}`}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-blue-400"
          >
            <Play className="h-4 w-4" />
          </button>
        )}

        {/* Edit is reachable at every status — see the onEdit doc comment above. */}
        <button
          type="button"
          onClick={() => onEdit?.(asset)}
          aria-label={`Edit ${asset.title}`}
          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
        >
          <Pencil className="h-4 w-4" />
        </button>

        {asset.status === 'failed' ? (
          <span className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {asset.lastError ?? 'Processing failed'}
          </span>
        ) : asset.status === 'pending' ? (
          // Queued but not yet claimed by a worker. Deliberately NOT a spinner:
          // if the worker is down, assets sit here indefinitely, and an
          // animated "in progress" indicator would misrepresent a stalled
          // queue as active work.
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Queued — waiting to process
          </span>
        ) : asset.status !== 'ready' ? (
          // uploading | processing — work is actively happening (client
          // upload or a worker that has claimed the job), so an animated
          // indicator is honest here.
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            {asset.status === 'uploading' ? 'Uploading…' : 'Processing…'}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export const AudioAssetRow = memo(AudioAssetRowComponent);
