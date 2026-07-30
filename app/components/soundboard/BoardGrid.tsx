import { useMemo } from 'react';
import { BoardPad, sortItemsBySortIndex } from '~/components/soundboard/BoardPad';
import type { AudioAssetData } from '~/types/audio';
import type { PackageItemData } from '~/types/soundboard';
import type { BoardItemState } from '~/lib/soundboard/reducer';

/**
 * The four buckets a pad can land in. The first three are `AudioKind`
 * (`~/types/audio`) verbatim — the design doc's "pads grouped by music /
 * ambience / one-shot", which is what `kind` was made required for.
 *
 * `unresolved` is the fourth, and it is not an `AudioKind`: an item whose
 * `assetId` no longer resolves to a live asset has NO kind to group by, and
 * the naive `groups[asset.kind].push(item)` drops it from every group. That is
 * the worst available outcome — the pad the GM most needs to find (to remove
 * it from the package) is the one that vanishes. It gets its own visible
 * section instead, where `BoardPad`'s own unavailable state explains why.
 */
export const BOARD_GROUPS = [
  { key: 'music', label: 'Music' },
  { key: 'ambience', label: 'Ambience' },
  { key: 'one-shot', label: 'One-shots' },
  { key: 'unresolved', label: 'Unavailable' },
] as const;

export type BoardGroupKey = (typeof BOARD_GROUPS)[number]['key'];

/**
 * Sort by `sortIndex`, then bucket by the referenced asset's `kind`.
 *
 * Sorting happens HERE and not in the reducer because Task 9's
 * `resolveAllItems` preserves `pkg.items`' array order, not `sortIndex` order,
 * and `BoardState.items` carries no `sortIndex` of its own — only
 * `PackageItemData` does. `sortItemsBySortIndex` is Task 16's exported helper,
 * reused rather than re-implemented.
 *
 * Pure and non-mutating: the caller's `items` array is never reordered in
 * place (a query cache holds that array).
 */
export function groupItemsByKind(
  items: readonly PackageItemData[],
  assetsById: ReadonlyMap<string, AudioAssetData>
): Record<BoardGroupKey, PackageItemData[]> {
  const groups: Record<BoardGroupKey, PackageItemData[]> = {
    music: [],
    ambience: [],
    'one-shot': [],
    unresolved: [],
  };
  for (const item of sortItemsBySortIndex([...items])) {
    const kind = assetsById.get(item.assetId)?.kind;
    groups[kind ?? 'unresolved'].push(item);
  }
  return groups;
}

export interface BoardGridProps {
  /** The loaded package's items — `pkg.items`, unsorted. */
  items: readonly PackageItemData[];
  /**
   * The assets those items reference, from Task 21's package-scoped
   * `listPackageAssetsFn`. NOT `listAudioAssetsFn`: that list is owner-scoped
   * and cursor-paginated at 50 while a package holds up to 64 items, so a
   * package straddling the boundary would silently lose the `kind` of its
   * tail and dump those pads into `unresolved`.
   */
  assets: readonly AudioAssetData[];
  /** `BoardState.items` — each item's resolved `playing`/`volume`. */
  itemStates: readonly BoardItemState[];
  /** Must be referentially stable (`useCallback`): `BoardPad` is memoized. */
  onPlay: (itemId: string) => void;
  /** Must be referentially stable (`useCallback`): `BoardPad` is memoized. */
  onStop: (itemId: string) => void;
  /** Must be referentially stable (`useCallback`): `BoardPad` is memoized. */
  onVolumeChange: (itemId: string, volume: number) => void;
}

/**
 * The pad grid: every item in the loaded package, sorted, grouped by kind and
 * driven by the live `BoardState`.
 *
 * Purely presentational — it dispatches nothing and fetches nothing. The three
 * handlers are passed straight through to `BoardPad`, which is memoized with
 * the default shallow comparator, so a caller that hands this component fresh
 * inline arrows defeats the memo for all 64 pads at once (phase 1's
 * `useDeleteConfirm` did exactly this). `tests/routes/soundboard-route.test.tsx`
 * spies on `BoardPad.type` and asserts the bail-out actually holds against the
 * REAL route's handlers, which is the only thing that can catch a regression
 * there.
 */
export function BoardGrid({
  items,
  assets,
  itemStates,
  onPlay,
  onStop,
  onVolumeChange,
}: BoardGridProps) {
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const stateByItemId = useMemo(
    () => new Map(itemStates.map((state) => [state.itemId, state])),
    [itemStates]
  );
  const groups = useMemo(() => groupItemsByKind(items, assetsById), [items, assetsById]);

  if (items.length === 0) {
    return (
      <p data-testid="board-grid-empty" className="text-sm text-slate-500">
        This package has no sounds yet. Add some in the package editor.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {BOARD_GROUPS.map(({ key, label }) => {
        const groupItems = groups[key];
        if (groupItems.length === 0) return null;
        return (
          <section key={key} data-testid={`board-group-${key}`}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              {label}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {groupItems.map((item) => {
                // A package that has just arrived is one commit ahead of the
                // reducer (`useSoundboard`'s `[pkg]` effect runs after the
                // render that first sees it), so an item can legitimately have
                // no board state for one frame. Fall back to the item's own
                // settings rather than rendering a 0-volume, dead-looking pad.
                const state = stateByItemId.get(item.id);
                return (
                  <BoardPad
                    key={item.id}
                    item={item}
                    asset={assetsById.get(item.assetId)}
                    playing={state?.playing ?? false}
                    volume={state?.volume ?? item.volume}
                    onPlay={onPlay}
                    onStop={onStop}
                    onVolumeChange={onVolumeChange}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
