import type { ToolType } from '~/components/mainview/ToolBar';

/** Toolbar tools that open a window. drawing/text/ruler are also map modes. */
export type ToolWindowId = 'drawing' | 'text' | 'ruler' | 'dice' | 'layer';

const MODAL_TOOLS: ReadonlySet<ToolType> = new Set(['drawing', 'text', 'ruler']);
const WINDOW_ONLY_TOOLS: ReadonlySet<ToolType> = new Set(['dice', 'layer']);

export const TOOL_WINDOW_META: Record<ToolWindowId, { title: string }> = {
  drawing: { title: 'Draw' },
  text: { title: 'Text' },
  ruler: { title: 'Measurement' },
  dice: { title: 'Dice Roller' },
  layer: { title: 'Layers' },
};

export interface ToolUiState {
  /** Never 'dice' | 'layer' — those are window toggles, not modes. */
  activeTool: ToolType;
  /** Open tool windows, in open order. */
  openWindows: ToolWindowId[];
}

const keepWindowOnly = (open: ToolWindowId[]) =>
  open.filter((id) => id === 'dice' || id === 'layer');

/** Toolbar icon click → next {activeTool, openWindows}. Pure. */
export function applyToolClick(state: ToolUiState, clicked: ToolType): ToolUiState {
  if (WINDOW_ONLY_TOOLS.has(clicked)) {
    const id = clicked as ToolWindowId;
    const open = state.openWindows.includes(id)
      ? state.openWindows.filter((w) => w !== id)
      : [...state.openWindows, id];
    return { activeTool: state.activeTool, openWindows: open };
  }
  if (MODAL_TOOLS.has(clicked)) {
    const id = clicked as ToolWindowId;
    if (state.activeTool === clicked) {
      // Toggle off: close the window, revert to pointer.
      return { activeTool: 'pointer', openWindows: state.openWindows.filter((w) => w !== id) };
    }
    return { activeTool: clicked, openWindows: [...keepWindowOnly(state.openWindows), id] };
  }
  // pointer / hand / stamp — plain mode switch; modal windows follow their mode.
  return { activeTool: clicked, openWindows: keepWindowOnly(state.openWindows) };
}

/** Window X (or programmatic close) → next state. Pure. */
export function applyWindowClose(state: ToolUiState, id: ToolWindowId): ToolUiState {
  return {
    activeTool: state.activeTool === id ? 'pointer' : state.activeTool,
    openWindows: state.openWindows.filter((w) => w !== id),
  };
}
