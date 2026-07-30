import { memo } from 'react';
import { Play, Square, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import type { AudioAssetData } from '~/types/audio';
import type { PackageItemData } from '~/types/soundboard';

/** `item.label` overrides the asset's own title; falls back to a short id fragment. Matches `PackageItemRow`/`MoodEditor`'s identical helper — duplicated rather than shared across the editor/board seam, same call those two made against each other. */
function displayLabel(item: PackageItemData): string {
  return item.label ?? `Asset ${item.assetId.slice(-6)}`;
}

/**
 * Board ordering. Task 9's `resolveAllItems` (`~/lib/soundboard/reducer`)
 * preserves `pkg.items`' ARRAY order, not `sortIndex` order — recorded
 * there as a deferred decision, with the note that whatever renders the
 * pad list must sort at render time instead. `BoardState.items` (the
 * `BoardItemState[]` the reducer actually produces) has no `sortIndex` of
 * its own — only `PackageItemData` does — so the caller assembling a pad
 * list (Task 17) should sort `pkg.items` with this first and use THAT
 * order to look up each item's resolved `BoardItemState`/asset, exactly
 * how `MoodEditor` already sorts `items` inline before rendering its own
 * per-item rows. Exported here (rather than duplicated a third time)
 * because this is where a pad's own ordering-relevant data lives.
 */
export function sortItemsBySortIndex(items: PackageItemData[]): PackageItemData[] {
  return [...items].sort((a, b) => a.sortIndex - b.sortIndex);
}

/**
 * Why the pad is currently unusable, or `null` if it isn't.
 *
 * Deliberately does NOT collapse to one generic "Unavailable" string: a GM
 * mid-session needs to know whether a silent pad is "still transcoding, give
 * it a minute" (wait), "the upload never finished" (re-upload), or "this
 * sound was removed from the library" (pick something else) — three
 * different responses to the same disabled button. See the design doc's
 * failure-modes table: "Referenced asset not ready" and "Rendition URL
 * 404s"/decode failure are named as SEPARATE rows for the same reason.
 *
 * `asset` is `undefined` for a dangling reference — a package item whose
 * `assetId` no longer resolves to a live asset (the asset was deleted).
 * That is an EXPECTED state per the design's failure-modes table, not a bug,
 * so this function (and every caller of it) must handle it without ever
 * touching a property of `asset` before checking it is defined.
 */
function unavailableReason(
  asset: AudioAssetData | undefined,
  decodeFailed: boolean
): string | null {
  if (!asset) {
    return 'This sound was removed from your library';
  }
  if (decodeFailed) {
    // Distinct from every asset-status case below: the asset resolved fine
    // and the server considers it `ready`, but the browser could not decode
    // the rendition bytes it fetched (a corrupt object, an unsupported
    // codec in this browser, a 404 masquerading as an empty response — see
    // the design doc's "Rendition URL 404s" failure-mode row). Checked
    // before `status` so a caller that has BOTH signals (rare, but
    // `decodeFailed` can only be known after a `status: 'ready'` asset
    // loaded) always shows the more specific, more recent reason.
    return 'Failed to decode this rendition';
  }
  switch (asset.status) {
    case 'ready':
      return null;
    case 'pending':
      // Queued but not yet claimed by a worker — matches AudioAssetRow's own
      // wording for the same status, so a GM who has seen the library page
      // recognizes the phrase on the board.
      return 'Queued — waiting to process';
    case 'uploading':
      return 'Uploading…';
    case 'processing':
      return 'Processing…';
    case 'failed':
      return asset.lastError ? `Failed to process: ${asset.lastError}` : 'Failed to process';
  }
}

function ReasonIcon({
  asset,
  decodeFailed,
}: {
  asset: AudioAssetData | undefined;
  decodeFailed: boolean;
}) {
  if (!asset || decodeFailed || asset.status === 'failed') {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  }
  if (asset.status === 'pending') {
    return <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  }
  return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />;
}

export interface BoardPadProps {
  /** The package item this pad renders — supplies the pad's id and its
   * display label. The label ALWAYS comes from here, never from `asset`
   * (see `displayLabel`): that is what keeps a dangling reference
   * recoverable instead of anonymous — a GM who sees "Thunder — unavailable"
   * can still tell which pad it was. */
  item: PackageItemData;
  /** This item's resolved playback state (`BoardState.items`, keyed by
   * `itemId`) — whether it is currently sounding. */
  playing: boolean;
  /** This item's resolved volume (`BoardState.items[].volume`), 0–1. */
  volume: number;
  /** The library asset `item.assetId` refers to. `undefined` when it no
   * longer resolves — packages reference assets, and assets can be deleted
   * (design doc, failure modes). Every read of a property on `asset` in
   * this component goes through a null-safe path; nothing here assumes it
   * is present. */
  asset: AudioAssetData | undefined;
  /** Set by the caller when the Web Audio engine's `loadAsset`/decode step
   * failed for THIS item even though `asset` resolved and reports `ready`
   * — the rendition URL 404'd, or the browser couldn't decode the bytes.
   * The pad itself never decodes anything; it only renders what it's told. */
  decodeFailed?: boolean;
  /** Called with the item's id when the play control is pressed while not playing. */
  onPlay: (itemId: string) => void;
  /** Called with the item's id when the stop control is pressed while playing. */
  onStop: (itemId: string) => void;
  /** Called with the item's id and the new 0–1 value when the volume slider moves. */
  onVolumeChange: (itemId: string, volume: number) => void;
}

/**
 * One playable pad on the GM's live board. Purpose-built for this surface —
 * NOT `AudioAssetRow`, which carries selection checkboxes, a waveform and
 * edit/delete affordances that make no sense mid-session (see the design
 * doc's "Board pads are purpose-built" note and this task's brief).
 *
 * Renders: the item's label, whether it's playing, its volume, and — this is
 * the load-bearing part — an unavailable state with a SPECIFIC reason
 * whenever the asset isn't `ready` or its rendition couldn't be decoded,
 * instead of either throwing on a dangling reference or rendering a mute
 * blank.
 *
 * NO ∞/1× once-variant control, deliberately. Task 16 shipped one as local
 * `useState`; the final whole-branch review removed it because it was wired
 * to nothing and could not be wired without changes this phase does not
 * make. `SoundboardCommand` (Task 9) carries no variant, `BoardState` has no
 * field for one, and `useSoundboard`'s `loadAsset` picks a rendition from
 * `asset.renditions` only — never `asset.onceRenditions` — so pressing the
 * toggle changed a glyph and nothing else. Rendering a control that cannot
 * affect what the table hears is worse than rendering none: a GM sets it to
 * 1×, hears a loop, and has no way to tell the control is inert. The variant
 * is still uploaded, transcoded and stored (Task 18); playing it needs a
 * variant channel through `SoundboardCommand` -> `BoardItemState` ->
 * `loadAsset`, which is phase 2b's. `AudioAssetDetail`'s attach copy says
 * exactly that, and must keep saying it until this control comes back.
 *
 * Memoized: a mood with many pads re-renders every pad on nearly every
 * board interaction (a single volume drag re-renders the whole list via
 * `useReducer`), so a pad whose own props didn't change should bail out
 * rather than re-run. This ONLY holds if the caller passes referentially
 * stable `onPlay`/`onStop`/`onVolumeChange` (`useCallback`, not inline
 * arrows) and a stable `item`/`asset` reference per item — phase 1's
 * `useDeleteConfirm` silently defeated an identical memo by returning a
 * fresh closure every render. `BoardPad.test.tsx` confirms both that this
 * is wrapped with `memo()`'s DEFAULT shallow comparator (not a custom one
 * that could mask a real change) AND, separately, that the bail-out itself
 * actually happens: it spies on the memo object's `.type` (the inner render
 * function React calls when it decides a re-render is needed) and asserts
 * the spy is called once, not twice, across a re-render with shallow-equal
 * props — proven to have teeth by swapping in a fresh inline arrow prop and
 * confirming that assertion fails. An earlier attempt at this same proof
 * used `Profiler` and was abandoned: `Profiler.onRender` fires once per
 * commit reaching its subtree regardless of a memoized descendant's
 * bail-out, so it could not distinguish "bailed out" from "re-rendered
 * with identical output" — see the task report's "Memo verification"
 * section for the repro and the correction.
 */
export const BoardPad = memo(function BoardPad({
  item,
  playing,
  volume,
  asset,
  decodeFailed = false,
  onPlay,
  onStop,
  onVolumeChange,
}: BoardPadProps) {
  const label = displayLabel(item);
  const reason = unavailableReason(asset, decodeFailed);
  const unavailable = reason !== null;

  return (
    <div
      data-testid="board-pad"
      data-item-id={item.id}
      className={`flex flex-col gap-2 rounded-lg border p-3 ${
        unavailable
          ? 'border-white/[0.06] bg-white/[0.02] opacity-70'
          : playing
            ? 'border-blue-500/50 bg-blue-500/[0.08]'
            : 'border-white/10 bg-white/[0.04]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{label}</span>
      </div>

      <button
        type="button"
        // Play must stay blocked while unavailable — pressing it would try
        // to start a sound that cannot load/decode. Stop must NOT be
        // blocked: `playing` can be `true` for an unavailable pad (a
        // dangling reference or a decode failure discovered mid-playback,
        // per the design doc's failure-modes table), and this is the ONE
        // button that serves as both Play and Stop. `disabled={unavailable}`
        // alone made a playing-but-unavailable pad permanently stuck —
        // unstoppable from the pad itself, recoverable only via Master
        // Bar's Stop All. See `BoardPad.test.tsx`'s "unavailable pad" pair
        // for the two-halves proof this doesn't just re-enable Play too.
        disabled={unavailable && !playing}
        onClick={() => (playing ? onStop(item.id) : onPlay(item.id))}
        aria-pressed={playing}
        aria-label={playing ? `Stop ${label}` : `Play ${label}`}
        className={`flex items-center justify-center gap-1.5 rounded py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          playing
            ? 'bg-blue-600 text-white hover:bg-blue-500'
            : 'bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]'
        }`}
      >
        {playing ? (
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {playing ? 'Playing' : 'Play'}
      </button>

      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
        Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          disabled={unavailable}
          aria-label={`Volume for ${label}`}
          onChange={(e) => onVolumeChange(item.id, Number(e.target.value))}
          className="w-full accent-blue-500 disabled:opacity-50"
        />
        <span className="w-9 shrink-0 tabular-nums text-slate-400">
          {Math.round(volume * 100)}%
        </span>
      </label>

      {unavailable && (
        <p
          role="status"
          data-testid="pad-unavailable-reason"
          className="flex items-center gap-1.5 text-xs text-amber-400"
        >
          <ReasonIcon asset={asset} decodeFailed={decodeFailed} />
          {reason}
        </p>
      )}
    </div>
  );
});
