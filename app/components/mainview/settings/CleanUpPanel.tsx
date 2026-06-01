import { useState } from 'react';
import { AlertTriangle, RefreshCw, Search, Trash2 } from 'lucide-react';
import { PixelButton } from '~/components/PixelButton';
import { useDeleteOrphanImages, useScanOrphanImages } from '~/hooks/useOrphanImages';

interface CleanUpPanelProps {
  campaignId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function CleanUpPanel({ campaignId }: CleanUpPanelProps) {
  const [hasScanned, setHasScanned] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastDelete, setLastDelete] = useState<{ deleted: number; failed: number } | null>(null);

  const {
    result,
    isLoading: isScanning,
    isFetching,
    error: scanError,
    refetch,
  } = useScanOrphanImages(campaignId, hasScanned);
  const { deleteOrphans, isLoading: isDeleting } = useDeleteOrphanImages();

  const handleScan = async () => {
    setLastDelete(null);
    setConfirmDelete(false);
    if (!hasScanned) {
      setHasScanned(true);
      return;
    }
    await refetch();
  };

  const handleDelete = async () => {
    if (!result || result.orphans.length === 0) return;
    const keys = result.orphans.map((o) => o.imageKey);
    const res = await deleteOrphans({ campaignId, imageKeys: keys });
    setConfirmDelete(false);
    if (res) {
      setLastDelete({ deleted: res.deleted.length, failed: res.failed.length });
    }
  };

  const totalSize = (result?.orphans ?? []).reduce((sum, o) => sum + o.sizeBytes, 0);
  const isWorking = isScanning || isFetching || isDeleting;

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header>
        <h3 className="font-sans font-bold text-sm text-white tracking-wide mb-1">Clean Up</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Find and remove uploaded images that aren't referenced by any campaign in the system.
          Reviews <span className="text-slate-300">location images</span>,{' '}
          <span className="text-slate-300">character pictures</span>,{' '}
          <span className="text-slate-300">player avatars</span>, and{' '}
          <span className="text-slate-300">campaign cover images</span>.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <PixelButton
          variant="primary"
          size="sm"
          onClick={handleScan}
          disabled={isWorking}
          type="button"
        >
          <span className="flex items-center gap-1.5">
            {hasScanned ? (
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {isScanning || isFetching ? 'Scanning...' : hasScanned ? 'Re-scan' : 'Scan for orphans'}
          </span>
        </PixelButton>
        {result && result.orphans.length > 0 && !confirmDelete && (
          <PixelButton
            variant="secondary"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={isWorking}
            type="button"
          >
            <span className="flex items-center gap-1.5 text-rose-400">
              <Trash2 className="h-3.5 w-3.5" />
              Delete {result.orphans.length} {result.orphans.length === 1 ? 'orphan' : 'orphans'}
            </span>
          </PixelButton>
        )}
        {confirmDelete && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-rose-400 font-semibold">Permanently delete?</span>
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              type="button"
            >
              <span className="text-rose-400">{isDeleting ? 'Deleting...' : 'Yes, delete'}</span>
            </PixelButton>
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={isDeleting}
              type="button"
            >
              Cancel
            </PixelButton>
          </div>
        )}
      </div>

      {scanError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-semibold">
          {scanError}
        </div>
      )}

      {result?.r2Disabled && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            R2 storage isn't configured for this environment. No orphan scan is possible.
          </p>
        </div>
      )}

      {lastDelete && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
          <p className="font-semibold text-emerald-300">
            Deleted {lastDelete.deleted} {lastDelete.deleted === 1 ? 'image' : 'images'}
            {lastDelete.failed > 0 && (
              <span className="text-rose-400"> ({lastDelete.failed} failed)</span>
            )}
            .
          </p>
        </div>
      )}

      {result && !result.r2Disabled && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-sans font-bold border-b border-white/[0.07] pb-2">
            <div>R2 keys scanned</div>
            <div>In-use references</div>
            <div>Orphans found</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm font-sans font-bold text-white">
            <div>{result.scannedKeyCount}</div>
            <div>{result.inUseKeyCount}</div>
            <div className={result.orphans.length > 0 ? 'text-amber-300' : 'text-emerald-300'}>
              {result.orphans.length}
              {result.orphans.length > 0 && (
                <span className="text-slate-500 text-xs font-normal ml-2">
                  ({formatBytes(totalSize)})
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {result && result.orphans.length > 0 && (
        <div className="border border-white/[0.07] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500 font-sans font-bold">
              <tr>
                <th className="text-left px-3 py-2 font-normal">Key</th>
                <th className="text-right px-3 py-2 font-normal w-24">Size</th>
                <th className="text-right px-3 py-2 font-normal w-40">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {result.orphans.map((o) => (
                <tr key={o.imageKey} className="border-t border-white/[0.05]">
                  <td className="px-3 py-2 font-mono text-slate-300 break-all">{o.imageKey}</td>
                  <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                    {formatBytes(o.sizeBytes)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                    {formatDate(o.lastModified)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && result.orphans.length === 0 && !result.r2Disabled && (
        <p className="text-xs text-slate-500 italic">
          No orphan images — everything in R2 is referenced.
        </p>
      )}

      {!hasScanned && !isScanning && (
        <p className="text-xs text-slate-600 italic">
          Click <span className="text-slate-400 font-semibold">Scan for orphans</span> to inspect
          R2. The scan is read-only.
        </p>
      )}
    </div>
  );
}
