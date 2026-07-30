/**
 * Shared styling/behaviour for the audio library's multi-select facet chips
 * (environment, mood). Originally duplicated in `AudioFilterBar` and
 * `AudioBulkTagBar`; extracted here once `AudioAssetDetail` (Task 21) became
 * a third consumer needing the same idiom. Kept small and local to
 * `app/components/audio/` — this is not meant to grow into a general design
 * system.
 */

/** Visual classes for a toggleable chip button. `size` defaults to `'sm'` to match `AudioFilterBar`'s original default; callers with the denser layout (`AudioBulkTagBar`, `AudioAssetDetail`) pass `'xs'` explicitly. */
export function chipClass(active: boolean, size: 'sm' | 'xs' = 'sm'): string {
  const padding = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[11px]';
  return [
    'rounded transition-colors',
    padding,
    active
      ? 'bg-blue-600 text-white'
      : 'bg-white/[0.06] text-slate-400 hover:bg-white/[0.1] hover:text-slate-200',
  ].join(' ');
}

/** Adds `item` to `list` if absent, removes it if present. */
export function toggleInArray<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}
