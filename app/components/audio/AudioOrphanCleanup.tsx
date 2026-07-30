import { useState } from 'react';
import { AlertTriangle, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { ScanOrphanAudioResult } from '~/types/schemas/audio';

export interface AudioOrphanCleanupProps {
  /** Latest scan result, or null before the first scan has returned. */
  result: ScanOrphanAudioResult | null;
  scanning: boolean;
  deleting: boolean;
  /** Message from a failed scan or delete, already stringified. */
  error: string | null;
  /** Outcome of the most recent delete, or null if none has run. */
  lastDelete: { deleted: number; failed: number } | null;
  onScan: () => void;
  onDelete: (keys: string[]) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * "Reclaim orphaned files" for the audio library.
 *
 * The objects this finds are files in the user's own storage namespace that no
 * asset row references: renditions the worker uploaded but never managed to
 * record (the gap between the rendition PUTs and the fenced DB write), and
 * sources left behind when a delete removed the row but the storage delete
 * failed. Nothing references them, nothing plays them, and the account pays
 * storage for them forever.
 *
 * Deliberately NOT part of the campaign Clean Up panel. That one authorizes
 * with "GM of this campaign", which is not authority over anybody's audio
 * library; this one is scoped to the signed-in user's own assets on the server
 * (`~/server/functions/audio-cleanup.ts`) and takes no scope argument at all —
 * which is why this component sends no user or campaign id anywhere.
 *
 * Presentational: the route owns the mutations. That keeps the stories honest
 * (every state below is reachable by passing props) without a query client.
 */
export function AudioOrphanCleanup({
  result,
  scanning,
  deleting,
  error,
  lastDelete,
  onScan,
  onDelete,
}: AudioOrphanCleanupProps) {
  const [confirming, setConfirming] = useState(false);
  const orphans = result?.orphans ?? [];
  const totalSize = orphans.reduce((sum, o) => sum + o.sizeBytes, 0);
  const busy = scanning || deleting;

  return (
    <section className="mt-4 rounded border border-white/[0.07] bg-white/[0.02] p-3">
      <h2 className="font-sans text-[10px] font-bold uppercase tracking-widest text-slate-500">
        Reclaim orphaned files
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Finds audio files left in storage by a transcode that never finished recording its output.
        Only your own library is inspected.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            onScan();
          }}
          disabled={busy}
          className="flex items-center gap-1.5 rounded border border-white/[0.07] px-2 py-1 font-sans text-xs text-slate-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
        >
          {result ? (
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {scanning ? 'Scanning…' : result ? 'Re-scan' : 'Scan for orphaned files'}
        </button>

        {orphans.length > 0 && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded border border-red-500/30 px-2 py-1 font-sans text-xs text-red-400 transition-colors hover:border-red-500/60 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete {orphans.length} file{orphans.length === 1 ? '' : 's'} ({formatBytes(totalSize)})
          </button>
        )}

        {confirming && (
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-semibold text-red-400">
              Permanently delete?
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete(orphans.map((o) => o.key));
              }}
              disabled={deleting}
              className="rounded border border-red-500/30 px-2 py-1 font-sans text-xs text-red-400 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded border border-white/[0.07] px-2 py-1 font-sans text-xs text-slate-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 font-sans text-xs text-red-400">
          {error}
        </p>
      )}

      {result?.r2Disabled && (
        <p className="mt-3 flex items-start gap-2 font-sans text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Storage isn&apos;t configured in this environment, so nothing can be scanned.
        </p>
      )}

      {/* The truncation signal. The campaign image scanner capped its listing and
          threw `IsTruncated` away, so a large account got a partial scan that
          looked complete. A partial scan here says so. */}
      {result?.truncated && (
        <p className="mt-3 flex items-start gap-2 font-sans text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Partial scan — only the first {result.scannedObjectCount} stored files were checked.
          Re-scan after deleting to cover the rest.
        </p>
      )}

      {lastDelete && (
        <p className="mt-3 font-sans text-xs text-emerald-300">
          Deleted {lastDelete.deleted} file{lastDelete.deleted === 1 ? '' : 's'}
          {lastDelete.failed > 0 && (
            <span className="text-red-400"> ({lastDelete.failed} failed)</span>
          )}
          .
        </p>
      )}

      {result && !result.r2Disabled && orphans.length === 0 && (
        <p className="mt-3 font-sans text-xs italic text-slate-500">
          Nothing to reclaim — every stored file belongs to an asset in your library.
        </p>
      )}

      {orphans.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {orphans.map((o) => (
            <li
              key={o.key}
              className="flex items-baseline justify-between gap-3 border-t border-white/[0.05] pt-1 font-mono text-[11px] text-slate-400"
            >
              <span className="min-w-0 flex-1 truncate">{o.key}</span>
              <span className="tabular-nums text-slate-500">{formatBytes(o.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
