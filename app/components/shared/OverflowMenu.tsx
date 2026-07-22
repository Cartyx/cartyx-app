import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';

export interface MenuItem {
  /** Stable identity for React keys and tests. */
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip — used to explain why a disabled item is disabled. */
  title?: string;
}

interface OverflowMenuProps {
  items: MenuItem[];
  /** aria-label for the trigger, e.g. "Character actions". */
  label: string;
}

/**
 * Presentational overflow (⋮) menu. Knows nothing about the wiki or campaigns —
 * callers pass fully-resolved items.
 *
 * Owns the keyboard/focus contract the hand-rolled MapCard menu never had:
 * Escape closes, focus returns to the trigger, and Arrow keys rove.
 */
export function OverflowMenu({ items, label }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Escape closes from anywhere within the menu and returns focus to the trigger,
  // so keyboard users are never stranded inside a closed popup.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // WAI-ARIA menu-button pattern: opening the menu moves focus straight to the
  // first enabled item, so keyboard/touch users don't need an extra ArrowDown
  // press just to get into the menu. Only fires on the closed→open transition
  // (guarded by wasOpenRef) so it doesn't fight the user's own roving once open.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const firstEnabled = items.findIndex((item) => !item.disabled);
      if (firstEnabled !== -1) itemRefs.current[firstEnabled]?.focus();
    }
    wasOpenRef.current = open;
  }, [open, items]);

  if (items.length === 0) return null;

  // Browsers no-op .focus() on a disabled <button>, so a naive wrap-around
  // index walk can get stuck (or land back where it started) whenever a
  // disabled item sits between the current item and the next enabled one.
  // Walk in the direction of travel, skipping disabled items, and bail out
  // once every item has been checked so an all-disabled menu can't loop forever.
  const focusItemAt = (index: number, direction: 1 | -1 = 1) => {
    const count = items.length;
    for (let steps = 0; steps < count; steps++) {
      const next = (((index + steps * direction) % count) + count) % count;
      if (!items[next].disabled) {
        itemRefs.current[next]?.focus();
        return;
      }
    }
  };

  const currentIndex = () => itemRefs.current.findIndex((el) => el === document.activeElement);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItemAt(currentIndex() + 1, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = currentIndex();
      focusItemAt(i === -1 ? items.length - 1 : i - 1, -1);
    }
  };

  // Closes the menu when focus leaves it entirely (Tab-away, or focus jumping
  // to some unrelated part of the page) but NOT when focus merely moves between
  // items inside the menu (arrow roving, or the auto-focus-on-open above) — the
  // new focus target is checked against this container on every focusout.
  const onContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!open) return;
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) {
      close(false);
    }
  };

  return (
    <div className="relative" onBlur={onContainerBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        // Focus sits on the trigger after a click, and the role="menu" div below
        // is a SIBLING, not an ancestor, so keydowns from the trigger never bubble
        // through it — the trigger needs its own copy of the handler while open.
        onKeyDown={open ? onMenuKeyDown : undefined}
        // Hover reveals the trigger for mouse users (unchanged desktop look).
        // Touch devices have no hover, so `[@media(hover:none)]` keeps it always
        // visible there; `focus:` (not just `focus-visible:`) covers the plain
        // `:focus` a tap produces, so a keyboard OR touch user can always find it.
        className="flex h-7 w-7 items-center justify-center rounded bg-white/[0.03] text-slate-400 opacity-0 transition-opacity hover:bg-white/[0.07] hover:text-slate-200 focus:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          {/* Click-catcher: closes without stealing focus back to the trigger. */}
          <div className="fixed inset-0 z-10" onClick={() => close(false)} aria-hidden />
          <div
            role="menu"
            aria-label={label}
            // jsx-a11y/interactive-supports-focus requires a role="menu" element to be
            // focusable; roving focus actually lives on the menuitem buttons, so this
            // keeps the container itself out of the normal Tab order (-1) while satisfying
            // the lint rule.
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded border border-white/[0.07] bg-[#080A12] shadow-lg"
          >
            {items.map((item, i) => (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                data-testid={`overflow-item-${item.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled) return;
                  close(false);
                  item.onSelect();
                }}
                className={[
                  'flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-xs transition-colors hover:bg-white/[0.05]',
                  item.danger ? 'text-rose-300 hover:text-rose-200' : 'text-slate-300',
                  item.disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : '',
                ].join(' ')}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
