import { AlertTriangle } from 'lucide-react';

export interface PackageConflictNoticeProps {
  /**
   * The `updatedAt` the SERVER currently holds, ISO-encoded — carried on the
   * refusal itself (`PackageStaleWriteError.currentUpdatedAt`). Shown so the
   * conflict has a "when", and passed back as the overwrite's precondition by
   * the caller. Rendered as nothing at all if it is empty or unparseable
   * rather than as "Invalid Date".
   */
  savedAt: string;
  /**
   * Keep the local draft and write it over the stored version. Still fenced
   * on the caller's side — this replays the same edit against `savedAt`, so a
   * THIRD write landing in between is refused again rather than clobbered.
   */
  onOverwrite: () => void;
  /** Throw the local draft away and load what is stored. */
  onDiscard: () => void;
  /** A save is in flight (usually the overwrite this notice just triggered). */
  busy?: boolean;
}

function formatSavedAt(savedAt: string): string | null {
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

/**
 * What the editor shows when `updatePackage` refuses a save because the
 * package changed underneath it.
 *
 * THE POINT OF THIS COMPONENT IS THAT IT DOES NOT DECIDE. The refusal it
 * reports is non-destructive on both sides — the caller's unsaved draft is
 * still in the editor behind this notice, and the newer stored version is
 * still in Mongo — and the whole reason the server refuses instead of merging
 * is that a merge over `items`/`moods` cannot be done correctly without
 * knowing which side ADDED and which side REMOVED each element. Unioning them
 * would resurrect exactly the items an asset delete pruned, which is the bug
 * the precondition exists to stop.
 *
 * So both outcomes are offered, both are labelled with what they cost, and
 * neither happens without a click. A single "Reload" button would be the
 * discard-with-a-confirmation-button this deliberately is not: it would give
 * the user one way forward and that way would throw their work away.
 */
export function PackageConflictNotice({
  savedAt,
  onOverwrite,
  onDiscard,
  busy = false,
}: PackageConflictNoticeProps) {
  const when = formatSavedAt(savedAt);

  return (
    <div
      role="alert"
      data-testid="package-conflict-notice"
      className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-sans text-sm font-semibold text-amber-300">
            This package changed somewhere else
          </p>
          <p className="mt-1 text-sm text-slate-300">
            It was saved{' '}
            {when ? (
              <>
                at <time dateTime={savedAt}>{when}</time>,{' '}
              </>
            ) : null}
            after you opened it — from another tab, or by an asset you deleted from your library.
            Nothing has been lost: your unsaved edits are still on this page, and the saved version
            is still stored. Pick which one to keep.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOverwrite}
              disabled={busy}
              className="rounded bg-amber-600 px-3 py-1.5 font-sans text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Keep my edits and overwrite'}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={busy}
              className="rounded border border-white/15 px-3 py-1.5 font-sans text-xs font-semibold text-slate-200 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard my edits and load the saved version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
