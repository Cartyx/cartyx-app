import { useMemo, useState } from 'react';
import { AudioLibraryBrowser } from '~/components/audio/AudioLibraryBrowser';
import type { AudioFilters } from '~/components/audio/AudioFilterBar';
import { PackageItemRow } from './PackageItemRow';
import { MAX_PACKAGE_ITEMS, DEFAULT_VOLUME, DEFAULT_FADE_SECONDS } from '~/types/soundboard';
import type { PackageItemData } from '~/types/soundboard';
import type { AudioAssetData } from '~/types/audio';

export interface PackageEditorProps {
  /** The package's current items. Fully controlled — this component holds no item state of its own. */
  items: PackageItemData[];
  /**
   * Called with the complete next items array on every add/remove/edit.
   * Always reindexed (`sortIndex` reassigned to match array order) before
   * this fires — see the doc comment on `emit` below for why that matters.
   * The caller owns persistence timing (e.g. an explicit Save, or straight
   * through to `updatePackageFn`); this component never calls a server fn.
   */
  onItemsChange: (items: PackageItemData[]) => void;
  /** Picker assets — already filtered server-side, same contract as `AudioLibraryBrowser`. This component never filters them itself. */
  assets: AudioAssetData[];
  /** Passed straight through to the picker. */
  loading?: boolean;
  filters: AudioFilters;
  onFiltersChange: (next: AudioFilters) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  /**
   * True for a system package (`ownerId === null`) — `updatePackage`'s
   * write is owner-scoped and can never match a system package, so editing
   * one always fails server-side. Rather than let the user "successfully"
   * edit a row and discover that on save, this hides the picker entirely
   * and disables every item control.
   */
  readOnly?: boolean;
}

/**
 * The package editor's item list, plus `AudioLibraryBrowser` mounted as an
 * asset picker (`selectable` + an "Add to package" `actionsSlot`) — the
 * reuse phase 1 built `AudioLibraryBrowser` for for exactly this moment. No
 * fork, no `mode` prop: the picker vs. management distinction lives entirely
 * in which props are passed, per that component's own doc comment.
 *
 * Owns no fetching and no server mutation, matching `PackageList`'s
 * convention: `items`/`assets`/`filters` are the caller's, and this
 * component only ever emits change events. The item cap
 * (`MAX_PACKAGE_ITEMS`) is enforced here, in the UI, not only in
 * `packageItemSchema` — a user who fills a 65th item and gets a Zod
 * rejection after a server round trip has had that work thrown away, so the
 * "Add to package" button disables itself at the cap instead.
 */
export function PackageEditor({
  items,
  onItemsChange,
  assets,
  loading = false,
  filters,
  onFiltersChange,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  readOnly = false,
}: PackageEditorProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Display order follows sortIndex, not array-insertion order — defensive
  // against data that arrived out of order (e.g. a future editing path that
  // reorders items without also physically reordering the array).
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.sortIndex - b.sortIndex), [items]);

  const atCap = items.length >= MAX_PACKAGE_ITEMS;
  const remainingSlots = Math.max(0, MAX_PACKAGE_ITEMS - items.length);

  /**
   * Every mutation path (add, remove, edit) funnels through this before
   * calling `onItemsChange`. Task 1's review flagged that an editor which
   * doesn't assign real `sortIndex` values on every change lets items
   * silently collapse to `sortIndex: 0` on save, with no error signal
   * (`packageItemSchema`'s `sortIndex` just defaults to 0 when omitted, and
   * it's in-range so nothing rejects it) — reindexing unconditionally here,
   * on every emitted array regardless of which field actually changed, means
   * that can't happen no matter which control triggered the update.
   */
  const emit = (next: PackageItemData[]) => {
    onItemsChange(next.map((item, index) => ({ ...item, sortIndex: index })));
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAddSelected = () => {
    // Order follows `assets` (the picker's own display order), not
    // `selectedIds` (selection-click order) — filtering `assets` by
    // membership in `selectedIds` is also what makes this pick the ASSET
    // THE USER ACTUALLY CHECKED, never `assets[0]` regardless of selection.
    // `.slice(0, remainingSlots)` is a last-line defensive clamp: the button
    // is already disabled at the cap, but a selection made just under the
    // cap that would tip it over on its own is still handled rather than
    // silently sent to a server that would reject the whole array.
    const toAdd = assets.filter((a) => selectedIds.includes(a.id)).slice(0, remainingSlots);
    if (toAdd.length === 0) return;

    // `crypto.randomUUID()` — same id-minting convention as every other
    // client-generated id in this codebase (DiceRollerPanel, useChatMessages,
    // useDiceRolls, AudioUploadDropzone). It is stable for the item's
    // lifetime and unique within the package: a package caps at
    // MAX_PACKAGE_ITEMS (64) items, so collision odds within one package are
    // not a practical concern. This id — not `assetId` — is what a mood's
    // `states[].itemId` references (Task 1/8), which is what lets the same
    // asset appear in a package multiple times with different settings.
    const newItems: PackageItemData[] = toAdd.map((asset) => ({
      id: crypto.randomUUID(),
      assetId: asset.id,
      // Snapshot the asset's title at add time: the picker only ever holds
      // one filtered/paged slice of the library, so an item's asset may
      // scroll out of `assets` later. `label` (PackageItemData's own
      // "override of the asset's own title" field) is what the row displays
      // from then on, independent of whether the asset is still loaded.
      label: asset.title,
      volume: DEFAULT_VOLUME,
      fadeSeconds: DEFAULT_FADE_SECONDS,
      loop: false,
      sortIndex: 0, // reassigned by emit() below
    }));
    emit([...items, ...newItems]);
    setSelectedIds([]);
  };

  const handleItemChange = (id: string, patch: Partial<PackageItemData>) => {
    emit(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleRemove = (id: string) => {
    emit(items.filter((item) => item.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 font-sans text-xs uppercase tracking-widest text-slate-400">
          Items ({items.length}/{MAX_PACKAGE_ITEMS})
        </h2>
        {sortedItems.length === 0 ? (
          <p className="px-1 py-4 text-sm text-slate-500">
            No items yet. Add sounds from the library below.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded border border-white/[0.06]">
            {sortedItems.map((item) => (
              <PackageItemRow
                key={item.id}
                item={item}
                readOnly={readOnly}
                onChange={(patch) => handleItemChange(item.id, patch)}
                onRemove={() => handleRemove(item.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {!readOnly && (
        <section>
          <h2 className="mb-3 font-sans text-xs uppercase tracking-widest text-slate-400">
            Add sounds
          </h2>
          <div className="rounded border border-white/[0.06]">
            <AudioLibraryBrowser
              assets={assets}
              loading={loading}
              filters={filters}
              onFiltersChange={onFiltersChange}
              selectable
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onLoadMore={onLoadMore}
              hasMore={hasMore}
              loadingMore={loadingMore}
              actionsSlot={
                <div className="flex items-center gap-3 border-b border-white/[0.06] px-3 py-2">
                  <span className="text-xs text-slate-500">{selectedIds.length} selected</span>
                  <button
                    type="button"
                    onClick={handleAddSelected}
                    disabled={selectedIds.length === 0 || atCap}
                    title={atCap ? `Package is full (${MAX_PACKAGE_ITEMS} items max)` : undefined}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600"
                  >
                    Add to package
                  </button>
                  {atCap && (
                    <span role="status" className="text-xs text-amber-400">
                      Package is full ({MAX_PACKAGE_ITEMS} items max) — remove an item to add
                      another.
                    </span>
                  )}
                </div>
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
