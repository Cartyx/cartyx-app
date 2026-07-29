import React from 'react';
import type { ReactNode } from 'react';
import { AudioFilterBar } from './AudioFilterBar';
import type { AudioFilters } from './AudioFilterBar';
import { AudioAssetRow } from './AudioAssetRow';
import type { AudioAssetData } from '~/types/audio';

/** Props for the AudioLibraryBrowser component. */
export interface AudioLibraryBrowserProps {
  /** Assets to render, already filtered server-side — this component renders exactly what it is given. */
  assets: AudioAssetData[];
  /** When true, shows a loading state instead of rows or the empty message. */
  loading?: boolean;
  /** Current filter values, passed straight through to `AudioFilterBar`. */
  filters: AudioFilters;
  /** Called whenever the filter bar emits a change. This component never filters `assets` itself. */
  onFiltersChange: (next: AudioFilters) => void;
  /** When true, renders a selection checkbox on each row. */
  selectable?: boolean;
  /** Ids of currently selected assets. */
  selectedIds?: string[];
  /** Called with an asset id when its row checkbox is toggled. */
  onToggleSelect?: (id: string) => void;
  /** Called with the full asset when a row's play button is clicked. */
  onPlay?: (asset: AudioAssetData) => void;
  /** Called with the full asset when a row's edit button is clicked. */
  onEdit?: (asset: AudioAssetData) => void;
  /**
   * Rendered above the list, below the filter bar. A bulk-action bar when
   * managing a library, an "Add to scene" button when mounted as a picker
   * (phase 2) — this component has no opinion on which.
   */
  actionsSlot?: ReactNode;
  /** Message shown when `assets` is empty and not loading. */
  emptyMessage?: string;
}

/**
 * Composes `AudioFilterBar` + a list of `AudioAssetRow`s. Deliberately has
 * no idea whether it's rendering a management view or an in-campaign asset
 * picker — that distinction lives entirely in which props the caller passes
 * (`selectable`, `onToggleSelect`, `actionsSlot`), not in a mode/variant
 * prop. It owns no fetching and no mutations: `assets`/`filters` are owned
 * by the caller (Task 19), and this component never filters, sorts, or
 * otherwise second-guesses the `assets` array it's handed — filtering is
 * server-side.
 */
export function AudioLibraryBrowser({
  assets,
  loading = false,
  filters,
  onFiltersChange,
  selectable = false,
  selectedIds = [],
  onToggleSelect,
  onPlay,
  onEdit,
  actionsSlot,
  emptyMessage = 'No audio matches these filters.',
}: AudioLibraryBrowserProps) {
  return (
    <section className="flex flex-col">
      <AudioFilterBar value={filters} onChange={onFiltersChange} />

      {actionsSlot}

      {loading ? (
        <p className="p-4 text-sm text-slate-400">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="p-4 text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        // No `divide-y` here: AudioAssetRow already draws its own
        // `border-b` per row. Adding divide-y on top would double the
        // divider between every pair of rows (divide-y's border-top
        // stacking with the row's own border-b).
        <ul>
          {assets.map((asset) => (
            <AudioAssetRow
              key={asset.id}
              asset={asset}
              selectable={selectable}
              selected={selectedIds.includes(asset.id)}
              onToggleSelect={onToggleSelect}
              onPlay={onPlay}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
