import React from 'react';
import {
  MousePointer2,
  Hand,
  Pencil,
  Type,
  Ruler,
  Dices,
  Stamp,
  Layers,
  ChevronLeft,
} from 'lucide-react';
import { useOptionalFeatureFlag } from '~/utils/featureFlags';

export type ToolType =
  | 'pointer'
  | 'hand'
  | 'drawing'
  | 'text'
  | 'ruler'
  | 'dice'
  | 'stamp'
  | 'layer';

export interface ToolBarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** When false, GM-only tools (e.g. Drawing) are hidden. */
  isGM?: boolean;
}

const tools: { id: ToolType; icon: React.ElementType; label: string; gmOnly?: boolean }[] = [
  { id: 'pointer', icon: MousePointer2, label: 'Pointer' },
  { id: 'hand', icon: Hand, label: 'Hand' },
  // Drawings are GM-only annotations (Spell FX / Drawing layer).
  { id: 'drawing', icon: Pencil, label: 'Drawing', gmOnly: true },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'ruler', icon: Ruler, label: 'Ruler' },
  { id: 'dice', icon: Dices, label: 'Dice' },
  { id: 'stamp', icon: Stamp, label: 'Stamp' },
  // The Layers panel is GM-only (only rendered for the GM in ActiveMapStage), so
  // hide the tool from players rather than leaving them a no-op button that
  // still steals focus from the Pointer tool.
  { id: 'layer', icon: Layers, label: 'Layer', gmOnly: true },
];

export function ToolBar({
  activeTool,
  onToolChange,
  collapsed,
  onToggleCollapse,
  isGM = false,
}: ToolBarProps) {
  // The interactive dice roller ships behind the same flag as the Dice feed tab.
  const diceFlag = useOptionalFeatureFlag(import.meta.env.VITE_PUBLIC_FF_DICE ?? '');
  const visibleTools = tools.filter(
    (t) => (!t.gmOnly || isGM) && (t.id !== 'dice' || diceFlag.isEnabled)
  );
  return (
    <div className="flex flex-col items-center h-full py-2 bg-[#080A12]">
      {!collapsed && (
        <div id="toolbar-tools" className="flex flex-col items-center gap-1 flex-1">
          {visibleTools.map(({ id, icon: Icon, label }) => {
            const isActive = id === activeTool;
            return (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={isActive}
                data-testid={`tool-${id}`}
                onClick={() => onToolChange(id)}
                title={label}
                className={[
                  'flex items-center justify-center w-10 h-10 rounded transition-colors',
                  isActive
                    ? 'bg-white/10 text-[#2563EB]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                ].join(' ')}
              >
                <Icon size={18} />
              </button>
            );
          })}
        </div>
      )}

      {collapsed && <div className="flex-1" />}

      <button
        type="button"
        aria-label={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
        aria-expanded={!collapsed}
        aria-controls="toolbar-tools"
        data-testid="toolbar-toggle"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
        className={[
          'flex items-center justify-center h-10 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors mt-auto',
          collapsed ? 'w-8' : 'w-10',
        ].join(' ')}
      >
        <span
          className={`inline-flex transition-transform duration-200 ${collapsed ? 'rotate-180' : 'rotate-0'}`}
        >
          <ChevronLeft size={16} />
        </span>
      </button>
    </div>
  );
}
