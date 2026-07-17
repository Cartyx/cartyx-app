# Toolbar Tools — Production-Ready Design

**Date:** 2026-07-12
**Branch:** `tools-fixes` (targets `dev`)
**Status:** Implemented (see docs/superpowers/plans/2026-07-12-toolbar-tools.md)

## Problem

The VTT toolbar tools are inconsistent and have interaction bugs:

1. **Inconsistent tool windows.** Draw and Text panels have a `::` drag grip but no close button; Layers and Measurement panels have a close X but are fixed in the top-left and not draggable; the Dice Roller uses the heavyweight `FloatingWindow` (title bar, minimize/maximize/resize, tray) — a completely different look and behavior.
2. **Windows overlap.** Panels that spawn at the same fixed position draw on top of each other; there is no placement logic for tool windows.
3. **Pointer tool pans the map.** There is no distinct hand-tool implementation — any background drag pans regardless of tool (`ActiveMapStage.onPanPointerDown`), so the pointer tool cannot be used to select/move text without dragging the map instead.
4. **Measurement tool misplaces points when zoomed.** When zoomed in, clicking the map places the measurement dot away from the cursor.

## Goals

- All five window tools (Draw, Text, Measurement, Dice Roller, Layers) present identical window chrome and behavior.
- Multiple tool windows can be open at once without overlapping on open.
- Tool windows always render at the size their content needs.
- Pointer = select/move objects; Hand = pan the map. Distinct behaviors.
- Measurement clicks land exactly under the cursor at any zoom level.

## Non-Goals (out of scope)

- Stamp tool implementation (currently a no-op; unchanged).
- Marquee / multi-select with the pointer tool.
- Persisting tool-window positions across sessions (per-user, ephemeral, in-memory only).
- Any changes to document `FloatingWindow`s (wiki/GM-screen windows) beyond removing the Dice Roller from that system.

## Design

### 1. Unified `ToolWindow` component + `useToolWindows` manager

**New component:** `app/components/mainview/tabletop/ToolWindow.tsx`

- Header: `GripVertical` ("`::`") + tool icon + uppercase title on the left; close **X** button on the right. The entire header is the drag handle.
- Body: the tool's existing settings/content component, unchanged.
- Auto-sized to content: no fixed widths on the window shell; content defines natural size. No resize handle, no minimize/maximize. Window position is clamped to the stage bounds (reusing the `clampPanelPos` approach).
- `stopPropagation` on pointer events so interactions never reach the map stage.

**New hook:** `useToolWindows` (lives with the stage components) owning:

- `openWindows`: ordered map of tool id → `{ x, y, zIndex }`.
- `open(id)` / `close(id)` / `focus(id)` (focus brings to front) / `move(id, pos)`.
- Placement on open (see §2).

Tool windows are per-user and ephemeral — never server-synced, never in the `FloatingWindowManager`. The Dice Roller's content (`DiceRoller` component) moves out of `FloatingWindow` into a `ToolWindow`; the special-case `diceWindow` state and the momentary-tool effect in `TabletopView.tsx` are removed.

**Toolbar semantics:**

| Tool | Kind | Icon click | Close X / re-click |
|---|---|---|---|
| Pointer | mode only | activates mode | — |
| Hand | mode only | activates mode | — |
| Draw (GM) | mode + window | activates mode, opens window | closes window AND reverts to pointer |
| Text | mode + window | activates mode, opens window | closes window AND reverts to pointer |
| Measurement | mode + window | activates mode, opens window | closes window AND reverts to pointer |
| Dice Roller | window only | toggles window; active tool unchanged | closes window |
| Layers (GM) | window only | toggles window; active tool unchanged | closes window |

- Clicking a modal tool's icon while it is already active closes its window and reverts to pointer (toggle).
- Clicking a different modal tool switches modes: previous modal tool's window closes, new one opens.
- Window-only tools (Dice, Layers) can stay open alongside any active mode.
- Toolbar icons render highlighted when their window is open (window tools) or their mode is active (pointer/hand).
- `ToolType` keeps `'dice' | 'layer'` out of the *mode* state: `activeTool` becomes `'pointer' | 'hand' | 'drawing' | 'text' | 'ruler' | 'stamp'`; dice/layer clicks route to `useToolWindows` only. `ToolBar` gains an `openWindows` prop for highlight state.

### 2. Placement: top-left origin, flow down then right

On `open(id)`:

1. The window renders hidden (`visibility: hidden`) for one frame and is measured (`getBoundingClientRect`).
2. A pure placement function receives the new window's size, the rects of currently open windows, and the stage size, and returns the first free slot:
   - Origin at `(12, 12)` (top-left of the stage, next to the toolbar).
   - Candidate slots stack **below** previously placed windows (with a 12px gutter).
   - When a candidate would overflow the stage bottom, start a **new column to the right** of the widest window in the previous column.
   - If no slot fits at all (tiny viewport), fall back to origin (overlap allowed as last resort).
3. The window becomes visible at the computed position.

Placement runs only at open time. Users can then drag windows anywhere (clamped to stage). Clicking or dragging a window brings it to front (incrementing z-index within a dedicated z-band above the map, below modals).

The placement function is pure (`placeToolWindow(size, openRects, stageSize) → {x, y}`) and unit-tested.

### 3. Pointer vs Hand

In `ActiveMapStage.onPanPointerDown` (and the pan branch of the drag state machine):

- Background drag pans the map **only when**: the Hand tool is active, **or** the middle mouse button initiated the drag, **or** the Space key is held (both shortcuts work with any active tool).
- Hand tool shows `grab` cursor, `grabbing` while dragging.
- Pointer tool: background press/click deselects the current selection; background drag does nothing else (no marquee).
- Objects (tokens, text, drawings) are selectable and draggable with the **pointer** tool. Text and drawing interaction currently gated behind their modal tools becomes available to the pointer tool as well; the modal tools keep their creation/edit behaviors.
- Wheel zoom is unchanged and tool-independent.

A `stamp` press behaves like pointer minus object drag (unchanged no-op; out of scope).

### 4. Measurement zoom fix

`useRulerTool` and `useViewport.domToImage`/`toDom` appear internally consistent, so the bug is diagnosed via systematic debugging rather than a pre-assumed fix:

1. Reproduce: place measurement points at zoom 1 and zoom ≠ 1; record cursor vs rendered dot offset.
2. Prime suspects: a stale container `getBoundingClientRect` after zoom/layout change; a caller passing raw `clientX/clientY` where image-space coordinates are expected; CSS transform vs offset mismatch on the overlay.
3. Fix at the root cause; add a round-trip unit test for the viewport transform (`domToImage(toDom(p)) ≈ p` across pan/zoom combinations) and a regression check that ruler points land under the cursor at multiple zoom levels.

### 5. Error handling / edge cases

- Stage resize (window resize, inspector open/close): open windows are re-clamped into bounds; positions otherwise preserved.
- Collapsed toolbar does not affect window placement (placement is relative to the stage, which already excludes the toolbar column).
- GM-only tools (Draw, Layers) never appear for players — unchanged gating in `ToolBar`.
- Dice feature flag (`VITE_PUBLIC_FF_DICE`) continues to gate the dice icon.
- Closing a modal tool's window mid-interaction (e.g., mid-measurement) cancels the in-progress interaction, matching current close behavior.

### 6. Testing

- **Unit (vitest):** `placeToolWindow` placement scenarios (empty stage, column overflow → new column, no-fit fallback); viewport round-trip under pan/zoom; toolbar semantics reducer (icon click / X behavior per tool kind).
- **E2E (Playwright):** every window tool opens a window with grip, icon+title, and X; opening two windows yields non-overlapping rects; X closes and (for modal tools) reverts to pointer; pointer drag on background does not change the map transform, hand drag does; text is movable with the pointer tool; measurement dot renders at the click position when zoomed in.
- Existing e2e specs that relied on old behavior (dice momentary tool, fixed panel positions) are updated.
- E2E must respect the `VITE_PUBLIC_FF_*` flag requirements (dice tests gated on the dice flag).

## Affected files (primary)

- `app/components/mainview/ToolBar.tsx` — window-highlight state, dice/layer routing.
- `app/routes/campaigns/$campaignId/play.tsx` — `activeTool` type narrowing.
- `app/components/mainview/tabletop/TabletopView.tsx` — remove dice momentary hack and `diceWindow`; wire `useToolWindows`.
- `app/components/mainview/tabletop/ActiveMapStage.tsx` — pan gating (hand/middle/space), pointer-tool object interaction, render `ToolWindow`s, remove per-panel drag plumbing.
- `app/components/mainview/tabletop/ToolWindow.tsx` (new), `useToolWindows.ts` (new), `placeToolWindow.ts` (new, pure).
- `LayersPanel.tsx`, `RulerSettingsPanel.tsx`, `DrawingSettingsPanel.tsx`, `TextSettingsPanel.tsx` — become chrome-less content rendered inside `ToolWindow`.
- `useViewport.ts` / `useRulerTool.ts` — measurement fix once root-caused.
