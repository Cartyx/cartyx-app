export interface FloatingWindowTrayItem {
  id: string;
  title: string;
}

export interface FloatingWindowTrayProps {
  windows: FloatingWindowTrayItem[];
  onRestore: (id: string) => void;
}

export function FloatingWindowTray({ windows, onRestore }: FloatingWindowTrayProps) {
  if (windows.length === 0) {
    return null;
  }

  return (
    // pointer-events-auto opts back in to clicks: FloatingWindowManager sets
    // pointer-events-none on its wrapper so empty space passes through to
    // content below, which would otherwise make these buttons unclickable.
    <div
      className="pointer-events-auto absolute bottom-4 left-4 z-30 flex flex-row gap-2"
      role="toolbar"
      aria-label="Minimized windows"
    >
      {windows.map((window) => (
        <button
          key={window.id}
          type="button"
          onClick={() => onRestore(window.id)}
          aria-label={`Restore ${window.title}`}
          className="rounded border border-white/[0.07] bg-[#1a1d2e] px-3 py-1.5 font-sans font-semibold text-xs text-slate-300 transition-colors hover:bg-white/[0.05]"
        >
          {window.title}
        </button>
      ))}
    </div>
  );
}
