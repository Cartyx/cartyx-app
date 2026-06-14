import type { ReactNode } from 'react';
import {
  FloatingWindow,
  type FloatingWindowPosition,
  type FloatingWindowSize,
  type FloatingWindowState,
} from './FloatingWindow';
import { FloatingWindowTray } from './FloatingWindowTray';

export interface ManagedWindow {
  id: string;
  title: string;
  content: ReactNode;
  /** Opaque key that changes when content changes — used by staleness checks */
  contentKey?: string;
  /** Opaque key that changes when title bar icons change — used by staleness checks */
  iconKey?: string;
  titleIcon?: ReactNode;
  titleSuffix?: ReactNode;
  position?: FloatingWindowPosition;
  size?: FloatingWindowSize;
  state: FloatingWindowState;
  zIndex: number;
  className?: string;
}

export interface FloatingWindowManagerProps {
  windows: ManagedWindow[];
  onWindowsChange: (windows: ManagedWindow[]) => void;
  className?: string;
}

function getHighestZIndex(windows: ManagedWindow[]) {
  return windows.reduce((max, window) => Math.max(max, window.zIndex), 0);
}

export function FloatingWindowManager({
  windows,
  onWindowsChange,
  className = '',
}: FloatingWindowManagerProps) {
  const activeWindows = windows.filter((window) => window.state !== 'minimized');
  const minimizedWindows = windows.filter((window) => window.state === 'minimized');

  const handleFocus = (id: string) => {
    const highestZIndex = getHighestZIndex(windows);
    const focused = windows.find((w) => w.id === id);

    // Short-circuit if already at the top
    if (focused?.zIndex === highestZIndex) return;

    // Normalize all z-indexes to keep values small (re-rank from 1)
    const sorted = [...windows].sort((a, b) => a.zIndex - b.zIndex);
    const normalized = sorted.map((w, i) => ({ ...w, zIndex: i + 1 }));
    const focusedRank = normalized.length; // highest rank = top

    onWindowsChange(normalized.map((w) => (w.id === id ? { ...w, zIndex: focusedRank } : w)));
  };

  const handleClose = (id: string) => {
    onWindowsChange(windows.filter((window) => window.id !== id));
  };

  const handleStateChange = (id: string, state: FloatingWindowState) => {
    const highestZIndex = getHighestZIndex(windows);

    onWindowsChange(
      windows.map((window) => {
        if (window.id !== id) {
          return window;
        }

        return {
          ...window,
          state,
          zIndex: state === 'normal' ? highestZIndex + 1 : window.zIndex,
        };
      })
    );
  };

  const handleLayoutChange = (
    id: string,
    layout: { position: FloatingWindowPosition; size: FloatingWindowSize }
  ) => {
    onWindowsChange(
      windows.map((w) => (w.id === id ? { ...w, position: layout.position, size: layout.size } : w))
    );
  };

  const handleRestore = (id: string) => {
    handleStateChange(id, 'normal');
  };

  return (
    // pointer-events:none on the wrapper so empty space between windows
    // doesn't intercept clicks/scrolls aimed at content below (e.g. the
    // active map). Each FloatingWindow re-enables pointer events on its
    // own bounds.
    <div className={`pointer-events-none relative h-full w-full overflow-hidden ${className}`}>
      {activeWindows.map((window) => (
        <FloatingWindow
          key={window.id}
          id={window.id}
          title={window.title}
          className={window.className}
          initialPosition={window.position}
          initialSize={window.size}
          initialState={window.state}
          zIndex={window.zIndex}
          titleIcon={window.titleIcon}
          titleSuffix={window.titleSuffix}
          onFocus={() => handleFocus(window.id)}
          onClose={() => handleClose(window.id)}
          onStateChange={(state) => handleStateChange(window.id, state)}
          onLayoutChange={(layout) => handleLayoutChange(window.id, layout)}
        >
          {window.content}
        </FloatingWindow>
      ))}

      <FloatingWindowTray
        windows={minimizedWindows.map((window) => ({ id: window.id, title: window.title }))}
        onRestore={handleRestore}
      />
    </div>
  );
}
