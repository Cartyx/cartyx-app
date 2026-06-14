import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ChevronDown, Maximize2, Minimize2, X } from 'lucide-react';

export interface FloatingWindowPosition {
  x: number;
  y: number;
}

export interface FloatingWindowSize {
  width: number;
  height: number;
}

export type FloatingWindowState = 'normal' | 'minimized' | 'maximized';

export interface FloatingWindowProps {
  id: string;
  title: string;
  children: ReactNode;
  initialPosition?: FloatingWindowPosition;
  initialSize?: FloatingWindowSize;
  initialState?: FloatingWindowState;
  zIndex?: number;
  onClose?: () => void;
  onFocus?: () => void;
  onStateChange?: (state: FloatingWindowState) => void;
  onLayoutChange?: (layout: { position: FloatingWindowPosition; size: FloatingWindowSize }) => void;
  className?: string;
  titleIcon?: ReactNode;
  titleSuffix?: ReactNode;
}

const DEFAULT_POSITION: FloatingWindowPosition = { x: 100, y: 100 };
const DEFAULT_SIZE: FloatingWindowSize = { width: 400, height: 300 };
const TITLE_BAR_HEIGHT = 36;
const MIN_VISIBLE_TITLE_WIDTH = 50;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

interface DragState {
  offsetX: number;
  offsetY: number;
}

interface ResizeState {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

function clampPosition(
  nextPosition: FloatingWindowPosition,
  size: FloatingWindowSize,
  parent: HTMLElement | null
): FloatingWindowPosition {
  if (!parent) {
    return nextPosition;
  }

  const maxX = parent.clientWidth - MIN_VISIBLE_TITLE_WIDTH;
  const minX = MIN_VISIBLE_TITLE_WIDTH - size.width;
  const minY = 0;
  const maxY = parent.clientHeight - TITLE_BAR_HEIGHT;

  return {
    x: Math.min(Math.max(nextPosition.x, minX), maxX),
    y: Math.min(Math.max(nextPosition.y, minY), maxY),
  };
}

export function FloatingWindow({
  id,
  title,
  children,
  initialPosition = DEFAULT_POSITION,
  initialSize = DEFAULT_SIZE,
  initialState = 'normal',
  zIndex = 1,
  onClose,
  onFocus,
  onStateChange,
  onLayoutChange,
  className = '',
  titleIcon,
  titleSuffix,
}: FloatingWindowProps) {
  const [position, setPosition] = useState<FloatingWindowPosition>(initialPosition);
  const [size, setSize] = useState<FloatingWindowSize>(initialSize);
  const [windowState, setWindowState] = useState<FloatingWindowState>(initialState);
  const [isFocused, setIsFocused] = useState(false);

  const windowRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const positionRef = useRef<FloatingWindowPosition>(initialPosition);
  const sizeRef = useRef<FloatingWindowSize>(initialSize);
  // Stash normal-mode geometry so maximize→restore round-trips cleanly
  const preMaxRef = useRef<{ position: FloatingWindowPosition; size: FloatingWindowSize } | null>(
    null
  );
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;
  const titleId = useId();

  useEffect(() => {
    setWindowState(initialState);
  }, [initialState]);

  useEffect(() => {
    return () => {
      cleanupListenersRef.current?.();
    };
  }, []);

  // Move DOM focus to the window only — does not trigger any React state
  // update in the parent. Safe to call synchronously during mousedown.
  const focusWindowDom = useCallback(() => {
    const element = windowRef.current;
    if (element && document.activeElement !== element) {
      element.focus();
    }
  }, []);

  // Full focus: DOM focus + propagate onFocus so the parent re-orders z-index.
  // Use this for explicit gestures (title-bar drag, resize) where no child
  // click handler is at risk of being raced. Avoid in plain `onMouseDown` on
  // the window body — see handleWindowMouseDown / handleWindowClick below.
  const focusWindow = useCallback(() => {
    focusWindowDom();
    onFocus?.();
  }, [focusWindowDom, onFocus]);

  const setState = useCallback(
    (nextState: FloatingWindowState) => {
      setWindowState(nextState);
      onStateChange?.(nextState);
    },
    [onStateChange]
  );

  const handleMinimize = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      setState('minimized');
    },
    [setState]
  );

  const handleMaximizeToggle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (windowState === 'maximized') {
        // Restore pre-maximize geometry
        if (preMaxRef.current) {
          const { position: p, size: s } = preMaxRef.current;
          positionRef.current = p;
          sizeRef.current = s;
          setPosition(p);
          setSize(s);
          preMaxRef.current = null;
        }
        setState('normal');
      } else {
        // Save current geometry before maximizing
        preMaxRef.current = { position: positionRef.current, size: sizeRef.current };
        setState('maximized');
      }
    },
    [setState, windowState]
  );

  const handleClose = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onClose?.();
    },
    [onClose]
  );

  // Window body: defer BOTH focus side-effects to the click event so any
  // descendant onClick handlers run on the original render tree. Triggering
  // either element.focus() (shifts DOM focus away from a clicked child mid-
  // click) or onFocus() (parent state update → re-render between mousedown
  // and click) during mousedown can swallow setState calls inside window
  // content — e.g. clicking Gallery on a freshly-opened LocationWindow would
  // highlight the tab without flipping `activeTab`. Mousedown-driven focus is
  // still preserved for the title-bar drag handle and the resize handle.
  const handleWindowClick = useCallback(() => {
    focusWindow();
  }, [focusWindow]);

  // Title-bar drag and resize gestures still need synchronous focus on
  // mousedown — those don't have child click handlers to race with.
  const handleWindowMouseDown = useCallback(() => {
    focusWindow();
  }, [focusWindow]);

  const handleDocumentMouseMove = useCallback((event: MouseEvent) => {
    const element = windowRef.current;
    const parent = element?.parentElement ?? null;

    if (dragStateRef.current && element) {
      const nextPosition = clampPosition(
        {
          x: event.clientX - dragStateRef.current.offsetX,
          y: event.clientY - dragStateRef.current.offsetY,
        },
        sizeRef.current,
        parent
      );
      positionRef.current = nextPosition;
      setPosition(nextPosition);
      return;
    }

    if (resizeStateRef.current && element) {
      const nextSize = {
        width: Math.max(
          MIN_WIDTH,
          resizeStateRef.current.startWidth + (event.clientX - resizeStateRef.current.startX)
        ),
        height: Math.max(
          MIN_HEIGHT,
          resizeStateRef.current.startHeight + (event.clientY - resizeStateRef.current.startY)
        ),
      };
      sizeRef.current = nextSize;
      const nextPosition = clampPosition(positionRef.current, nextSize, parent);
      positionRef.current = nextPosition;
      setSize(nextSize);
      setPosition(nextPosition);
    }
  }, []); // stable — reads from refs, not state

  const handleDocumentMouseUp = useCallback(() => {
    dragStateRef.current = null;
    resizeStateRef.current = null;
  }, []);

  // Only attach document-level listeners while actively dragging/resizing
  const handlePointerCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, mode: 'drag' | 'resize') => {
      if (mode === 'drag') {
        dragStateRef.current = {
          offsetX: event.clientX - positionRef.current.x,
          offsetY: event.clientY - positionRef.current.y,
        };
      } else {
        resizeStateRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          startWidth: sizeRef.current.width,
          startHeight: sizeRef.current.height,
        };
      }

      const onMove = handleDocumentMouseMove;
      const onUp = () => {
        handleDocumentMouseUp();
        cleanup();
        onLayoutChangeRef.current?.({ position: positionRef.current, size: sizeRef.current });
      };
      const cleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        cleanupListenersRef.current = null;
      };
      cleanupListenersRef.current = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [handleDocumentMouseMove, handleDocumentMouseUp]
  );

  const handleTitleBarMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (windowState === 'maximized') {
        handleWindowMouseDown();
        return;
      }

      handleWindowMouseDown();
      handlePointerCapture(event, 'drag');
    },
    [handleWindowMouseDown, windowState, handlePointerCapture]
  );

  const handleResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (windowState === 'maximized') {
        return;
      }

      handleWindowMouseDown();
      handlePointerCapture(event, 'resize');
    },
    [handleWindowMouseDown, windowState, handlePointerCapture]
  );

  if (windowState === 'minimized') {
    return null;
  }

  const isMaximized = windowState === 'maximized';
  const maximizeLabel = isMaximized ? `Restore ${title}` : `Maximize ${title}`;
  const maximizeIcon = isMaximized ? (
    <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
  ) : (
    <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- onClick brings the floating window to front (z-order). See handleWindowClick for why this is on click instead of mousedown. There is no keyboard equivalent for z-ordering itself; keyboard users still reach all controls inside via Tab (tabIndex={-1} on the dialog).
    <div
      ref={windowRef}
      role="dialog"
      aria-labelledby={titleId}
      data-window-id={id}
      tabIndex={-1}
      onClick={handleWindowClick}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocused(false);
        }
      }}
      className={[
        // pointer-events-auto re-enables interaction inside the window,
        // since FloatingWindowManager sets pointer-events:none on its
        // wrapper to let underlying content (active map) receive events
        // in the gaps between windows.
        'pointer-events-auto rounded-lg border border-white/[0.07] bg-[#0D1117] overflow-hidden shadow-2xl shadow-black/60 outline-none',
        isMaximized ? 'absolute inset-0' : 'absolute left-0 top-0',
        className,
      ].join(' ')}
      style={
        isMaximized
          ? { zIndex }
          : {
              zIndex,
              width: size.width,
              height: size.height,
              transform: `translate(${position.x}px, ${position.y}px)`,
            }
      }
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- onMouseDown is for drag-to-move only; keyboard users use the minimize/maximize/close buttons */}
      <div
        className={[
          'flex h-9 cursor-move items-center justify-between gap-3 border-b border-white/[0.07] px-3',
          isFocused ? 'bg-[#242942]' : 'bg-[#1a1d2e]',
          isMaximized ? 'cursor-default' : '',
        ].join(' ')}
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className="flex items-center gap-1.5 min-w-0 font-sans font-semibold text-xs text-slate-300">
          {titleIcon && <span className="shrink-0 flex items-center">{titleIcon}</span>}
          <span id={titleId} className="truncate">
            {title}
          </span>
          {titleSuffix && <span className="shrink-0 flex items-center">{titleSuffix}</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={`Minimize ${title}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleMinimize}
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-yellow-500/20 text-yellow-400 transition-colors hover:bg-yellow-500/40"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={maximizeLabel}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleMaximizeToggle}
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-green-500/20 text-green-400 transition-colors hover:bg-green-500/40"
          >
            {maximizeIcon}
          </button>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleClose}
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-red-500/20 text-red-400 transition-colors hover:bg-red-500/40"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-36px)] overflow-auto">{children}</div>

      {!isMaximized ? (
        <div
          aria-hidden="true"
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize bg-[linear-gradient(135deg,transparent_0%,transparent_45%,rgba(148,163,184,0.4)_45%,rgba(148,163,184,0.4)_55%,transparent_55%,transparent_100%)]"
        />
      ) : null}
    </div>
  );
}
