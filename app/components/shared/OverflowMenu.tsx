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

  if (items.length === 0) return null;

  const focusItemAt = (index: number) => {
    const count = items.length;
    const next = ((index % count) + count) % count;
    itemRefs.current[next]?.focus();
  };

  const currentIndex = () => itemRefs.current.findIndex((el) => el === document.activeElement);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItemAt(currentIndex() + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = currentIndex();
      focusItemAt(i === -1 ? items.length - 1 : i - 1);
    }
  };

  return (
    <div className="relative">
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
        onKeyDown={open ? onMenuKeyDown : undefined}
        className="flex h-7 w-7 items-center justify-center rounded bg-white/[0.03] text-slate-400 opacity-0 transition-opacity hover:bg-white/[0.07] hover:text-slate-200 focus-visible:opacity-100 group-hover:opacity-100"
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
