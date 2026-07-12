# Toolbar Tools Production-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the five VTT tool windows (Draw, Text, Measurement, Dice Roller, Layers) behind one draggable, auto-placed `ToolWindow` chrome; split pointer (select/move) from hand (pan); fix the measurement tool's zoomed-click misplacement.

**Architecture:** A pure placement function (`placeToolWindow`) and a pure toolbar-semantics reducer (`toolWindowState`) feed a `useToolWindows` manager hook owned by `TabletopView`. `play.tsx` owns `{activeTool, openWindows}` via the reducer; `ActiveMapStage` renders the four map-tool windows and `TabletopView` renders the dice window, all through the shared `ToolWindow` component. Panning is gated to hand/middle-mouse/Space in `ActiveMapStage`.

**Tech Stack:** React 19 + TanStack Start, Tailwind, vitest (happy-dom, `tests/**`), Playwright (`e2e/**`), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-07-12-toolbar-tools-design.md`

## Global Constraints

- Branch `tools-fixes`; PRs target `dev`, never `main`.
- Coordinates: map objects live in IMAGE-PIXEL space; tool windows live in WORKSPACE-DOM px (relative to the stage/workspace container).
- Tool windows are per-user and ephemeral — never server-synced, never in `FloatingWindowManager`.
- `ToolType` union in `ToolBar.tsx` keeps all 8 ids (toolbar buttons), but `activeTool` state must never hold `'dice' | 'layer'` after this work.
- Do not touch document FloatingWindows (wiki/GM windows) beyond removing the dice special-case.
- Unit tests: `npx vitest run --project unit <file>`. Typecheck: `npm run typecheck`. Lint: `npm run lint`.
- E2E: `npx playwright test <file>` (boots dev server; e2e needs seeded Mongo per existing specs; dice specs need `VITE_PUBLIC_FF_DICE` set as in CI config).
- Commit after every task with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01TCPhrp5koSSPo8afU4rvG1`
- Existing testids `drawing-settings-panel`, `text-settings-panel`, `ruler-settings-panel`, `layers-panel` stay on the panel CONTENT roots (bodies), so content-level e2e assertions keep working; window chrome gets new `tool-window-*` testids.

---

### Task 1: `placeToolWindow` pure placement function

**Files:**
- Create: `app/components/mainview/tabletop/placeToolWindow.ts`
- Test: `tests/components/mainview/tabletop/placeToolWindow.test.ts`

**Interfaces:**
- Produces: `placeToolWindow(size: Size, openRects: Rect[], stage: Size): { x: number; y: number }`, `TOOL_WINDOW_MARGIN = 12`, types `Rect {x,y,width,height}`, `Size {width,height}`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/components/mainview/tabletop/placeToolWindow.test.ts
import { describe, it, expect } from 'vitest';
import {
  placeToolWindow,
  TOOL_WINDOW_MARGIN,
  type Rect,
} from '~/components/mainview/tabletop/placeToolWindow';

const STAGE = { width: 1200, height: 800 };
const M = TOOL_WINDOW_MARGIN; // 12

describe('placeToolWindow', () => {
  it('places the first window at the top-left origin', () => {
    expect(placeToolWindow({ width: 240, height: 300 }, [], STAGE)).toEqual({ x: M, y: M });
  });

  it('stacks the second window below the first (flow down)', () => {
    const open: Rect[] = [{ x: M, y: M, width: 240, height: 300 }];
    expect(placeToolWindow({ width: 240, height: 300 }, open, STAGE)).toEqual({
      x: M,
      y: M + 300 + M, // 324
    });
  });

  it('starts a new column to the right when the column is full', () => {
    const open: Rect[] = [
      { x: M, y: M, width: 240, height: 400 },
      { x: M, y: 424, width: 240, height: 300 },
    ];
    // Next window (height 200) cannot fit below y=736 within height 800.
    expect(placeToolWindow({ width: 240, height: 200 }, open, STAGE)).toEqual({
      x: M + 240 + M, // 264 — right of the widest window in column 1
      y: M,
    });
  });

  it('skips slots that would overlap a dragged window', () => {
    // A window was dragged to cover the origin slot.
    const open: Rect[] = [{ x: 0, y: 0, width: 300, height: 200 }];
    const pos = placeToolWindow({ width: 240, height: 300 }, open, STAGE);
    // First free candidate in column 1 is below the dragged window.
    expect(pos).toEqual({ x: M, y: 200 + M });
  });

  it('falls back to the origin when nothing fits (tiny stage)', () => {
    const open: Rect[] = [{ x: M, y: M, width: 240, height: 300 }];
    expect(placeToolWindow({ width: 240, height: 300 }, open, { width: 280, height: 340 })).toEqual(
      { x: M, y: M }
    );
  });

  it('handles a zero-size stage (pre-measure) by falling back to the origin', () => {
    expect(placeToolWindow({ width: 240, height: 300 }, [], { width: 0, height: 0 })).toEqual({
      x: M,
      y: M,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/placeToolWindow.test.ts`
Expected: FAIL — cannot resolve `~/components/mainview/tabletop/placeToolWindow`.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mainview/tabletop/placeToolWindow.ts
export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Gutter between tool windows and from the stage edges (workspace px). */
export const TOOL_WINDOW_MARGIN = 12;

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * First free slot for a newly opened tool window: origin at the top-left,
 * stacking below open windows (flow down); when a column is full, a new
 * column starts to the right of everything overlapping the current band.
 * Pure — callers pass measured sizes/rects. Falls back to the origin when
 * nothing fits (tiny viewport), where overlap is the least-bad option.
 */
export function placeToolWindow(
  size: Size,
  openRects: Rect[],
  stage: Size
): { x: number; y: number } {
  const m = TOOL_WINDOW_MARGIN;
  let colX = m;
  // Bounded loop: each iteration moves colX strictly right past at least one
  // window, so `openRects.length + 1` columns is the true upper bound.
  for (let col = 0; col <= openRects.length; col++) {
    if (colX + size.width > stage.width - m && col > 0) break;
    // Candidate ys: the top margin, plus just below every open window.
    const ys = [m, ...openRects.map((r) => r.y + r.height + m)].sort((a, b) => a - b);
    for (const y of ys) {
      if (y + size.height > stage.height - m) continue;
      const cand: Rect = { x: colX, y, width: size.width, height: size.height };
      if (!openRects.some((r) => intersects(cand, r))) return { x: colX, y };
    }
    // Column full — jump right of everything overlapping this column's band.
    const band = openRects.filter((r) => r.x < colX + size.width && r.x + r.width > colX);
    const nextX = band.length
      ? Math.max(...band.map((r) => r.x + r.width)) + m
      : colX + size.width + m;
    if (nextX <= colX) break;
    colX = nextX;
  }
  return { x: m, y: m };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/placeToolWindow.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/tabletop/placeToolWindow.ts tests/components/mainview/tabletop/placeToolWindow.test.ts
git commit -m "feat(tabletop): add pure tool-window placement (flow down, then right)"
```

---

### Task 2: `toolWindowState` toolbar-semantics reducer

**Files:**
- Create: `app/components/mainview/tabletop/toolWindowState.ts`
- Test: `tests/components/mainview/tabletop/toolWindowState.test.ts`

**Interfaces:**
- Consumes: `ToolType` from `~/components/mainview/ToolBar`.
- Produces (consumed by Tasks 4–5):
  - `type ToolWindowId = 'drawing' | 'text' | 'ruler' | 'dice' | 'layer'`
  - `interface ToolUiState { activeTool: ToolType; openWindows: ToolWindowId[] }`
  - `applyToolClick(state: ToolUiState, clicked: ToolType): ToolUiState`
  - `applyWindowClose(state: ToolUiState, id: ToolWindowId): ToolUiState`
  - `TOOL_WINDOW_META: Record<ToolWindowId, { title: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/components/mainview/tabletop/toolWindowState.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyToolClick,
  applyWindowClose,
  type ToolUiState,
} from '~/components/mainview/tabletop/toolWindowState';

const idle: ToolUiState = { activeTool: 'pointer', openWindows: [] };

describe('applyToolClick', () => {
  it('activates a modal tool and opens its window', () => {
    expect(applyToolClick(idle, 'drawing')).toEqual({
      activeTool: 'drawing',
      openWindows: ['drawing'],
    });
  });

  it('re-clicking the active modal tool closes its window and reverts to pointer', () => {
    const s = applyToolClick(idle, 'ruler');
    expect(applyToolClick(s, 'ruler')).toEqual(idle);
  });

  it('switching modal tools swaps the modal window', () => {
    const s = applyToolClick(idle, 'text');
    expect(applyToolClick(s, 'ruler')).toEqual({ activeTool: 'ruler', openWindows: ['ruler'] });
  });

  it('dice toggles its window without changing the active tool', () => {
    const s = applyToolClick(applyToolClick(idle, 'ruler'), 'dice');
    expect(s).toEqual({ activeTool: 'ruler', openWindows: ['ruler', 'dice'] });
    expect(applyToolClick(s, 'dice')).toEqual({ activeTool: 'ruler', openWindows: ['ruler'] });
  });

  it('layer toggles independently alongside dice', () => {
    const s = applyToolClick(applyToolClick(idle, 'dice'), 'layer');
    expect(s).toEqual({ activeTool: 'pointer', openWindows: ['dice', 'layer'] });
  });

  it('selecting pointer/hand closes the modal window but keeps dice/layer open', () => {
    const s = applyToolClick(applyToolClick(idle, 'dice'), 'text');
    expect(applyToolClick(s, 'hand')).toEqual({ activeTool: 'hand', openWindows: ['dice'] });
  });
});

describe('applyWindowClose', () => {
  it('closing a modal window reverts the active tool to pointer', () => {
    const s = applyToolClick(idle, 'drawing');
    expect(applyWindowClose(s, 'drawing')).toEqual(idle);
  });

  it('closing dice leaves the active tool alone', () => {
    const s = applyToolClick(applyToolClick(idle, 'ruler'), 'dice');
    expect(applyWindowClose(s, 'dice')).toEqual({ activeTool: 'ruler', openWindows: ['ruler'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/toolWindowState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mainview/tabletop/toolWindowState.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/toolWindowState.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/tabletop/toolWindowState.ts tests/components/mainview/tabletop/toolWindowState.test.ts
git commit -m "feat(tabletop): add toolbar/window semantics reducer"
```

---

### Task 3: `ToolWindow` shared chrome component

**Files:**
- Create: `app/components/mainview/tabletop/ToolWindow.tsx`
- Test: `tests/components/mainview/tabletop/ToolWindow.test.tsx`

**Interfaces:**
- Produces (consumed by Tasks 4–5):

```ts
interface ToolWindowProps {
  id: string; // ToolWindowId — used in testids
  title: string;
  icon: React.ElementType;
  position: { x: number; y: number };
  zIndex: number;
  /** false until measured+placed by the manager — rendered hidden. */
  placed: boolean;
  onClose: () => void;
  onFocus: () => void;
  onHeaderPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  rootRef: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/mainview/tabletop/ToolWindow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Ruler } from 'lucide-react';
import { ToolWindow } from '~/components/mainview/tabletop/ToolWindow';

function renderWindow(overrides: Partial<React.ComponentProps<typeof ToolWindow>> = {}) {
  const props = {
    id: 'ruler',
    title: 'Measurement',
    icon: Ruler,
    position: { x: 20, y: 30 },
    zIndex: 41,
    placed: true,
    onClose: vi.fn(),
    onFocus: vi.fn(),
    onHeaderPointerDown: vi.fn(),
    rootRef: () => {},
    children: <div data-testid="content">hi</div>,
    ...overrides,
  };
  render(<ToolWindow {...props} />);
  return props;
}

describe('ToolWindow', () => {
  it('renders grip, icon, uppercase title, close X, and content', () => {
    renderWindow();
    const win = screen.getByTestId('tool-window-ruler');
    expect(win).toBeTruthy();
    expect(screen.getByTestId('tool-window-ruler-header')).toBeTruthy();
    expect(screen.getByText('Measurement')).toBeTruthy();
    expect(screen.getByLabelText('Close measurement window')).toBeTruthy();
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('positions via left/top/zIndex and hides until placed', () => {
    renderWindow({ placed: false });
    const win = screen.getByTestId('tool-window-ruler');
    expect(win.style.left).toBe('20px');
    expect(win.style.top).toBe('30px');
    expect(win.style.zIndex).toBe('41');
    expect(win.style.visibility).toBe('hidden');
  });

  it('X click calls onClose without starting a drag', () => {
    const props = renderWindow();
    fireEvent.click(screen.getByTestId('tool-window-ruler-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onHeaderPointerDown).not.toHaveBeenCalled();
  });

  it('header pointerdown starts a drag; window pointerdown focuses', () => {
    const props = renderWindow();
    fireEvent.pointerDown(screen.getByTestId('tool-window-ruler-header'));
    expect(props.onHeaderPointerDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId('tool-window-ruler'));
    expect(props.onFocus).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/ToolWindow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/mainview/tabletop/ToolWindow.tsx
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
      style={{ left: position.x, top: position.y, zIndex, visibility: placed ? 'visible' : 'hidden' }}
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/ToolWindow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/tabletop/ToolWindow.tsx tests/components/mainview/tabletop/ToolWindow.test.tsx
git commit -m "feat(tabletop): add shared ToolWindow chrome (grip, icon+title, close X)"
```

---

### Task 4: `useToolWindows` manager hook

**Files:**
- Create: `app/components/mainview/tabletop/useToolWindows.ts`
- Test: `tests/components/mainview/tabletop/useToolWindows.test.tsx`

**Interfaces:**
- Consumes: `placeToolWindow`/`TOOL_WINDOW_MARGIN`/`Rect` (Task 1), `ToolWindowId` (Task 2), `ToolWindowProps` shape (Task 3).
- Produces (consumed by Task 5):

```ts
function useToolWindows(
  openWindows: ToolWindowId[],
  containerRef: RefObject<HTMLElement | null>,
  onCloseWindow: (id: ToolWindowId) => void
): ToolWindowManager;

type ToolWindowManager = {
  /** Everything ToolWindow needs except title/icon/children. */
  getWindowProps: (id: ToolWindowId) => Pick<
    ToolWindowProps,
    'id' | 'position' | 'zIndex' | 'placed' | 'onClose' | 'onFocus' | 'onHeaderPointerDown' | 'rootRef'
  >;
};
```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/mainview/tabletop/useToolWindows.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dices } from 'lucide-react';
import { ToolWindow } from '~/components/mainview/tabletop/ToolWindow';
import { useToolWindows } from '~/components/mainview/tabletop/useToolWindows';
import type { ToolWindowId } from '~/components/mainview/tabletop/toolWindowState';

function Harness({
  open,
  onClose,
}: {
  open: ToolWindowId[];
  onClose: (id: ToolWindowId) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const manager = useToolWindows(open, ref, onClose);
  return (
    <div ref={ref} style={{ width: 1200, height: 800, position: 'relative' }}>
      {open.map((id) => (
        <ToolWindow key={id} title={id} icon={Dices} {...manager.getWindowProps(id)}>
          <div style={{ width: 240, height: 100 }} />
        </ToolWindow>
      ))}
    </div>
  );
}

describe('useToolWindows', () => {
  it('marks a newly opened window as placed (visible) after measure', async () => {
    render(<Harness open={['dice']} onClose={() => {}} />);
    const win = screen.getByTestId('tool-window-dice');
    await waitFor(() => expect(win.style.visibility).toBe('visible'));
    // happy-dom measures 0×0; placement still lands on the origin slot.
    expect(win.style.left).toBe('12px');
    expect(win.style.top).toBe('12px');
  });

  it('routes the close button to onCloseWindow', async () => {
    const onClose = vi.fn();
    render(<Harness open={['dice']} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tool-window-dice-close'));
    expect(onClose).toHaveBeenCalledWith('dice');
  });

  it('focusing a window raises it above the others', async () => {
    render(<Harness open={['dice', 'layer']} onClose={() => {}} />);
    const dice = screen.getByTestId('tool-window-dice');
    const layer = screen.getByTestId('tool-window-layer');
    await waitFor(() => expect(layer.style.visibility).toBe('visible'));
    const layerZ = Number(layer.style.zIndex);
    fireEvent.pointerDown(dice);
    await waitFor(() => expect(Number(dice.style.zIndex)).toBeGreaterThan(layerZ));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/useToolWindows.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mainview/tabletop/useToolWindows.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { placeToolWindow, TOOL_WINDOW_MARGIN, type Rect } from './placeToolWindow';
import type { ToolWindowId } from './toolWindowState';

interface WindowGeom {
  x: number;
  y: number;
  zIndex: number;
  /** false while waiting for first measure — ToolWindow renders hidden. */
  placed: boolean;
}

/** Above the map/overlays (which top out at z-30), below modals (z-50). */
const Z_BASE = 40;
const FALLBACK_SIZE = 240;

export type ToolWindowManager = ReturnType<typeof useToolWindows>;

/**
 * Owns geometry for the per-user tool windows: auto-placement on open
 * (top-left, flow down then right), drag with clamping, and z-order.
 * Open/closed state itself lives upstream (play route via toolWindowState);
 * this hook only maps ids → positions. Ephemeral by design.
 */
export function useToolWindows(
  openWindows: ToolWindowId[],
  containerRef: RefObject<HTMLElement | null>,
  onCloseWindow: (id: ToolWindowId) => void
) {
  const [geoms, setGeoms] = useState<Partial<Record<ToolWindowId, WindowGeom>>>({});
  const elsRef = useRef(new Map<ToolWindowId, HTMLDivElement>());
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Observe the workspace size (same pattern as useViewport).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Sync geometry entries with the open set: new ids start unplaced; closed
  // ids are dropped so a reopened window is re-placed fresh.
  useEffect(() => {
    setGeoms((prev) => {
      const next: typeof prev = {};
      let changed = Object.keys(prev).length !== openWindows.length;
      for (const id of openWindows) {
        if (prev[id]) {
          next[id] = prev[id];
        } else {
          next[id] = { x: TOOL_WINDOW_MARGIN, y: TOOL_WINDOW_MARGIN, zIndex: Z_BASE, placed: false };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [openWindows]);

  const sizeOf = useCallback((id: ToolWindowId) => {
    const el = elsRef.current.get(id);
    return {
      width: el?.offsetWidth || FALLBACK_SIZE,
      height: el?.offsetHeight || FALLBACK_SIZE,
    };
  }, []);

  // Measure + place unplaced windows (they rendered hidden this commit).
  useEffect(() => {
    const unplaced = openWindows.filter((id) => geoms[id] && !geoms[id]!.placed);
    if (unplaced.length === 0) return;
    setGeoms((prev) => {
      const next = { ...prev };
      const placedRects: Rect[] = openWindows
        .filter((id) => next[id]?.placed)
        .map((id) => ({ x: next[id]!.x, y: next[id]!.y, ...sizeOf(id) }));
      let zTop = Math.max(Z_BASE, ...Object.values(next).map((g) => g?.zIndex ?? Z_BASE));
      for (const id of unplaced) {
        if (!elsRef.current.get(id)) continue; // not mounted yet — next commit
        const size = sizeOf(id);
        const pos = placeToolWindow(size, placedRects, containerSize);
        zTop += 1;
        next[id] = { ...pos, zIndex: zTop, placed: true };
        placedRects.push({ ...pos, ...size });
      }
      return next;
    });
  }, [openWindows, geoms, containerSize, sizeOf]);

  const clampPos = useCallback(
    (id: ToolWindowId, pos: { x: number; y: number }) => {
      const { width, height } = sizeOf(id);
      return {
        x: Math.min(Math.max(pos.x, 0), Math.max(0, containerSize.width - width)),
        y: Math.min(Math.max(pos.y, 0), Math.max(0, containerSize.height - height)),
      };
    },
    [containerSize, sizeOf]
  );

  // Re-clamp open windows when the workspace shrinks (inspector, resize).
  useEffect(() => {
    if (containerSize.width === 0) return;
    setGeoms((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next) as ToolWindowId[]) {
        const g = next[id];
        if (!g?.placed) continue;
        const c = clampPos(id, g);
        if (c.x !== g.x || c.y !== g.y) {
          next[id] = { ...g, ...c };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [containerSize, clampPos]);

  const focus = useCallback((id: ToolWindowId) => {
    setGeoms((prev) => {
      const g = prev[id];
      if (!g) return prev;
      const zTop = Math.max(Z_BASE, ...Object.values(prev).map((x) => x?.zIndex ?? Z_BASE));
      if (g.zIndex === zTop && Object.values(prev).filter((x) => x?.zIndex === zTop).length === 1) {
        return prev;
      }
      return { ...prev, [id]: { ...g, zIndex: zTop + 1 } };
    });
  }, []);

  // Header drag — window-level listeners so the drag keeps tracking outside
  // the window/stage (the stage's own drag machine is never involved).
  const beginDrag = useCallback(
    (id: ToolWindowId, e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Let the close button (child) handle its own pointerdown.
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      e.stopPropagation();
      focus(id);
      const start = geoms[id];
      if (!start) return;
      const sx = e.clientX;
      const sy = e.clientY;
      const onMove = (ev: PointerEvent) => {
        setGeoms((prev) => {
          const g = prev[id];
          if (!g) return prev;
          const c = clampPos(id, { x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
          return { ...prev, [id]: { ...g, ...c } };
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [geoms, focus, clampPos]
  );

  const getWindowProps = useCallback(
    (id: ToolWindowId) => ({
      id,
      position: { x: geoms[id]?.x ?? TOOL_WINDOW_MARGIN, y: geoms[id]?.y ?? TOOL_WINDOW_MARGIN },
      zIndex: geoms[id]?.zIndex ?? Z_BASE,
      placed: geoms[id]?.placed ?? false,
      onClose: () => onCloseWindow(id),
      onFocus: () => focus(id),
      onHeaderPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => beginDrag(id, e),
      rootRef: (el: HTMLDivElement | null) => {
        if (el) elsRef.current.set(id, el);
        else elsRef.current.delete(id);
      },
    }),
    [geoms, onCloseWindow, focus, beginDrag]
  );

  return { getWindowProps };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/components/mainview/tabletop/useToolWindows.test.tsx`
Expected: PASS (3 tests). If the "placed" test flakes because happy-dom lacks `ResizeObserver`, add a stub to `tests/setup.ts` only if it is not already there (check first — other tests may already stub it).

- [ ] **Step 5: Commit**

```bash
git add app/components/mainview/tabletop/useToolWindows.ts tests/components/mainview/tabletop/useToolWindows.test.tsx
git commit -m "feat(tabletop): add useToolWindows manager (placement, drag, z-order)"
```

---

### Task 5: Integrate the unified window system

The big integration: play route owns `ToolUiState`; ToolBar highlights open windows; TabletopView hosts the manager + dice window; ActiveMapStage renders Draw/Text/Ruler/Layers through `ToolWindow`; the four panels become chrome-less content; the old dice FloatingWindow special-case and per-panel drag plumbing are deleted. Existing e2e selectors are updated.

**Files:**
- Modify: `app/routes/campaigns/$campaignId/play.tsx` (~line 92, 129–136, 181–189)
- Modify: `app/components/mainview/MainView.tsx` (props pass-through)
- Modify: `app/components/mainview/ToolBar.tsx` (highlight logic)
- Modify: `app/components/mainview/tabletop/TabletopView.tsx` (dice window, manager, props)
- Modify: `app/components/mainview/tabletop/ActiveMapStage.tsx` (render windows, delete panel plumbing)
- Modify: `app/components/mainview/tabletop/useRulerTool.ts` (remove `rulerPanelOpen`)
- Modify: `app/components/mainview/tabletop/DrawingSettingsPanel.tsx`, `TextSettingsPanel.tsx`, `RulerSettingsPanel.tsx`, `LayersPanel.tsx` (content-only)
- Modify: `e2e/tabletop/tabletop-drawing.spec.ts`, `tabletop-text.spec.ts`, `tabletop-measurement.spec.ts`, `tabletop-ruler-color.spec.ts`, `dice-roller.spec.ts`

**Interfaces:**
- Consumes: `applyToolClick`/`applyWindowClose`/`ToolUiState`/`ToolWindowId`/`TOOL_WINDOW_META` (Task 2), `ToolWindow` (Task 3), `useToolWindows`/`ToolWindowManager` (Task 4).
- Produces: `ToolBarProps` gains `openWindows?: ToolWindowId[]`; `TabletopViewProps` gains `openToolWindows: ToolWindowId[]`, `onCloseToolWindow: (id: ToolWindowId) => void`; `ActiveMapStageProps` swaps `layerPanelOpen`/`onCloseLayerPanel` for `openToolWindows: ToolWindowId[]` + `windowManager: ToolWindowManager`.

- [ ] **Step 1: play.tsx — own ToolUiState**

In `app/routes/campaigns/$campaignId/play.tsx` replace line 92:

```tsx
// Toolbar tool + open tool windows are owned here so both the ToolBar (a
// MainView concern) and the Tabletop can react to them. Semantics live in
// the pure toolWindowState reducer.
const [toolUi, setToolUi] = useState<ToolUiState>({ activeTool: 'pointer', openWindows: [] });
const handleToolClick = useCallback(
  (tool: ToolType) => setToolUi((s) => applyToolClick(s, tool)),
  []
);
const handleToolWindowClose = useCallback(
  (id: ToolWindowId) => setToolUi((s) => applyWindowClose(s, id)),
  []
);
```

Add imports:

```tsx
import {
  applyToolClick,
  applyWindowClose,
  type ToolUiState,
  type ToolWindowId,
} from '~/components/mainview/tabletop/toolWindowState';
```

Update the MainView usage (lines 129–136):

```tsx
<MainView
  showToolbar={effectiveTab === 'tabletop'}
  campaignId={campaignId}
  sessions={campaign?.sessions}
  activeTool={toolUi.activeTool}
  onToolChange={handleToolClick}
  openToolWindows={toolUi.openWindows}
  isGM={campaign?.isGM ?? false}
>
```

Update the TabletopView usage (lines 181–189):

```tsx
<TabletopView
  campaignId={campaignId}
  isGM={campaign?.isGM ?? false}
  currentUserId={campaign?.currentUserId ?? null}
  getToken={getTabletopToken}
  sessionId={activeSession?.id ?? null}
  activeTool={toolUi.activeTool}
  onToolChange={handleToolClick}
  openToolWindows={toolUi.openWindows}
  onCloseToolWindow={handleToolWindowClose}
/>
```

Keep `ToolType` import; remove the now-unused `useState<ToolType>` form.

- [ ] **Step 2: MainView.tsx + ToolBar.tsx — pass through + highlight**

`MainView.tsx`: add to `MainViewProps`:

```tsx
/** Open tool windows (highlighted on the toolbar alongside the active tool). */
openToolWindows?: ToolWindowId[];
```

with `import type { ToolWindowId } from './tabletop/toolWindowState';`, destructure `openToolWindows = []`, and pass `openWindows={openToolWindows}` to `<ToolBar>`.

`ToolBar.tsx`: add to `ToolBarProps`:

```tsx
/** Tool windows currently open — their icons render highlighted too. */
openWindows?: ToolWindowId[];
```

(`import type { ToolWindowId } from './tabletop/toolWindowState';`), destructure `openWindows = []`, and change line 66 to:

```tsx
const isActive = id === activeTool || (openWindows as string[]).includes(id);
```

- [ ] **Step 3: Panels become chrome-less content**

For each of the four panels, delete the header block, close button, grip, and outer positioning; the root becomes a plain content `div` (keep its `data-testid`, `role="group"`, and `aria-label`). Prop changes:

- `RulerSettingsPanel.tsx`: remove `onClose` prop. Root div becomes:

```tsx
<div className="w-60" data-testid="ruler-settings-panel" role="group" aria-label="Measurement settings">
```

  Delete the whole "Header with close button" block (lines 29–45) and remove the `Ruler, X` lucide imports. Keep the color-picker body and footer text unchanged.

- `LayersPanel.tsx`: remove `onClose` prop and the header block (lines 36–51); remove `X, Layers` imports (keep `Eye, EyeOff`). Root div becomes:

```tsx
<div className="w-60" data-testid="layers-panel" role="group" aria-label="Map layers">
```

- `DrawingSettingsPanel.tsx`: remove props `position`, `onHeaderPointerDown`, `rootRef`; remove the header block (lines 71–82) and the `GripVertical` import; root div becomes:

```tsx
<div className="w-60" data-testid="drawing-settings-panel" role="group" aria-label="Drawing settings">
```

  Update the footer copy: `Draw on the map. Use the Pointer tool to select a shape, then resize from its corner or press Delete.`

- `TextSettingsPanel.tsx`: same treatment — remove `position`/`onHeaderPointerDown`/`rootRef` props, header block (lines 49–60), `GripVertical` import; root:

```tsx
<div className="w-60" data-testid="text-settings-panel" role="group" aria-label="Text settings">
```

  Footer copy: `Click the map to write; click text to select, then change its size/color or press Delete.`

Also remove each root's `onPointerDown={(e) => e.stopPropagation()}` — `ToolWindow` now does that.

- [ ] **Step 4: useRulerTool.ts — remove the panel-open state**

Delete `rulerPanelOpen`/`setRulerPanelOpen` (lines 71–73, the `setRulerPanelOpen(true)` in the effect at line 82, and both from the return). The window's visibility is now `openWindows.includes('ruler')`.

- [ ] **Step 5: ActiveMapStage.tsx — render windows via the manager, delete panel plumbing**

Props (lines 68–88): remove `layerPanelOpen`/`onCloseLayerPanel`; add:

```tsx
/** Open tool windows (drawing/text/ruler/layer render inside the stage). */
openToolWindows: ToolWindowId[];
/** Geometry manager shared with TabletopView (dice renders up there). */
windowManager: ToolWindowManager;
```

with imports:

```tsx
import { ToolWindow } from './ToolWindow';
import { TOOL_WINDOW_META, type ToolWindowId } from './toolWindowState';
import type { ToolWindowManager } from './useToolWindows';
import { Pencil, Type as TypeIcon, Ruler as RulerIcon, Layers as LayersIcon } from 'lucide-react';
```

(merge with existing lucide imports — the file already imports `Eye, EyeOff`).

Delete the old panel plumbing:
- `panelPos` state + `panelRef` (lines 162–163)
- `beginPanelDrag` (lines 756–772)
- `clampPanelPos` + the re-clamp effect (lines 883–905)
- the `{ mode: 'panel'; … }` member of `DragState` (around line 545), `'panel'` from the `dragMode` union (line 602), and the `d.mode === 'panel'` branch in `onPointerMove` (lines 1012–1019)

Replace the four panel render blocks (lines 1506–1556) with windows:

```tsx
{/* Tool windows — unified chrome, placed/dragged by the shared manager. */}
{isGM && openToolWindows.includes('layer') && (
  <ToolWindow title={TOOL_WINDOW_META.layer.title} icon={LayersIcon} {...windowManager.getWindowProps('layer')}>
    <LayersPanel
      activeLayer={activeLayer}
      hiddenLayers={hiddenLayers}
      tokenCounts={tokenCounts}
      onSelectLayer={setActiveLayer}
      onToggleLayer={toggleLayerVisibility}
    />
  </ToolWindow>
)}

{openToolWindows.includes('ruler') && (
  <ToolWindow title={TOOL_WINDOW_META.ruler.title} icon={RulerIcon} {...windowManager.getWindowProps('ruler')}>
    <RulerSettingsPanel color={ruler.rulerColor} onChangeColor={ruler.setRulerColor} />
  </ToolWindow>
)}

{openToolWindows.includes('text') && (
  <ToolWindow title={TOOL_WINDOW_META.text.title} icon={TypeIcon} {...windowManager.getWindowProps('text')}>
    <TextSettingsPanel
      color={textColor}
      onChangeColor={applyTextColor}
      fontSize={textFontSize}
      onChangeFontSize={applyTextFontSize}
    />
  </ToolWindow>
)}

{isGM && openToolWindows.includes('drawing') && (
  <ToolWindow title={TOOL_WINDOW_META.drawing.title} icon={Pencil} {...windowManager.getWindowProps('drawing')}>
    <DrawingSettingsPanel
      shape={drawShape}
      onChangeShape={setDrawShape}
      color={drawColor}
      onChangeColor={setDrawColor}
      strokeWidth={drawShape === 'eraser' ? drawEraserSize : drawStrokeWidth}
      onChangeStrokeWidth={drawShape === 'eraser' ? setDrawEraserSize : setDrawStrokeWidth}
      filled={drawFilled}
      onToggleFilled={() => setDrawFilled((v) => !v)}
    />
  </ToolWindow>
)}
```

Note: `rulerActive`/`textActive`/`drawingActive` (map-mode behavior) still come from `activeTool` via TabletopView and are untouched here; only the window rendering changes. The `{rulerActive && ruler.rulerPanelOpen && …}` condition is gone with `rulerPanelOpen`.

- [ ] **Step 6: TabletopView.tsx — manager + dice window, delete the FloatingWindow special-case**

Props (lines 82–91): add

```tsx
/** Open tool windows (owned by the play route). */
openToolWindows: ToolWindowId[];
/** Close a tool window (X button) — routes through the play route's reducer. */
onCloseToolWindow: (id: ToolWindowId) => void;
```

Imports: add

```tsx
import { Dices } from 'lucide-react';
import { ToolWindow } from './ToolWindow';
import { TOOL_WINDOW_META, type ToolWindowId } from './toolWindowState';
import { useToolWindows } from './useToolWindows';
```

Delete the dice special-case entirely:
- `DICE_ROLLER_WINDOW_ID` (line 64)
- `diceWindow` state + comment (lines 126–129) and `prevToolRef` (line 130)
- the dice effect (lines 475–496)
- in `handleWindowsChange` (lines 499–518): remove the dice filtering — it becomes:

```tsx
const handleWindowsChange = useCallback(
  (nextWindows: ManagedWindow[]) => {
    setLocalWindows(nextWindows);
    if (!activeScreenId || !activeScreen) return;
    const nextIds = new Set(nextWindows.map((w) => w.id));
    for (const w of activeScreen.windows) {
      if (!nextIds.has(w.id)) {
        mutations.closeWindow.mutate({ screenId: activeScreenId, windowId: w.id });
      }
    }
  },
  [activeScreenId, activeScreen, mutations]
);
```

- `FloatingWindowManager` usage (line 642): `windows={localWindows}`.

Instantiate the manager (after `workspaceRef` is defined):

```tsx
// Per-user tool windows (Draw/Text/Ruler/Dice/Layers) — geometry only; the
// open set lives in the play route. Dice renders here (works without an
// active map); the map-tool windows render inside ActiveMapStage.
const toolWindowManager = useToolWindows(openToolWindows, workspaceRef, onCloseToolWindow);
```

Update the `ActiveMapStage` usage (lines 624–636):

```tsx
<ActiveMapStage
  map={activeMap}
  campaignId={campaignId}
  isGM={isGM}
  currentUserId={currentUserId}
  onBroadcast={sendMapMessage}
  rulerActive={activeTool === 'ruler'}
  textActive={activeTool === 'text'}
  drawingActive={activeTool === 'drawing'}
  pointerActive={activeTool === 'pointer'}
  openToolWindows={openToolWindows}
  windowManager={toolWindowManager}
/>
```

Render the dice window inside the workspace div, after `<FloatingWindowManager …/>`:

```tsx
{openToolWindows.includes('dice') && (
  <ToolWindow
    title={TOOL_WINDOW_META.dice.title}
    icon={Dices}
    {...toolWindowManager.getWindowProps('dice')}
  >
    <div className="h-[560px] w-[340px]">
      <DiceRollerPanel />
    </div>
  </ToolWindow>
)}
```

Make `activeTool`/`onToolChange` required-in-practice stays as-is (optional props still fine — `activeTool ?? 'pointer'`). `openToolWindows`/`onCloseToolWindow` are required props.

- [ ] **Step 7: Typecheck, lint, unit tests**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: clean. Typical stragglers: unused imports in the four panels (X/GripVertical/lucide icons), `ToolType` imports, the removed props still referenced somewhere — fix all.

- [ ] **Step 8: Update existing e2e specs**

Read each spec and update to the new chrome/behavior. Selector/behavior mapping:

| Old | New |
|---|---|
| Panel roots are windows themselves (`drawing-settings-panel` positioned/draggable) | Window root `tool-window-drawing`; header `tool-window-drawing-header`; content testids unchanged |
| Drag panel by `drawing-settings-panel-header` / `text-settings-panel-header` | Drag by `tool-window-drawing-header` / `tool-window-text-header` |
| Layers close: X inside `layers-panel` | `tool-window-layer-close`; closing does NOT change the active tool |
| Ruler settings close (`aria-label="Close measurement settings"`) hid panel, ruler stayed active | `tool-window-ruler-close` closes window AND reverts tool to pointer |
| Dice: momentary toolbar button opens `FloatingWindow` titled "Dice Roller" with minimize/maximize/tray | `tool-dice` toggles `tool-window-dice`; no minimize/maximize/tray; X closes; icon stays highlighted (`aria-pressed`) while open |
| Re-selecting drawing/text/ruler tool kept window open | Re-click toggles the window closed and reverts to pointer (update any spec that re-clicks the same tool button) |

Specifics:
- `dice-roller.spec.ts`: replace FloatingWindow assertions (minimize/tray) with: click `tool-dice` → `tool-window-dice` visible with `tool-window-dice-header` and `tool-window-dice-close`; roll interactions unchanged (they target the panel content); click `tool-window-dice-close` → window gone; click `tool-dice` twice → open then closed.
- `tabletop-drawing.spec.ts` / `tabletop-text.spec.ts`: panel-visible assertions now also may assert `tool-window-drawing`/`tool-window-text` exists; drag-the-panel tests target the new header testids.
- `tabletop-measurement.spec.ts` / `tabletop-ruler-color.spec.ts`: the settings window appears when the ruler tool activates (`tool-window-ruler`); closing it deactivates the ruler (cursor no longer crosshair) — update the "close panel, ruler stays active" expectations to the new semantics.

Also add a non-overlap assertion (new spec `e2e/tabletop/tool-windows.spec.ts`, provisioning copied from `tabletop-drawing.spec.ts` — needs a GM session so Layers/Draw are available):

```ts
test('two tool windows open side by side without overlapping', async ({ page }) => {
  await page.getByTestId('tool-drawing').click();
  await page.getByTestId('tool-layer').click();
  const a = (await page.getByTestId('tool-window-drawing').boundingBox())!;
  const b = (await page.getByTestId('tool-window-layer').boundingBox())!;
  const overlaps =
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlaps).toBe(false);
});

test('every tool window shows grip, icon+title, and close X', async ({ page }) => {
  for (const [tool, id, title] of [
    ['tool-drawing', 'drawing', 'Draw'],
    ['tool-text', 'text', 'Text'],
    ['tool-ruler', 'ruler', 'Measurement'],
    ['tool-layer', 'layer', 'Layers'],
  ] as const) {
    await page.getByTestId(tool).click();
    const header = page.getByTestId(`tool-window-${id}-header`);
    await expect(header).toBeVisible();
    await expect(header).toContainText(title);
    await expect(page.getByTestId(`tool-window-${id}-close`)).toBeVisible();
    await page.getByTestId(`tool-window-${id}-close`).click();
    await expect(page.getByTestId(`tool-window-${id}`)).toHaveCount(0);
  }
});
```

Run: `npx playwright test e2e/tabletop/tabletop-drawing.spec.ts e2e/tabletop/tabletop-text.spec.ts e2e/tabletop/tabletop-measurement.spec.ts e2e/tabletop/tabletop-ruler-color.spec.ts e2e/tabletop/dice-roller.spec.ts`
Expected: PASS. (Needs local Mongo/seed per the specs' own provisioning; dice spec needs `VITE_PUBLIC_FF_DICE` env var set the same way CI does — see `.github/workflows` for the exact var value.)

- [ ] **Step 9: Manual verify (run skill) and commit**

Launch the app (`npm run dev`), open a campaign → Tabletop: open Draw + Dice + Layers together — all show `::`+icon+title+X, don't overlap, drag freely, X closes (Draw's X also reverts toolbar to pointer).

```bash
git add -A app e2e
git commit -m "feat(tabletop): unify all five tool windows behind shared ToolWindow chrome

Draw/Text/Measurement/Dice/Layers now share one draggable window with
::-grip header and close X, auto-placed top-left flowing down then right.
Dice loses the FloatingWindow special case; window state lives in the
play route via the toolWindowState reducer."
```

---

### Task 6: Pointer selects, Hand pans (+ middle-mouse / Space pan)

**Files:**
- Modify: `app/components/mainview/tabletop/ActiveMapStage.tsx` (`onPanPointerDown` ~line 605, cursor ~line 1284, new `handActive` prop + space tracking)
- Modify: `app/components/mainview/tabletop/MapTextLayer.tsx` (interactive gating, line 62)
- Modify: `app/components/mainview/tabletop/TabletopView.tsx` (pass `handActive`)
- Test: `e2e/tabletop/tabletop-pointer-hand.spec.ts` (new)

**Interfaces:**
- Consumes: existing drag machine (`dragRef`, `mode: 'pan'`).
- Produces: `ActiveMapStageProps.handActive?: boolean`; `MapTextLayerProps.pointerActive: boolean`.

- [ ] **Step 1: Write the failing e2e test**

Model provisioning/setup on `e2e/tabletop/tabletop-measurement.spec.ts` (same Mongo seeding pattern, one map + one text + one token). Test bodies:

```ts
// e2e/tabletop/tabletop-pointer-hand.spec.ts  (setup boilerplate copied from tabletop-measurement.spec.ts)
test('pointer tool does not pan the map', async ({ page }) => {
  const mapImg = page.locator('[data-testid="active-map-stage"] img');
  await page.getByTestId('tool-pointer').click();
  const before = await mapImg.boundingBox();
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 5 });
  await page.mouse.up();
  const after = await mapImg.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
});

test('hand tool pans the map', async ({ page }) => {
  const mapImg = page.locator('[data-testid="active-map-stage"] img');
  await page.getByTestId('tool-hand').click();
  const before = await mapImg.boundingBox();
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 5 });
  await page.mouse.up();
  const after = await mapImg.boundingBox();
  expect(after!.x - before!.x).toBeGreaterThan(100);
});

test('space+drag pans with the pointer tool active', async ({ page }) => {
  const mapImg = page.locator('[data-testid="active-map-stage"] img');
  await page.getByTestId('tool-pointer').click();
  const before = await mapImg.boundingBox();
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  await page.keyboard.down(' ');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  const after = await mapImg.boundingBox();
  expect(after!.x - before!.x).toBeGreaterThan(100);
});

test('text is movable with the pointer tool', async ({ page }) => {
  await page.getByTestId('tool-pointer').click();
  const text = page.getByTestId(/map-text-/).first(); // use the actual text testid from MapTextLayer
  const before = await text.boundingBox();
  await text.hover();
  await page.mouse.down();
  await page.mouse.move(before!.x + 120, before!.y + 80, { steps: 5 });
  await page.mouse.up();
  const after = await text.boundingBox();
  expect(after!.x - before!.x).toBeGreaterThan(80);
});
```

(Check `MapTextLayer.tsx` for the real per-text testid/selector before writing the last test; if none exists, add `data-testid={`map-text-${t.id}`}` to the text button while editing the file in Step 3.)

- [ ] **Step 2: Run the new spec to verify current failures**

Run: `npx playwright test e2e/tabletop/tabletop-pointer-hand.spec.ts`
Expected: "pointer does not pan" FAILS (map moves today); "text movable with pointer" FAILS. Hand/space tests may pass by accident today — fine.

- [ ] **Step 3: Implement**

`ActiveMapStage.tsx`:

1. Add prop `handActive?: boolean` (default `false`) to the interface and destructuring.

2. Track Space (near the other keyboard effects, after line ~485):

```tsx
// Space held = temporary hand tool (pan with any tool). Ignored while typing.
const [spaceHeld, setSpaceHeld] = useState(false);
useEffect(() => {
  const isTyping = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };
  const down = (e: KeyboardEvent) => {
    if (e.key === ' ' && !isTyping(e.target)) setSpaceHeld(true);
  };
  const up = (e: KeyboardEvent) => {
    if (e.key === ' ') setSpaceHeld(false);
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}, []);
```

3. `onPanPointerDown` (line 605): replace the first line and the fall-through block:

```tsx
const onPanPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
  // Middle-button drag pans with ANY tool (preventDefault stops autoscroll).
  const middlePan = e.button === 1;
  if (middlePan) e.preventDefault();
  else if (e.button !== 0) return;

  if (!middlePan) {
    if (rulerActive) { /* … existing ruler block unchanged … */ }
    if (textActive) { /* … existing text block unchanged … */ }
    if (drawingActive) { /* … existing drawing block unchanged … */ }
  }

  // Background press: always deselect; pan only for hand / Space / middle.
  setSelectedDrawingId(null);
  clearSelection();
  if (!middlePan && !handActive && !spaceHeld) return;
  (e.target as Element).setPointerCapture?.(e.pointerId);
  dragRef.current = {
    mode: 'pan',
    startClientX: e.clientX,
    startClientY: e.clientY,
    startVp: viewport,
  };
  setDragMode('pan');
};
```

(The three existing tool blocks keep their bodies verbatim — only wrapped in `if (!middlePan) { … }` so middle-drag pans even while a tool mode is active.)

4. Cursor (line 1284):

```tsx
const cursorClass =
  dragMode === 'pan'
    ? 'cursor-grabbing'
    : handActive || spaceHeld
      ? 'cursor-grab'
      : rulerActive || drawingActive
        ? 'cursor-crosshair'
        : textActive
          ? 'cursor-text'
          : 'cursor-default';
```

`MapTextLayer.tsx`: add prop `pointerActive: boolean`; line 62 becomes:

```tsx
const interactive = (textActive || pointerActive) && canModify(t);
```

and (if missing) add `data-testid={`map-text-${t.id}`}` to the per-text button.

`ActiveMapStage.tsx` → `<MapTextLayer …>` (line 1407): pass `pointerActive={pointerActive}`.

`TabletopView.tsx` → `<ActiveMapStage …>`: add `handActive={activeTool === 'hand'}`.

- [ ] **Step 4: Run the e2e spec to verify it passes**

Run: `npx playwright test e2e/tabletop/tabletop-pointer-hand.spec.ts`
Expected: all 4 PASS. Also rerun the drawing/text/measurement specs (background-click behavior changed):
`npx playwright test e2e/tabletop/tabletop-drawing.spec.ts e2e/tabletop/tabletop-text.spec.ts e2e/tabletop/tabletop-measurement.spec.ts`
Fix any spec that relied on drag-to-pan with the pointer tool.

- [ ] **Step 5: Typecheck + unit + commit**

```bash
npm run typecheck && npm run test
git add -A app e2e
git commit -m "feat(tabletop): pointer selects/moves objects; pan only via hand, middle-mouse, or space"
```

---

### Task 7: Measurement zoom fix (systematic debugging)

The ruler pipeline (`useViewport.domToImage` ↔ `useRulerTool.toDom`) looks internally consistent, so this task starts from a reproducible failing test, then finds the divergence. REQUIRED SUB-SKILL: superpowers:systematic-debugging.

**Files:**
- Test: `e2e/tabletop/tabletop-measurement-zoom.spec.ts` (new)
- Test: `tests/components/mainview/tabletop/viewportMath.test.ts` (new)
- Modify: whichever of `useViewport.ts` / `useRulerTool.ts` / `RulerOverlay.tsx` / `ActiveMapStage.tsx` the root cause lives in

**Interfaces:**
- Consumes: `useViewport` transform (`fitScale × zoom + pan`), `useRulerTool.onBackgroundPointerDown`.
- Produces: no API changes expected; a regression e2e + a pure round-trip unit test.

- [ ] **Step 1: Write the failing e2e repro**

Copy the provisioning from `tabletop-measurement.spec.ts` (1024×1024 map). Test:

```ts
// e2e/tabletop/tabletop-measurement-zoom.spec.ts
test('anchor dot lands under the cursor when zoomed in', async ({ page }) => {
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Zoom in ~3 steps around the center (wheel up = zoom in).
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(100);

  await page.getByTestId('tool-ruler').click();
  // Click a point offset from center so pan/zoom errors show up.
  const clickX = cx + 137;
  const clickY = cy - 89;
  await page.mouse.click(clickX, clickY);

  const anchor = page.getByTestId('ruler-anchor');
  await expect(anchor).toBeVisible();
  // The SVG circle's cx/cy are stage-local; convert to page coords.
  const stageBox = (await stage.boundingBox())!;
  const cxAttr = Number(await anchor.getAttribute('cx'));
  const cyAttr = Number(await anchor.getAttribute('cy'));
  expect(Math.abs(stageBox.x + cxAttr - clickX)).toBeLessThanOrEqual(2);
  expect(Math.abs(stageBox.y + cyAttr - clickY)).toBeLessThanOrEqual(2);
});

test('anchor dot lands under the cursor at default zoom (control)', async ({ page }) => {
  const stage = page.getByTestId('active-map-stage');
  const box = (await stage.boundingBox())!;
  const clickX = box.x + box.width / 2 + 137;
  const clickY = box.y + box.height / 2 - 89;

  await page.getByTestId('tool-ruler').click();
  await page.mouse.click(clickX, clickY);

  const anchor = page.getByTestId('ruler-anchor');
  await expect(anchor).toBeVisible();
  const stageBox = (await stage.boundingBox())!;
  const cxAttr = Number(await anchor.getAttribute('cx'));
  const cyAttr = Number(await anchor.getAttribute('cy'));
  expect(Math.abs(stageBox.x + cxAttr - clickX)).toBeLessThanOrEqual(2);
  expect(Math.abs(stageBox.y + cyAttr - clickY)).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run the repro**

Run: `npx playwright test e2e/tabletop/tabletop-measurement-zoom.spec.ts`
Expected: the zoomed test FAILS (that is the bug) and the control PASSES. **If the zoomed test passes**, the repro is incomplete — vary the conditions the user hit: zoom while the mouse is near a corner (not center), pan first then zoom, open the inspector sidebar (stage offset changes), browser window resized. Iterate until it reproduces; do not proceed on a green repro.

- [ ] **Step 3: Systematic debugging — locate the divergence**

Read the systematic-debugging skill first. Hypotheses to test in order (instrument with `console.log` in dev, or `page.evaluate` probes):

1. **Stale `containerSize` vs live rect:** `imageOffsetX/Y` derive from `containerSize` state (ResizeObserver) while `domToImage` uses a live `getBoundingClientRect()`. If the observed size lags or differs fractionally from the live rect (e.g. scrollbars, transforms, devicePixelRatio rounding), click-in and render-out disagree. Probe: log `containerSize` vs `rect.width/height` at click time while zoomed.
2. **Wheel-zoom focal drift:** `zoomAround` recomputes pan from `containerSize` too (lines 74–82 of useViewport.ts) — same stale-size class of bug; repeated wheel steps compound the error.
3. **Coordinate mixing in a caller:** the anchor is stored via `domToImage(e.clientX, e.clientY)` but verify nothing (e.g. `RulerOverlay` label divs, SVG viewBox) applies an extra offset when zoomed. SVG here has no viewBox — coordinates are stage-local px; confirm the stage is the offsetParent (it is `absolute inset-0`).
4. **Event target offset:** the click lands on the `<img>`/token/grid child, not the container — `clientX/Y` are viewport coords so that should not matter; verify anyway.

The fix must address the root cause, not add a fudge offset. If it is the stale-size class (1/2), the likely fix is deriving `containerSize` and offsets from the same measurement the conversion uses (e.g. read the live rect inside `domToImage` AND use a ref-synced size for offsets, or store the rect in the ResizeObserver callback and use it everywhere).

- [ ] **Step 4: Add the pure round-trip unit test**

Extract the transform math into `app/components/mainview/tabletop/viewportMath.ts` as part of the fix (pure functions used by `useViewport`):

```ts
export interface ViewportTransform {
  effectiveScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
}

export function computeTransform(
  container: { width: number; height: number },
  image: { width: number; height: number },
  viewport: { zoom: number; panX: number; panY: number }
): ViewportTransform { /* the existing lines 44–52 of useViewport.ts, verbatim */ }

export function domToImagePoint(local: {x,y}, t: ViewportTransform): {x,y}
export function imageToDomPoint(img: {x,y}, t: ViewportTransform): {x,y}
```

Refactor `useViewport.ts` to call these (behavior identical), and `useRulerTool.ts`'s `toDom` to use `imageToDomPoint`. Then:

```ts
// tests/components/mainview/tabletop/viewportMath.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeTransform,
  domToImagePoint,
  imageToDomPoint,
} from '~/components/mainview/tabletop/viewportMath';

describe('viewport transform round-trip', () => {
  const cases = [
    { zoom: 1, panX: 0, panY: 0 },
    { zoom: 2.5, panX: -180, panY: 90 },
    { zoom: 8, panX: 1500, panY: -2300 },
    { zoom: 0.25, panX: 10, panY: 10 },
  ];
  for (const vp of cases) {
    it(`domToImage(imageToDom(p)) ≈ p at zoom ${vp.zoom}`, () => {
      const t = computeTransform({ width: 1280, height: 720 }, { width: 1024, height: 1024 }, vp);
      const p = { x: 333.25, y: 741.5 };
      const round = domToImagePoint(imageToDomPoint(p, t), t);
      expect(round.x).toBeCloseTo(p.x, 6);
      expect(round.y).toBeCloseTo(p.y, 6);
    });
  }
});
```

Run: `npx vitest run --project unit tests/components/mainview/tabletop/viewportMath.test.ts` — PASS.

- [ ] **Step 5: Verify the fix end-to-end**

Run: `npx playwright test e2e/tabletop/tabletop-measurement-zoom.spec.ts e2e/tabletop/tabletop-measurement.spec.ts e2e/tabletop/tabletop-ruler-color.spec.ts`
Expected: all PASS. Also manually verify in the browser at several zoom levels and after panning.

- [ ] **Step 6: Commit**

```bash
git add -A app tests e2e
git commit -m "fix(tabletop): measurement clicks land under the cursor at any zoom

<one-line root-cause summary discovered in Step 3>"
```

---

### Task 8: Full verification pass

**Files:** none new — this is the gate before PR.

- [ ] **Step 1: Full unit + static suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all clean.

- [ ] **Step 2: Full tabletop e2e**

Run: `npx playwright test e2e/tabletop/`
Expected: all specs pass (with the same env/flags CI uses — check `.github/workflows` for `VITE_PUBLIC_FF_*`).

- [ ] **Step 3: Manual acceptance against the spec (use the superpowers:verification-before-completion skill)**

Walk the spec's Goals section in the running app:
1. Open Draw, Dice, Layers together (as GM): identical chrome, no overlap on open, each auto-sized, draggable, X closes.
2. Draw/Text/Ruler icon toggling: click activates + opens; re-click or X closes + reverts to pointer; toolbar highlight matches.
3. Pointer: drag background — map must not move; click text/token/drawing — selects; drag moves it.
4. Hand: drag pans; cursor grab/grabbing. Middle-drag and Space+drag pan with pointer active.
5. Ruler at zoom 3×+: dots land exactly under the cursor.
6. Resize the window / toggle inspector with windows open: windows stay in bounds.

- [ ] **Step 4: Update the spec status + finish**

Mark the spec `Status: Implemented` and commit. Then use the superpowers:finishing-a-development-branch skill (PR targets `dev`).

```bash
git add docs/superpowers/specs/2026-07-12-toolbar-tools-design.md
git commit -m "docs: mark toolbar tools spec implemented"
```
