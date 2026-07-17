import type { ToolType } from '~/components/mainview/ToolBar';

/** Toolbar tools that open a window. drawing/text/ruler/aoe are also map modes. */
export type ToolWindowId = 'drawing' | 'text' | 'ruler' | 'aoe' | 'dice' | 'layer';

const MODAL_TOOLS: ReadonlySet<ToolType> = new Set(['drawing', 'text', 'ruler', 'aoe']);
const WINDOW_ONLY_TOOLS: ReadonlySet<ToolType> = new Set(['dice', 'layer']);

export const TOOL_WINDOW_META: Record<ToolWindowId, { title: string }> = {
  drawing: { title: 'Draw' },
  text: { title: 'Text' },
  ruler: { title: 'Measurement' },
  aoe: { title: 'Spell AoE' },
  dice: { title: 'Dice Roller' },
  layer: { title: 'Layers' },
};

export interface ToolUiState {
  /** Never 'dice' | 'layer' — those are window toggles, not modes. */
  activeTool: ToolType;
  /** Open tool windows, in open order. */
  openWindows: ToolWindowId[];
}

const addWindow = (open: ToolWindowId[], id: ToolWindowId) =>
  open.includes(id) ? open : [...open, id];

/**
 * Toolbar icon click → next {activeTool, openWindows}. Pure.
 *
 * Window open/closed state is independent of the active map mode: every tool
 * window can be open at once. Only `activeTool` is single-valued — you can be
 * drawing OR measuring OR typing at one moment, but each window persists
 * across mode switches. Windows close only via their X (applyWindowClose) or
 * by re-clicking the tool that is currently active.
 */
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
      // Toggle off: close this window, revert to pointer. Other windows stay.
      return { activeTool: 'pointer', openWindows: state.openWindows.filter((w) => w !== id) };
    }
    // Activate this mode and open its window; all other windows stay open.
    return { activeTool: clicked, openWindows: addWindow(state.openWindows, id) };
  }
  // pointer / hand / stamp — plain mode switch; all open windows persist.
  return { activeTool: clicked, openWindows: state.openWindows };
}

/** Window X (or programmatic close) → next state. Pure. */
export function applyWindowClose(state: ToolUiState, id: ToolWindowId): ToolUiState {
  return {
    activeTool: state.activeTool === id ? 'pointer' : state.activeTool,
    openWindows: state.openWindows.filter((w) => w !== id),
  };
}
