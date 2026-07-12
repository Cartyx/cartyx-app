import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { GripVertical, X } from 'lucide-react';

export interface ToolWindowProps {
  /** ToolWindowId — drives data-testids (`tool-window-<id>`). */
  id: string;
  title: string;
  icon: React.ElementType;
  /** Workspace-px position (managed by useToolWindows). */
  position: { x: number; y: number };
  zIndex: number;
  /** false until the manager has measured + placed the window. */
  placed: boolean;
  onClose: () => void;
  onFocus: () => void;
  onHeaderPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  rootRef: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}

/**
 * Shared chrome for every toolbar tool window (Draw, Text, Measurement, Dice
 * Roller, Layers): "::" grip + icon + title header (drag handle) and a close X.
 * Auto-sizes to its content; position/z-order come from useToolWindows. Pointer
 * events never reach the map stage underneath.
 */
export function ToolWindow({
  id,
  title,
  icon: Icon,
  position,
  zIndex,
  placed,
  onClose,
  onFocus,
  onHeaderPointerDown,
  rootRef,
  children,
}: ToolWindowProps) {
  return (
    <div
      ref={rootRef}
      onPointerDown={(e) => {
        e.stopPropagation();
        onFocus();
      }}
      className="absolute w-max overflow-hidden rounded-lg border border-white/10 bg-[#0D1117]/95 shadow-2xl backdrop-blur-sm"
      style={{
        left: position.x,
        top: position.y,
        zIndex,
        visibility: placed ? 'visible' : 'hidden',
      }}
      data-testid={`tool-window-${id}`}
      role="dialog"
      aria-label={`${title} window`}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex cursor-move items-center gap-1.5 border-b border-white/[0.07] px-3 py-2"
        data-testid={`tool-window-${id}-header`}
      >
        <GripVertical className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-slate-300">
          {title}
        </h2>
        <button
          type="button"
          aria-label={`Close ${title.toLowerCase()} window`}
          data-testid={`tool-window-${id}-close`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}
