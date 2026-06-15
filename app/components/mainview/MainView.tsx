import React, { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ToolBar } from './ToolBar';
import type { ToolType } from './ToolBar';
import { InspectorSidebar } from './InspectorSidebar';
import { ChevronLeft } from 'lucide-react';

const LG_QUERY = '(min-width: 1024px)';

interface MainViewProps {
  showToolbar?: boolean;
  showInspector?: boolean;
  children: ReactNode;
  className?: string;
  campaignId?: string;
  sessions?: Array<{ id: string; name: string; number: number; status: string }>;
  /** Controlled active tool. When omitted, MainView manages it internally. */
  activeTool?: ToolType;
  onToolChange?: (tool: ToolType) => void;
  /** Whether the viewer is a GM (gates GM-only toolbar tools). */
  isGM?: boolean;
}

export function MainView({
  showToolbar = false,
  showInspector = true,
  children,
  className = '',
  campaignId,
  sessions,
  activeTool: controlledTool,
  onToolChange,
  isGM = false,
}: MainViewProps) {
  // Tool state is controlled only when BOTH props are supplied. If `activeTool`
  // were treated as controlled without `onToolChange`, clicks would update
  // internal state the render never reads, freezing the toolbar — so require
  // both, otherwise fall back to fully-internal state.
  const [internalTool, setInternalTool] = useState<ToolType>('pointer');
  const isControlled = controlledTool !== undefined && onToolChange !== undefined;
  const activeTool = isControlled ? controlledTool : internalTool;
  const setActiveTool = isControlled ? onToolChange : setInternalTool;
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const drawerRef = useRef<HTMLDivElement>(null);

  const drawerOpen = showInspector && mobileInspectorOpen;
  const desktopInspectorToggleLabel = inspectorVisible ? 'Close inspector' : 'Open inspector';
  const mobileInspectorToggleLabel = mobileInspectorOpen ? 'Close inspector' : 'Open inspector';
  const desktopInspectorToggleIconClass = `inline-flex transition-transform duration-200 ${inspectorVisible ? 'rotate-180' : 'rotate-0'}`;
  const mobileInspectorToggleIconClass = `inline-flex transition-transform duration-200 ${mobileInspectorOpen ? 'rotate-180' : 'rotate-0'}`;

  // Focus the drawer and attach Escape-to-close while open
  useEffect(() => {
    if (!drawerOpen) return;

    drawerRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileInspectorOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  // Reset mobile drawer when viewport grows to lg+
  useEffect(() => {
    const mq = window.matchMedia(LG_QUERY);
    const handler = () => {
      if (mq.matches) setMobileInspectorOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className={`flex h-full bg-[#080A12] overflow-hidden ${className}`}>
      {/* Left column — Toolbar */}
      <div
        data-testid="mainview-toolbar"
        className={`flex-shrink-0 overflow-hidden transition-all duration-200 ${
          showToolbar ? `${toolbarCollapsed ? 'w-8' : 'w-14'} border-r border-white/[0.07]` : 'w-0'
        }`}
      >
        {showToolbar && (
          <div className={toolbarCollapsed ? 'w-8 h-full' : 'w-14 h-full'}>
            <ToolBar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              collapsed={toolbarCollapsed}
              onToggleCollapse={() => setToolbarCollapsed((c) => !c)}
              isGM={isGM}
            />
          </div>
        )}
      </div>

      {/* Center column — Content */}
      <div className="flex-1 min-w-0 bg-[#0D1117] overflow-auto">{children}</div>

      {/* Inspector — single instance */}
      {showInspector && (
        <>
          {/* Mobile backdrop — tapping outside closes the drawer */}
          {drawerOpen && (
            <div
              aria-hidden="true"
              data-testid="mobile-inspector-backdrop"
              className="lg:hidden fixed inset-0 z-40 bg-black/50 cursor-default"
              onClick={() => setMobileInspectorOpen(false)}
            />
          )}

          {/* Inspector shell — inline panel on lg+, fixed drawer on mobile */}
          <div
            ref={drawerRef}
            id="mainview-inspector"
            data-testid="inspector-shell"
            role={drawerOpen ? 'dialog' : undefined}
            aria-modal={drawerOpen || undefined}
            aria-label={drawerOpen ? 'Inspector' : undefined}
            tabIndex={drawerOpen ? -1 : undefined}
            className={[
              'flex-shrink-0',
              drawerOpen ? 'fixed inset-y-0 right-0 z-50 flex w-80' : 'relative w-0',
              'lg:relative lg:flex lg:inset-auto lg:z-auto lg:transition-[width] lg:duration-200',
              inspectorVisible ? 'lg:w-80' : 'lg:w-0',
            ].join(' ')}
          >
            {/* Mobile toggle — positioned on left edge of inspector shell, visible below lg */}
            <button
              type="button"
              aria-label={mobileInspectorToggleLabel}
              aria-expanded={mobileInspectorOpen}
              aria-controls="mainview-inspector"
              data-testid="mobile-inspector-toggle"
              onClick={() => setMobileInspectorOpen((o) => !o)}
              title={mobileInspectorToggleLabel}
              className="absolute left-0 top-1/2 z-[60] flex h-12 w-6 -translate-x-full -translate-y-1/2 items-center justify-center rounded-l border border-r-0 border-white/[0.07] bg-[#0D1117] text-slate-400 transition-colors hover:text-slate-200 lg:hidden"
            >
              <span
                data-testid="mobile-inspector-toggle-icon"
                className={mobileInspectorToggleIconClass}
              >
                <ChevronLeft size={14} />
              </span>
            </button>

            {/* Desktop toggle — positioned on left edge of shell */}
            <button
              type="button"
              aria-label={desktopInspectorToggleLabel}
              aria-expanded={inspectorVisible}
              aria-controls="mainview-inspector"
              data-testid="desktop-inspector-toggle"
              onClick={() => setInspectorVisible((v) => !v)}
              title={desktopInspectorToggleLabel}
              className="absolute left-0 top-1/2 z-10 hidden h-12 w-6 -translate-x-full -translate-y-1/2 items-center justify-center rounded-l border border-r-0 border-white/[0.07] bg-[#0D1117] text-slate-400 transition-colors hover:text-slate-200 lg:flex"
            >
              <span
                data-testid="desktop-inspector-toggle-icon"
                className={desktopInspectorToggleIconClass}
              >
                <ChevronLeft size={14} />
              </span>
            </button>

            {/* Inspector content */}
            <div
              data-testid="inspector-content"
              className={[
                'h-full w-80 overflow-hidden bg-[#0D1117]',
                drawerOpen ? 'flex border-l border-white/[0.07]' : 'hidden',
                inspectorVisible ? 'lg:flex lg:border-l lg:border-white/[0.07]' : 'lg:hidden',
              ].join(' ')}
            >
              <InspectorSidebar
                onMobileClose={() => setMobileInspectorOpen(false)}
                campaignId={campaignId}
                sessions={sessions}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
