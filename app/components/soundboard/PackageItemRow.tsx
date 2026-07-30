import { Trash2 } from 'lucide-react';
import type { PackageItemData } from '~/types/soundboard';

export interface PackageItemRowProps {
  /** The item this row edits. */
  item: PackageItemData;
  /** Called with a partial patch of changed fields — never the whole item, so a caller can shallow-merge it in. */
  onChange: (patch: Partial<PackageItemData>) => void;
  /** Called when the row's remove button is clicked. Absent entirely when `readOnly`. */
  onRemove: () => void;
  /** System packages are immutable server-side (see `PackageList`'s doc comment) — this disables every control rather than let a user "successfully" edit a row whose save is guaranteed to fail. */
  readOnly?: boolean;
}

/** `item.label` overrides the asset's own title (see `PackageItemData`'s doc comment); falls back to a short id fragment for items that predate labels or lost their asset. */
function displayLabel(item: PackageItemData): string {
  return item.label ?? `Asset ${item.assetId.slice(-6)}`;
}

/**
 * `null` means "this input does not currently hold a number" — which
 * includes the EMPTY string. `Number('')` is `0`, not `NaN`, so a bare
 * `Number.isNaN` check let a cleared field through as a real `0`: clearing
 * Volume muted the item and clearing Fade set an instant cut, and the
 * `parsed !== null` guard at every call site was dead code. Final-review
 * fix; the intent it restores is the one `handleRandomInterval` has always
 * had, and the same one `MoodEditor`'s `toNumberOrUndefined` encodes.
 *
 * Unlike a mood override, these fields are REQUIRED on `PackageItemData`,
 * so an emptied input cannot emit `undefined` — it emits nothing at all and
 * the item keeps its current value until the user types a new one.
 */
function toNumber(raw: string): number | null {
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * One package item's playback controls: volume, fade, loop, and the
 * one-shot random-interval pair. Purely presentational and controlled, like
 * `AudioAssetRow` — no fetching, no local item state. `PackageEditor` owns
 * the array and reassigns `sortIndex`; this component only ever emits the
 * fields the user actually touched.
 *
 * The random-interval pair is visually flagged (not blocked) when min > max
 * — `packageItemSchema`'s `.refine` would reject the whole save for that,
 * and the row is the only place that can explain why before the user hits
 * Save.
 */
export function PackageItemRow({
  item,
  onChange,
  onRemove,
  readOnly = false,
}: PackageItemRowProps) {
  const label = displayLabel(item);

  const handleVolume = (raw: string) => {
    const parsed = toNumber(raw);
    if (parsed !== null) onChange({ volume: parsed });
  };

  const handleFade = (raw: string) => {
    const parsed = toNumber(raw);
    if (parsed !== null) onChange({ fadeSeconds: parsed });
  };

  const handleRandomInterval = (field: 'randomIntervalMin' | 'randomIntervalMax', raw: string) => {
    if (raw === '') {
      onChange({ [field]: undefined });
      return;
    }
    const parsed = toNumber(raw);
    if (parsed !== null) onChange({ [field]: parsed });
  };

  const intervalInvalid =
    item.randomIntervalMin != null &&
    item.randomIntervalMax != null &&
    item.randomIntervalMin > item.randomIntervalMax;

  return (
    <li
      data-testid="package-item-row"
      data-item-id={item.id}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5"
    >
      <span className="min-w-0 basis-40 flex-1 truncate text-sm font-medium text-slate-200">
        {label}
      </span>

      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={item.volume}
          disabled={readOnly}
          aria-label={`Volume for ${label}`}
          onChange={(e) => handleVolume(e.target.value)}
          className="w-24 accent-blue-500 disabled:opacity-50"
        />
        <span className="w-9 tabular-nums text-slate-400">{Math.round(item.volume * 100)}%</span>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        Fade (s)
        <input
          type="number"
          min={0}
          max={30}
          step={0.5}
          value={item.fadeSeconds}
          disabled={readOnly}
          aria-label={`Fade seconds for ${label}`}
          onChange={(e) => handleFade(e.target.value)}
          className="w-16 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:border-blue-500/50 focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <input
          type="checkbox"
          checked={item.loop}
          disabled={readOnly}
          aria-label={`Loop ${label}`}
          onChange={(e) => onChange({ loop: e.target.checked })}
          className="h-4 w-4 rounded border-white/20 bg-white/[0.05] text-blue-500 focus:ring-blue-500/30"
        />
        Loop
      </label>

      <div className="flex items-center gap-1 text-[11px] text-slate-500">
        <span>Random interval (s)</span>
        <input
          type="number"
          min={1}
          max={3600}
          value={item.randomIntervalMin ?? ''}
          disabled={readOnly}
          aria-invalid={intervalInvalid}
          aria-label={`Random interval minimum for ${label}`}
          onChange={(e) => handleRandomInterval('randomIntervalMin', e.target.value)}
          className={`w-16 rounded border bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:outline-none disabled:opacity-50 ${
            intervalInvalid ? 'border-rose-500/60' : 'border-white/10 focus:border-blue-500/50'
          }`}
        />
        <span aria-hidden="true">–</span>
        <input
          type="number"
          min={1}
          max={3600}
          value={item.randomIntervalMax ?? ''}
          disabled={readOnly}
          aria-invalid={intervalInvalid}
          aria-label={`Random interval maximum for ${label}`}
          onChange={(e) => handleRandomInterval('randomIntervalMax', e.target.value)}
          className={`w-16 rounded border bg-white/[0.04] px-1.5 py-0.5 text-slate-200 focus:outline-none disabled:opacity-50 ${
            intervalInvalid ? 'border-rose-500/60' : 'border-white/10 focus:border-blue-500/50'
          }`}
        />
        {intervalInvalid && <span className="text-rose-400">Min must be ≤ max</span>}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="ml-auto rounded p-1.5 text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
