import { AlertTriangle, XCircle } from 'lucide-react';

/** Props for the AudioQuotaBar component. */
export interface AudioQuotaBarProps {
  /**
   * Bytes used across every asset the signed-in user owns, aggregated by
   * `getUserStorageUsage` (`~/server/functions/audio-quota.ts`). `null` while
   * the usage query hasn't resolved yet — distinct from `0`, which is a real
   * "empty library" answer.
   */
  usageBytes: number | null;
  /** Asset rows contributing to `usageBytes`. Ignored while `usageBytes` is `null`. */
  assetCount: number;
  /**
   * The server's per-user cap, in bytes — `AUDIO_USER_QUOTA_BYTES`, read via
   * `getAudioUserQuotaBytes()` (`~/server/functions/audio.ts`) and returned
   * by the SAME server call that produced `usageBytes`. This must always
   * come from that response, never a client-side constant: the write-side
   * enforcement in `assertUnderStorageQuota` reads the env var fresh on
   * every request, and a hand-copied "2 GiB" here would silently diverge the
   * moment an operator changes it (Task 11 wires that env var into the Helm
   * chart specifically so it can change without an image rebuild). `null`
   * while loading, same as `usageBytes`.
   */
  limitBytes: number | null;
  /** Message from a failed usage query, already stringified. */
  error?: string | null;
}

/** Fraction of the limit at which usage is called out as "near" rather than "healthy". */
const NEAR_LIMIT_RATIO = 0.9;

type QuotaStatus = 'healthy' | 'near' | 'over';

/**
 * `usageBytes >= limitBytes` here matches `assertUnderStorageQuota`'s own
 * boundary (`~/server/functions/audio.ts`) exactly: the server refuses a new
 * upload once the caller's usage is AT the limit, not only once it's past
 * it. If this bar called that state merely "near", a user reading "healthy"
 * or "getting close" would be surprised by a refusal their own numbers
 * already crossed.
 */
function quotaStatus(usageBytes: number, limitBytes: number): QuotaStatus {
  if (usageBytes >= limitBytes) return 'over';
  if (limitBytes > 0 && usageBytes / limitBytes >= NEAR_LIMIT_RATIO) return 'near';
  return 'healthy';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * "X of Y used" against the per-user storage quota, shown on `/audio` near
 * the dropzone — a quota a user discovers only by hitting it is a support
 * ticket (see the phase 1.5 design doc).
 *
 * Presentational: the route owns the query. `usageBytes`/`assetCount`/
 * `limitBytes` all come from one `getAudioStorageUsageFn` response — see
 * that prop's doc comment for why `limitBytes` in particular must never be
 * a client-side constant.
 *
 * The near/over distinction is never colour-only: each state pairs a
 * distinct icon (none for healthy, a warning triangle for near, a filled
 * X for over) with its own sentence, so the difference survives grayscale
 * and reads correctly to a screen reader that ignores CSS entirely. The
 * progress track itself carries `role="progressbar"` with a numeric value
 * AND `aria-valuetext`, so assistive tech gets the same "X of Y used"
 * phrasing sighted users see rather than a bare percentage.
 */
export function AudioQuotaBar({ usageBytes, assetCount, limitBytes, error }: AudioQuotaBarProps) {
  if (error) {
    return (
      <p role="alert" className="mt-3 font-sans text-xs text-red-400">
        {error}
      </p>
    );
  }

  if (usageBytes === null || limitBytes === null) {
    return (
      <div aria-live="polite" className="mt-3 font-sans text-xs text-slate-500">
        Checking storage usage…
      </div>
    );
  }

  const status = quotaStatus(usageBytes, limitBytes);
  const percent = limitBytes > 0 ? Math.min(100, (usageBytes / limitBytes) * 100) : 100;
  const usedLabel = formatBytes(usageBytes);
  const limitLabel = formatBytes(limitBytes);
  const valueText = `${usedLabel} of ${limitLabel} used`;

  const trackFillClass =
    status === 'over' ? 'bg-red-500' : status === 'near' ? 'bg-amber-400' : 'bg-blue-500';
  const summaryTextClass =
    status === 'over' ? 'text-red-400' : status === 'near' ? 'text-amber-300' : 'text-slate-400';

  return (
    <div className="mt-3 rounded border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Storage
        </span>
        <span className={`flex items-center gap-1.5 font-sans text-xs ${summaryTextClass}`}>
          {status === 'near' && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          {status === 'over' && <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {valueText}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={valueText}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
      >
        <div
          className={`h-full rounded-full transition-[width] ${trackFillClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {status === 'near' && (
        <p className="mt-1.5 font-sans text-[11px] text-amber-300">
          Approaching your storage limit — delete an asset to make room.
        </p>
      )}
      {status === 'over' && (
        <p className="mt-1.5 font-sans text-[11px] text-red-400">
          Storage limit reached. New uploads will be refused until you delete an asset.
        </p>
      )}

      <p className="mt-1 font-sans text-[11px] text-slate-500">
        {assetCount} asset{assetCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
