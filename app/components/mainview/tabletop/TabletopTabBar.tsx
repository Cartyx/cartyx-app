import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import { Settings, Plus, Pencil, Trash2, ArrowUpDown, Focus } from 'lucide-react';
import type { TabletopScreenData } from '~/types/tabletop';

export interface TabletopTabBarProps {
  screens: TabletopScreenData[];
  activeScreenId: string | null;
  onSelectScreen: (id: string) => void;
  onCreateScreen: () => void;
  onRenameScreen: (id: string) => void;
  onDeleteScreen: (id: string) => void;
  onFocusAll: () => void;
  isGM: boolean;
  badgeScreenIds: Set<string>;
}

export function TabletopTabBar({
  screens,
  activeScreenId,
  onSelectScreen,
  onCreateScreen,
  onRenameScreen,
  onDeleteScreen,
  onFocusAll,
  isGM,
  badgeScreenIds,
}: TabletopTabBarProps) {
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons || buttons.length === 0) return;

      const focused = e.target as HTMLElement;
      const currentIndex = Array.from(buttons).indexOf(focused as HTMLButtonElement);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = buttons.length - 1;
      } else {
        return;
      }

      const nextScreen = screens[nextIndex];
      if (nextScreen) {
        onSelectScreen(nextScreen.id);
        buttons[nextIndex]?.focus();
      }
    },
    [screens, onSelectScreen]
  );

  return (
    <div
      className="flex items-center h-10 bg-[#080A12] border-b border-white/[0.07]"
      data-testid="tabletop-tab-bar"
    >
      {/* Scrollable screen tabs */}
      <div
        className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none px-2"
        role="tablist"
        aria-label="Tabletop Screens"
        ref={tablistRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {screens.map((screen) => {
          const isActive = screen.id === activeScreenId;
          const hasBadge = badgeScreenIds.has(screen.id);
          return (
            <button
              key={screen.id}
              id={`tabletop-tab-${screen.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabletop-tabpanel-${screen.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectScreen(screen.id)}
              data-testid={`tabletop-tab-${screen.id}`}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 h-10 border-b-2 font-sans font-semibold text-xs transition-colors shrink-0 ${
                isActive
                  ? 'text-white border-[#2563EB]'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              {screen.name}
              {hasBadge && !isActive && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Settings dropdown trigger — GM only */}
      {isGM && (
        <TabletopSettingsDropdown
          screens={screens}
          activeScreenId={activeScreenId}
          onCreateScreen={onCreateScreen}
          onRenameScreen={onRenameScreen}
          onDeleteScreen={onDeleteScreen}
          onFocusAll={onFocusAll}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings dropdown
// ---------------------------------------------------------------------------

interface TabletopSettingsDropdownProps {
  screens: TabletopScreenData[];
  activeScreenId: string | null;
  onCreateScreen: () => void;
  onRenameScreen: (id: string) => void;
  onDeleteScreen: (id: string) => void;
  onFocusAll: () => void;
}

function TabletopSettingsDropdown({
  screens,
  activeScreenId,
  onCreateScreen,
  onRenameScreen,
  onDeleteScreen,
  onFocusAll,
}: TabletopSettingsDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(({ returnFocus = true }: { returnFocus?: boolean } = {}) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useCloseOnOutsideClick(dropdownRef, close, open);

  // Focus first menu item when menu opens
  useEffect(() => {
    if (!open) return;
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])'
    );
    firstItem?.focus();
  }, [open]);

  // Arrow-key navigation within the menu
  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])'
      );
      if (!items || items.length === 0) return;

      const focused = document.activeElement as HTMLElement;
      const currentIndex = Array.from(items).indexOf(focused as HTMLButtonElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[next]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === 'Tab') {
        close({ returnFocus: false });
      }
    },
    [close]
  );

  return (
    <div className="relative shrink-0 px-2" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Tab settings"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="tabletop-settings-trigger"
        className="flex items-center justify-center h-8 w-8 rounded text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-colors"
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          data-testid="tabletop-settings-menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-white/[0.07] bg-[#0D1117] shadow-xl shadow-black/50 py-1"
        >
          <DropdownItem
            icon={<Plus className="h-3.5 w-3.5" />}
            label="New Tab"
            onClick={() => {
              onCreateScreen();
              close();
            }}
          />
          {activeScreenId && (
            <>
              <DropdownItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="Rename Tab"
                onClick={() => {
                  onRenameScreen(activeScreenId);
                  close();
                }}
              />
              <DropdownItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Delete Tab"
                onClick={() => {
                  onDeleteScreen(activeScreenId);
                  close();
                }}
                disabled={screens.length <= 1}
                danger
              />
            </>
          )}
          {screens.length > 1 && (
            <>
              <div className="my-1 border-t border-white/[0.07]" />
              <DropdownItem
                icon={<ArrowUpDown className="h-3.5 w-3.5" />}
                label="Reorder Tabs"
                onClick={() => {
                  // Reorder is not yet implemented for tabletop
                  close();
                }}
              />
            </>
          )}
          <div className="my-1 border-t border-white/[0.07]" />
          <DropdownItem
            icon={<Focus className="h-3.5 w-3.5" />}
            label="Focus All"
            onClick={() => {
              onFocusAll();
              close();
            }}
            disabled={!activeScreenId}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown menu item
// ---------------------------------------------------------------------------

interface DropdownItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function DropdownItem({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 font-sans text-xs transition-colors ${
        disabled
          ? 'text-slate-600 cursor-not-allowed'
          : danger
            ? 'text-red-400 hover:bg-red-500/10'
            : 'text-slate-300 hover:bg-white/[0.05]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useCloseOnOutsideClick(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;

    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [ref, onClose, enabled]);
}
