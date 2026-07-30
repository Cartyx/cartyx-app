import { Copy, Lock, Pencil, Trash2 } from 'lucide-react';
import { OverflowMenu, type MenuItem } from '~/components/shared/OverflowMenu';
import type { AudioPackageData } from '~/types/soundboard';

export interface PackageListProps {
  /**
   * Packages the caller may see — the caller's own plus every system
   * package, per `listPackages`'s visibility rule (owner or `ownerId ===
   * null`). Because that filter already excludes every OTHER user's
   * packages, `ownerId === null` is sufficient on its own to tell a system
   * row from an owned one: no separate "current user id" is needed (and
   * comparing against one would risk the identity-resolution class of bug
   * `~/utils/audio-server-fns.ts`'s `requireActor` exists to prevent — the
   * client-side `getMe()` user id is the OAuth provider id, not the Mongo
   * `_id` that `ownerId` stores).
   */
  packages: AudioPackageData[];
  /** Owned rows only — system packages are read-only, so no Edit affordance is ever offered for them. */
  onEdit?: (pkg: AudioPackageData) => void;
  /** Every row may be cloned — the only affordance a system row offers. */
  onClone?: (pkg: AudioPackageData) => void;
  /** Owned rows only. */
  onDelete?: (pkg: AudioPackageData) => void;
  /** id of the package currently being cloned, so a slow clone can't be double-fired. */
  cloningId?: string | null;
}

/**
 * Lists the caller's own packages and every system package, visually
 * distinguished by a "System" badge. System packages are read-only by
 * design (Task 4 scopes every package write to `{ _id, ownerId: userId }`,
 * which can never match a `null` owner) — their row offers Clone, never
 * Edit or Delete, so the UI never presents an action that is guaranteed to
 * fail server-side.
 *
 * Purely presentational, like `AudioAssetRow`: no fetching, no mutations.
 * `listPackages` is unpaginated and returns full `items[]`/`moods[]` per
 * package (a known deferred issue — see the plan) — this component only
 * ever reads `.length` off those arrays for the row summary, never renders
 * their contents, so a package with many items doesn't produce a heavy
 * per-row DOM even before pagination lands.
 */
export function PackageList({ packages, onEdit, onClone, onDelete, cloningId }: PackageListProps) {
  if (packages.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500">
        No sound packages yet. Packages you create will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06]">
      {packages.map((pkg) => {
        const isSystem = pkg.ownerId === null;
        const isCloning = cloningId === pkg.id;

        const items: MenuItem[] = isSystem
          ? [
              {
                key: 'clone',
                label: 'Clone',
                icon: <Copy className="h-3.5 w-3.5" />,
                onSelect: () => onClone?.(pkg),
                disabled: isCloning,
                title: isCloning ? 'Cloning…' : undefined,
              },
            ]
          : [
              {
                key: 'edit',
                label: 'Edit',
                icon: <Pencil className="h-3.5 w-3.5" />,
                onSelect: () => onEdit?.(pkg),
              },
              {
                key: 'delete',
                label: 'Delete',
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                onSelect: () => onDelete?.(pkg),
              },
            ];

        return (
          <li
            key={pkg.id}
            data-testid="package-row"
            data-package-id={pkg.id}
            className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-200">{pkg.name}</span>
                {isSystem && (
                  <span
                    data-testid="system-badge"
                    className="flex shrink-0 items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400"
                  >
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                    System
                  </span>
                )}
              </div>
              {pkg.description && (
                <p className="mt-0.5 truncate text-xs text-slate-500">{pkg.description}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {pkg.items.length} {pkg.items.length === 1 ? 'item' : 'items'} · {pkg.moods.length}{' '}
                {pkg.moods.length === 1 ? 'mood' : 'moods'}
              </p>
            </div>

            <OverflowMenu items={items} label={`${pkg.name} actions`} />
          </li>
        );
      })}
    </ul>
  );
}
